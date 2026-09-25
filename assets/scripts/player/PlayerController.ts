/**
 * PlayerController.ts —— 玩家控制器（挂载到玩家节点）
 *
 * 职责：
 *   - 触摸/拖拽移动（单指）：全屏任意位置拖拽（GDD 7.4：左手拇指全域拖拽）。
 *     移动方向 = 触摸点 - 玩家位置，归一化 × 移速；触摸注册在 Canvas 上而非玩家节点，
 *     保证屏幕任意位置都能控制（玩家节点本身很小，直接挂节点事件会点不到）。
 *   - 边界限制：地图矩形范围（±mapHalfWidth/±mapHalfHeight，以世界原点为中心）。
 *   - 碰撞回调：敌人（扣血 + 0.5s 无敌帧）、远程弹幕（扣血 + 销毁）、
 *     XP宝石（自动拾取）、灵石（拾取，吃贪婪倍率）。宝箱由拾取物系统处理。
 *   - 每帧磁吸：pickupRange（80 × 范围倍率）内的 XP 宝石自动吸附，近身即收。
 *   - 自动回血：每秒 1 点（GDD 4.2.7）；击杀妖王（精英）+30。
 *   - 死亡流程：发出 GameEvent.PLAYER_DIED 事件，状态切换与结算由 GameManager 负责。
 *
 * 事件（emit，统一走 core/GameEvent 枚举）：
 *   - GameEvent.PLAYER_DAMAGED    { hp, maxHp, amount }     受击（HUD 血条/红屏反馈）
 *   - GameEvent.PLAYER_HP_CHANGED { hp, maxHp }             生命变化（回血）
 *   - GameEvent.PLAYER_XP         { gained, total, xpToNext }  经验增加（HUD 经验条）
 *   - GameEvent.PLAYER_LEVEL_UP   { level, levels }         升级（三选一系统监听并暂停弹窗）
 *   - GameEvent.XP_PICKED         { node, amount }          XP 宝石被拾取
 *   - GameEvent.GOLD_PICKED       { node, amount }          灵石被拾取
 *   - GameEvent.PLAYER_DIED       { node }                  玩家死亡
 * 事件（on）：
 *   - GameEvent.ENEMY_KILLED                                 击杀妖王回血 30
 */
import {
    _decorator, Component, Node, Vec3, Vec2, v3, Sprite, Color,
    Collider2D, UITransform, Prefab, view, warn,
    EventTouch, Contact2DType, IPhysics2DContact, Graphics, Label,
    UIOpacity, tween, Tween,
} from 'cc';
import { GameManager, GameState } from '../core/GameManager';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GAME_CONFIG } from '../core/GameConfig';
import { BuildSystem } from '../progression/BuildSystem';
import { PlayerData } from './PlayerData';
import { PlayerRegistry } from '../core/PlayerRegistry';
import { XPSystem } from '../progression/XPSystem';
import { Enemy } from '../enemy/Enemy';
import { EnemyType, PhysicsGroups } from '../enemy/EnemyTypes';
import { WeaponSystem } from '../combat/WeaponSystem';
import { hexColor } from '../core/UIUtils';

const { ccclass, property } = _decorator;

@ccclass('PlayerController')
export class PlayerController extends Component {
    /** 基础移动速度（px/s）；实际移速 = speed × data.speed（速度倍率） */
    @property({ tooltip: '基础移动速度（px/s）' })
    speed: number = 200;

    /** 磁吸基础半径（px）；实际磁吸半径 = pickupRange = magnetRange × 范围倍率 */
    @property({ tooltip: 'XP宝石磁吸基础半径（px）' })
    magnetRange: number = 150;

    /** 每秒自动回复 HP（GDD：每秒自动恢复 1 点） */
    @property({ tooltip: '每秒自动回复 HP' })
    regenPerSecond: number = 1;

    /**
     * 面朝方向（移动方向的单位向量，默认正右）。
     * 寒冰掌等前方系武器使用：WeaponSystem.facing（弧度，0 = 正右）
     * 由本属性在每帧移动时派生同步（getComponent(WeaponSystem) 直取）。
     */
    public facing: Vec3 = v3(1, 0, 0);

    /** 地图矩形边界（半宽，以世界原点为中心；与 MapManager 2000×2000 对齐留 50px 边距） */
    @property({ tooltip: '地图半宽（px）' })
    mapHalfWidth: number = 950;

    /** 地图矩形边界（半高） */
    @property({ tooltip: '地图半高（px）' })
    mapHalfHeight: number = 950;

    /**
     * 磁吸拾取注册表（由拾取物系统维护）：
     *   经验灵珠调用 registerXpGem(node)（节点以 xpAmount 标记经验值），
     *   灵石调用 registerGold(node)（节点以 goldAmount 标记金额）；
     *   两者共用同一套磁吸/收集逻辑，拾取时按标记属性分流结算。
     * 注：为减少单帧开销，后续可换用空间哈希/均匀网格（GDD 9.3 实现要点）。
     */
    private static pickups: Node[] = [];

    private data: PlayerData = new PlayerData();
    /** 受击无敌帧剩余时间（秒）；与御风步冲刺无敌相互独立、可叠加 */
    private invincibleTimer: number = 0;
    /** 御风步冲刺无敌（DashAbility 开关） */
    private dashInvincible: boolean = false;
    /** 冲刺中：暂停拖拽移动（DashAbility 开关，避免与冲刺位移互相拉扯） */
    private dashing: boolean = false;
    private isDead: boolean = false;

    /** 经验系统（应用问心修为回馈倍率×贪婪，统一升级判定） */
    private xpSystem!: XPSystem;

    /** 触摸目标点（Canvas 本地坐标；null 表示未触摸） */
    private touchPos: Vec3 | null = null;

    private regenTimer: number = 0;
    /** 已拾取的灵珠数量（流派天赋「聚灵诀」每 20 颗回血） */
    private orbCount: number = 0;

    private collider: Collider2D | null = null;
    private sprite: Sprite | null = null;
    private baseColor: Color | null = null;

    // —— 玩家视觉（Graphics 程序化：方向箭头 / HP 条 / 受击光圈） ——
    private arrowNode: Node | null = null;
    private hpBarGfx: Graphics | null = null;
    private hpLabel: Label | null = null;
    private hitFlashNode: Node | null = null;
    private hitFlashOp: UIOpacity | null = null;

    // ==================== 静态注册表 ====================

    private static registerPickup(node: Node): void {
        if (!PlayerController.pickups.includes(node)) PlayerController.pickups.push(node);
    }

    /** 注销拾取物（拾取/销毁时调用；磁吸循环亦会清理失效节点） */
    public static unregisterPickup(node: Node): void {
        const i = PlayerController.pickups.indexOf(node);
        if (i >= 0) PlayerController.pickups.splice(i, 1);
    }

    /** 注册经验灵珠（节点需带 xpAmount 属性） */
    public static registerXpGem(node: Node): void {
        PlayerController.registerPickup(node);
    }

    /** 注册灵石（节点需带 goldAmount 属性） */
    public static registerGold(node: Node): void {
        PlayerController.registerPickup(node);
    }

    /** 兼容旧调用名，等价于 unregisterPickup */
    public static unregisterXpGem(node: Node): void {
        PlayerController.unregisterPickup(node);
    }

    /** 当前在场拾取物（通用磁吸列表） */
    public static getXpGems(): Node[] {
        return PlayerController.pickups;
    }

    // ==================== 生命周期 ====================

    onLoad(): void {
        // 玩家节点命名约定（供 cc.find('Canvas/Player') 兜底查找）
        if (this.node.name !== 'Player') this.node.name = 'Player';

        // 全局注册：问心/升级系统（PlayerRegistry）与敌人索敌（GameManager）共享本局玩家
        PlayerRegistry.bind(this.data);
        GameManager.getInstance().setPlayer(this.node);
        this.xpSystem = new XPSystem(this.data);

        this.sprite = this.getComponent(Sprite);
        this.baseColor = this.sprite ? this.sprite.color.clone() : null;

        this.initTouch();
        this.initCollision();
        this.initEvents();
        this.setupPlayerVisuals();
    }

    update(dt: number): void {
        if (GameManager.getInstance().state !== GameState.PLAYING || this.isDead) return;
        if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
        this.handleMovement(dt);
        this.magnetPickup(dt);
        this.updateRegen(dt);
    }

    // ==================== 无敌 / 御风步接口 ====================

    /** 是否处于无敌（受击无敌帧 或 御风步冲刺中） */
    public isInvincible(): boolean {
        return this.invincibleTimer > 0 || this.dashInvincible;
    }

    /** 御风步：冲刺期间无敌 */
    public setDashInvincible(on: boolean): void {
        this.dashInvincible = on;
    }

    /** 御风步：冲刺期间暂停拖拽移动（并清掉触摸目标，避免冲刺结束立刻被旧目标拉走） */
    public setDashing(on: boolean): void {
        this.dashing = on;
        if (on) this.touchPos = null;
    }

    public isDashing(): boolean {
        return this.dashing;
    }

    /** 当前朝向（御风步据此决定冲刺方向） */
    public getFacing(): Vec3 {
        return this.facing.clone();
    }

    /** 直接位移玩家到指定坐标（御风步用；自动做地图边界钳制） */
    public moveTo(x: number, y: number): void {
        this.clampToMap(x, y, this.node.position.z);
    }

    onDestroy(): void {
        EventBus.off(GameEvent.ENEMY_KILLED, this.onEnemyKilled, this);
        EventBus.off(GameEvent.PLAYER_DAMAGED, this.onPlayerDamaged, this);
        EventBus.off(GameEvent.PLAYER_HP_CHANGED, this.onPlayerHpChanged, this);
        EventBus.off(GameEvent.ENEMY_ATTACK, this.onEnemyAttack, this);
        EventBus.off(GameEvent.GAME_START, this.onGameStart, this);
        this.unscheduleAllCallbacks();
    }

    // ==================== 触摸移动 ====================

    /**
     * 触摸注册在 Canvas（玩家父节点）上：全屏任意位置可拖拽。
     * 玩家节点需作为 Canvas 的直接子节点（或与 Canvas 同一坐标系）。
     */
    private initTouch(): void {
        const touchTarget = this.node.parent ?? this.node;
        touchTarget.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        touchTarget.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        touchTarget.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        touchTarget.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    private onTouchStart(event: EventTouch): void {
        if (this.isDead) return;
        this.touchPos = this.uiToLocal(event.getUILocation());
    }

    /** 单指拖拽：移动方向 = 触摸点 - 玩家位置 */
    private onTouchMove(event: EventTouch): void {
        if (this.isDead) return;
        this.touchPos = this.uiToLocal(event.getUILocation());
    }

    private onTouchEnd(): void {
        this.touchPos = null; // 松手停步
    }

    /** UI 屏幕坐标 → Canvas 本地坐标（适配屏幕缩放/刘海屏） */
    private uiToLocal(uiPos: Vec2): Vec3 {
        const parent = this.node.parent;
        if (parent) {
            const uiTrans = parent.getComponent(UITransform);
            if (uiTrans) return uiTrans.convertToNodeSpaceAR(v3(uiPos.x, uiPos.y, 0));
        }
        // 兜底：按屏幕像素中心换算
        const size = view.getVisibleSize();
        return v3(uiPos.x - size.width / 2, uiPos.y - size.height / 2, 0);
    }

    private handleMovement(dt: number): void {
        if (this.dashing) return; // 冲刺位移由 DashAbility 接管
        if (!this.touchPos) return;
        const pos = this.node.position;
        const dx = this.touchPos.x - pos.x;
        const dy = this.touchPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 2) {
            // 已到达触摸点：停止
            this.touchPos = null;
            return;
        }
        const nx = dx / dist;
        const ny = dy / dist;

        // 更新面朝方向（单位向量）并同步武器系统面朝角（弧度，0 = 正右）
        this.facing = v3(nx, ny, 0);
        const weaponSystem = this.node.getComponent(WeaponSystem);
        if (weaponSystem) weaponSystem.facing = Math.atan2(ny, nx);
        this.updateArrow();

        const moveSpeed = this.speed * this.data.speed; // 基础移速 × 速度倍率
        const step = moveSpeed * dt;
        if (dist <= step) {
            // 一步到达：直接落到触摸点
            this.clampToMap(this.touchPos.x, this.touchPos.y, pos.z);
            this.touchPos = null;
        } else {
            this.clampToMap(pos.x + nx * step, pos.y + ny * step, pos.z);
        }
    }

    /** 边界限制（地图矩形范围） */
    private clampToMap(x: number, y: number, z: number): void {
        x = Math.min(Math.max(x, -this.mapHalfWidth), this.mapHalfWidth);
        y = Math.min(Math.max(y, -this.mapHalfHeight), this.mapHalfHeight);
        this.node.setPosition(x, y, z);
    }

    // ==================== 碰撞 ====================

    /**
     * 碰撞回调：需在玩家节点上挂 Collider2D（推荐 BoxCollider2D，Group 自动设置为 PLAYER）。
     * 需在项目设置中启用 2D 物理系统。
     */
    private initCollision(): void {
        this.collider = this.getComponent(Collider2D);
        if (!this.collider) {
            warn('[Player] 未找到 Collider2D，请为玩家节点添加 BoxCollider2D 并启用 2D 物理');
            return;
        }
        // Cocos Creator 3.8 的 Collider2D 使用 `group` 属性；
        // setGroup/setMask 是旧版本或 3D 物理组件的 API。
        // 碰撞掩码由 Project Settings 的 2D collision matrix 统一管理。
        this.collider.group = PhysicsGroups.PLAYER;
        this.collider.on(Contact2DType.BEGIN_CONTACT, this.onCollisionEnter, this);
    }

    private onCollisionEnter(
        selfCollider: Collider2D,
        otherCollider: Collider2D,
        contact: IPhysics2DContact | null
    ): void {
        if (this.isDead) return;
        const other = otherCollider.node;
        const group = otherCollider.group;

        if (group === PhysicsGroups.ENEMY) {
            // 与敌人碰撞：扣血（无敌帧由 takeDamage 内部处理）
            const enemy = other.getComponent(Enemy);
            if (enemy) this.takeDamage(enemy.getDamage());
        } else if (group === PhysicsGroups.ENEMY_BULLET) {
            // 远程弹幕：扣血 + 销毁
            const dmg: number = other['bulletDamage'] ?? 6;
            this.takeDamage(dmg);
            EventBus.emit(GameEvent.ENEMY_BULLET_HIT, { node: other });
            other.destroy();
        } else if (group === PhysicsGroups.XP_GEM) {
            // XP 宝石：自动拾取
            const amount: number = other['xpAmount'] ?? 1;
            PlayerController.unregisterXpGem(other);
            this.collectXp(amount);
            EventBus.emit(GameEvent.XP_PICKED, { node: other, amount });
            other.destroy();
        } else if (group === PhysicsGroups.GOLD) {
            // 灵石：拾取（吃贪婪倍率）
            const amount: number = other['goldAmount'] ?? 1;
            this.data.gold += Math.round(amount * this.data.greed);
            EventBus.emit(GameEvent.GOLD_PICKED, { node: other, amount });
            other.destroy();
        }
        // CHEST 宝箱：由拾取物系统自行处理碰撞，此处不拦截
    }

    // ==================== XP 磁吸 ====================

    /**
     * 每帧检查磁吸范围内的拾取物（经验灵珠 / 灵石）：
     *   - pickupRange（magnetRange × 范围倍率）内：向玩家吸附（吸附速度 450px/s）
     *   - 极近距离（14px）内：直接收集（无碰撞体时的兜底拾取）
     */
    private magnetPickup(dt: number): void {
        const radius = this.data.pickupRange; // = magnetRange × area（范围倍率）
        const collectRadius = 14;
        const myPos = this.node.worldPosition;
        const gems = PlayerController.pickups;

        for (let i = gems.length - 1; i >= 0; i--) {
            const gem = gems[i];
            if (!gem || !gem.isValid || !gem.activeInHierarchy) {
                gems.splice(i, 1); // 清理失效节点
                continue;
            }
            const gemPos = gem.worldPosition;
            const dx = myPos.x - gemPos.x;
            const dy = myPos.y - gemPos.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > radius * radius) continue; // 磁吸范围外

            const dist = Math.sqrt(distSq);
            if (dist <= collectRadius) {
                // 直接收集
                gems.splice(i, 1);
                this.collectPickup(gem);
            } else {
                // 向玩家吸附（每帧移动 450px/s）
                const pull = 450 * dt;
                gem.setWorldPosition(gemPos.x + (dx / dist) * pull, gemPos.y + (dy / dist) * pull, gemPos.z);
            }
        }
    }

    /**
     * 拾取结算（按标记属性分流）：
     *   goldAmount → 灵石入账（吃贪婪倍率）并广播 GOLD_PICKED（HUD 灵石刷新）
     *   xpAmount   → 经验入账（XPSystem）并广播 XP_PICKED（"+N 灵气"飘字）
     */
    private collectPickup(node: Node): void {
        const gold = PlayerController.readPickupAmount(node, 'goldAmount');
        if (gold !== undefined) {
            this.data.gold += Math.round(gold * this.data.greed);
            EventBus.emit(GameEvent.GOLD_PICKED, { node, amount: gold });
            node.destroy();
            return;
        }
        const amount = PlayerController.readPickupAmount(node, 'xpAmount') ?? 1;
        this.collectXp(amount);
        // 流派天赋「聚灵诀」：每拾取 20 个灵珠恢复 10 HP
        this.orbCount++;
        if (BuildSystem.hasTalent('spirit_gather') && this.orbCount % 20 === 0) {
            this.heal(10);
        }
        EventBus.emit(GameEvent.XP_PICKED, { node, amount });
        node.destroy();
    }

    /** 读取掉落物上的标记数值（节点以动态属性承载掉落金额，避免 any 索引） */
    private static readPickupAmount(node: Node, key: 'xpAmount' | 'goldAmount'): number | undefined {
        const bag = node as unknown as Record<string, number | undefined>;
        return bag[key];
    }

    // ==================== 伤害 / 死亡 ====================

    /**
     * 受伤：扣血 + 无敌帧 + 反馈。
     * 伤害来源（敌人接触 / 敌方弹幕）统一由 GameEvent.ENEMY_ATTACK 事件驱动，
     * 判定在 Enemy 侧做距离检测，不依赖 2D 物理系统的碰撞回调。
     */
    public takeDamage(amount: number): void {
        if (this.isInvincible() || this.isDead || amount <= 0) return;
        this.data.hp -= amount;
        this.invincibleTimer = GAME_CONFIG.player.invincibleFrames; // 无敌帧（数值收敛在 GameConfig）
        this.flashHit();
        this.refreshHpBar();
        EventBus.emit(GameEvent.PLAYER_DAMAGED, { hp: this.data.hp, maxHp: this.data.maxHp, amount });
        if (this.data.hp <= 0) {
            this.data.hp = 0;
            this.die();
        }
    }

    /** 受击反馈：Sprite 闪白（若挂了 Sprite）+ 红色受击光圈 */
    private flashHit(): void {
        if (this.sprite) {
            this.sprite.color = Color.WHITE;
            this.scheduleOnce(() => {
                if (this.sprite && this.baseColor) this.sprite.color = this.baseColor;
            }, 0.1);
        }
        this.playHitFlash();
    }

    /**
     * 红色受击光圈（0.25s 淡出）。
     * 程序化玩家节点只有 Graphics、没有 Sprite，闪白无效，因此单独做一层反馈，
     * 让玩家明确感知"我正在挨打"。
     */
    private playHitFlash(): void {
        const node = this.hitFlashNode;
        const op = this.hitFlashOp;
        if (!node || !node.isValid || !op) return;
        node.active = true;
        Tween.stopAllByTarget(op);
        op.opacity = 180;
        tween(op)
            .to(0.25, { opacity: 0 })
            .call(() => {
                if (node.isValid) node.active = false;
            })
            .start();
    }

    /** 治疗（击杀妖王 +30、吃血丹 +20 等调用） */
    public heal(amount: number): void {
        if (this.isDead || amount <= 0) return;
        const before = this.data.hp;
        this.data.hp = Math.min(this.data.maxHp, this.data.hp + amount);
        if (this.data.hp !== before) {
            EventBus.emit(GameEvent.PLAYER_HP_CHANGED, { hp: this.data.hp, maxHp: this.data.maxHp });
        }
    }

    /** 每秒自动回血 */
    private updateRegen(dt: number): void {
        if (this.regenPerSecond <= 0) return;
        this.regenTimer += dt;
        if (this.regenTimer >= 1) {
            this.regenTimer -= 1;
            this.heal(this.regenPerSecond);
        }
    }

    /** 死亡：发出事件，状态切换与结算由 GameManager 处理 */
    private die(): void {
        this.isDead = true;
        this.touchPos = null;
        EventBus.emit(GameEvent.PLAYER_DIED, { node: this.node });
    }

    // ==================== 经验 / 升级 ====================

    /**
     * 收集经验：统一走 XPSystem（实际经验 = 基础值 × 问心修为回馈倍率 × 贪婪，
     * 升级判定与 PLAYER_LEVEL_UP 广播也由 XPSystem 负责）。
     * 升级弹窗（三选一）由 LevelUpUI 监听 'PLAYER_LEVEL_UP' 实现。
     */
    public collectXp(amount: number): void {
        if (this.isDead || amount <= 0) return;
        const gained = this.xpSystem.addXp(amount);
        // HUD 经验条事件
        EventBus.emit(GameEvent.PLAYER_XP, { gained, total: this.data.xp, xpToNext: this.data.xpToNext });
    }

    // ==================== 事件 ====================

    private initEvents(): void {
        EventBus.on(GameEvent.ENEMY_KILLED, this.onEnemyKilled, this);
        EventBus.on(GameEvent.PLAYER_DAMAGED, this.onPlayerDamaged, this);
        EventBus.on(GameEvent.PLAYER_HP_CHANGED, this.onPlayerHpChanged, this);
        EventBus.on(GameEvent.ENEMY_ATTACK, this.onEnemyAttack, this);
        EventBus.on(GameEvent.GAME_START, this.onGameStart, this);
    }

    /**
     * 新一局复位（GAME_START）。
     * 关键：必须清掉 isDead 与无敌/冲刺状态 —— 否则死后重开角色永远不动
     * （update 首行即 return），表现就是"再来一局没有重新开始"。
     */
    private onGameStart = (): void => {
        this.isDead = false;
        this.invincibleTimer = 0;
        this.dashInvincible = false;
        this.dashing = false;
        this.touchPos = null;
        this.regenTimer = 0;
        this.orbCount = 0;
        this.facing = v3(1, 0, 0);

        // 玩家数据就地复位（武器/被动槽位清空 → WeaponSystem 下一帧移除运行时武器）
        this.data.reset();
        PlayerRegistry.bind(this.data);

        // 回到场地中心
        this.node.setPosition(0, 0, this.node.position.z);

        // 立即清空武器运行时状态（环绕剑阵/光环节点），不等 reconcile
        const weapons = this.node.getComponent(WeaponSystem);
        if (weapons) {
            weapons.clearAll();
            weapons.facing = 0;
        }

        this.refreshHpBar();
    };

    /** 敌人攻击命中（接触 / 弹幕）→ 统一走 takeDamage（含无敌帧） */
    private onEnemyAttack = (payload: { damage: number; kind?: string }): void => {
        if (!payload) return;
        this.takeDamage(payload.damage ?? 0);
    };

    /** 击杀妖王（精英）回血 30（GDD 4.2.7） */
    private onEnemyKilled(payload: { type: EnemyType }): void {
        if (payload && payload.type === EnemyType.ELITE) this.heal(30);
    }

    // ==================== 玩家视觉（Graphics 程序化） ====================

    /** 方向箭头 + HP 条（100/100 样式） */
    private setupPlayerVisuals(): void {
        // —— 方向箭头（白色小三角，位于圆形上方，指向移动方向） ——
        this.arrowNode = new Node('PlayerArrow');
        this.arrowNode.setParent(this.node);
        this.arrowNode.setPosition(0, 34, 0);
        const ag = this.arrowNode.addComponent(Graphics);
        ag.fillColor = Color.WHITE;
        ag.moveTo(0, 10);
        ag.lineTo(-8, -5);
        ag.lineTo(8, -5);
        ag.close();
        ag.fill();

        // —— HP 条（玩家下方） ——
        const bar = new Node('PlayerHpBar');
        bar.setParent(this.node);
        bar.setPosition(0, -36, 0);
        const bg = bar.addComponent(Graphics);
        bg.fillColor = new Color(16, 16, 26, 220);
        bg.roundRect(-27, -5, 54, 10, 5);
        bg.fill();
        this.hpBarGfx = bar.addComponent(Graphics);

        // —— HP 文本（如 "100 / 100"） ——
        const hpText = new Node('PlayerHpText');
        hpText.setParent(this.node);
        hpText.setPosition(0, -52, 0);
        hpText.addComponent(UITransform).setContentSize(120, 22);
        this.hpLabel = hpText.addComponent(Label);
        this.hpLabel.fontSize = 13;
        this.hpLabel.lineHeight = 16;
        this.hpLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.hpLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this.hpLabel.color = new Color(240, 244, 248, 255);

        // —— 受击光圈（红色，默认隐藏，受击时闪一下） ——
        const flash = new Node('PlayerHitFlash');
        flash.setParent(this.node);
        flash.addComponent(UITransform).setContentSize(80, 80);
        const fg = flash.addComponent(Graphics);
        fg.fillColor = new Color(255, 70, 70, 90);
        fg.circle(0, 0, 26);
        fg.fill();
        fg.lineWidth = 3;
        fg.strokeColor = new Color(255, 120, 120, 220);
        fg.circle(0, 0, 26);
        fg.stroke();
        this.hitFlashOp = flash.addComponent(UIOpacity);
        this.hitFlashOp.opacity = 0;
        flash.active = false;
        this.hitFlashNode = flash;

        this.refreshHpBar();
    }

    /** 方向箭头指向面朝方向（三角默认朝 +y，旋转到 facing 角） */
    private updateArrow(): void {
        if (!this.arrowNode || !this.arrowNode.isValid) return;
        const deg = (Math.atan2(this.facing.y, this.facing.x) * 180) / Math.PI;
        this.arrowNode.angle = deg - 90;
    }

    /** 刷新 HP 条与文本（PLAYER_DAMAGED / PLAYER_HP_CHANGED / 初始化时调用） */
    private refreshHpBar(): void {
        const g = this.hpBarGfx;
        if (!g) return;
        g.clear();
        const ratio = Math.max(0, Math.min(1, this.data.hp / Math.max(1, this.data.maxHp)));
        g.fillColor = ratio > 0.5 ? hexColor('#4CAF50') : ratio > 0.25 ? hexColor('#FFC107') : hexColor('#F44336');
        g.roundRect(-25, -3, 50 * ratio, 6, 3);
        g.fill();
        if (this.hpLabel) {
            this.hpLabel.string = `${Math.max(0, Math.ceil(this.data.hp))} / ${this.data.maxHp}`;
        }
    }

    /** 受击 / 生命变化 → 刷新 HP 条 */
    private onPlayerDamaged = (): void => { this.refreshHpBar(); };
    private onPlayerHpChanged = (): void => { this.refreshHpBar(); };

    // ==================== 对外访问 ====================

    /** 玩家数据（升级/武器/被动系统读取与修改） */
    public getData(): PlayerData {
        return this.data;
    }

    /** 是否已死亡 */
    public isAlive(): boolean {
        return !this.isDead;
    }
}
