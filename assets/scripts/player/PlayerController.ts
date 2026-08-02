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
import * as cc from 'cc';
import { GameManager, GameState } from '../core/GameManager';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { PlayerData } from './PlayerData';
import { PlayerRegistry } from '../core/PlayerRegistry';
import { XPSystem } from '../progression/XPSystem';
import { Enemy } from '../enemy/Enemy';
import { EnemyType, PhysicsGroups } from '../enemy/EnemyTypes';
import { WeaponSystem } from '../combat/WeaponSystem';

const { ccclass, property } = cc._decorator;

@ccclass('PlayerController')
export class PlayerController extends cc.Component {
    /** 基础移动速度（px/s）；实际移速 = speed × data.speed（速度倍率） */
    @property({ tooltip: '基础移动速度（px/s）' })
    speed: number = 200;

    /** 磁吸基础半径（px）；实际磁吸半径 = pickupRange = magnetRange × 范围倍率 */
    @property({ tooltip: 'XP宝石磁吸基础半径（px）' })
    magnetRange: number = 80;

    /** 每秒自动回复 HP（GDD：每秒自动恢复 1 点） */
    @property({ tooltip: '每秒自动回复 HP' })
    regenPerSecond: number = 1;

    /**
     * 面朝方向（移动方向的单位向量，默认正右）。
     * 寒冰掌等前方系武器使用：WeaponSystem.facing（弧度，0 = 正右）
     * 由本属性在每帧移动时派生同步（getComponent(WeaponSystem) 直取）。
     */
    public facing: cc.Vec3 = cc.v3(1, 0, 0);

    /** 地图矩形边界（半宽，以世界原点为中心） */
    @property({ tooltip: '地图半宽（px）' })
    mapHalfWidth: number = 1800;

    /** 地图矩形边界（半高） */
    @property({ tooltip: '地图半高（px）' })
    mapHalfHeight: number = 1800;

    /**
     * XP 宝石注册表（由拾取物系统维护）：
     *   生成宝石时调用 PlayerController.registerXpGem(node)，
     *   回收/拾取时调用 unregisterXpGem(node)；
     *   宝石节点需以属性 xpAmount 标记经验值（与碰撞拾取共用同一读取约定）。
     * 注：为减少单帧开销，后续可换用空间哈希/均匀网格（GDD 9.3 实现要点）。
     */
    private static xpGems: cc.Node[] = [];

    private data: PlayerData = new PlayerData();
    private isInvincible: boolean = false;
    private isDead: boolean = false;

    /** 经验系统（应用问心修为回馈倍率×贪婪，统一升级判定） */
    private xpSystem!: XPSystem;

    /** 触摸目标点（Canvas 本地坐标；null 表示未触摸） */
    private touchPos: cc.Vec3 | null = null;

    private regenTimer: number = 0;

    private collider: cc.Collider2D | null = null;
    private sprite: cc.Sprite | null = null;
    private baseColor: cc.Color | null = null;

    // ==================== 静态注册表 ====================

    public static registerXpGem(node: cc.Node): void {
        if (!PlayerController.xpGems.includes(node)) PlayerController.xpGems.push(node);
    }

    public static unregisterXpGem(node: cc.Node): void {
        const i = PlayerController.xpGems.indexOf(node);
        if (i >= 0) PlayerController.xpGems.splice(i, 1);
    }

    public static getXpGems(): cc.Node[] {
        return PlayerController.xpGems;
    }

    // ==================== 生命周期 ====================

    onLoad(): void {
        // 玩家节点命名约定（供 cc.find('Canvas/Player') 兜底查找）
        if (this.node.name !== 'Player') this.node.name = 'Player';

        // 全局注册：问心/升级系统（PlayerRegistry）与敌人索敌（GameManager）共享本局玩家
        PlayerRegistry.bind(this.data);
        GameManager.getInstance().setPlayer(this.node);
        this.xpSystem = new XPSystem(this.data);

        this.sprite = this.getComponent(cc.Sprite);
        this.baseColor = this.sprite ? this.sprite.color.clone() : null;

        this.initTouch();
        this.initCollision();
        this.initEvents();
    }

    update(dt: number): void {
        if (GameManager.getInstance().state !== GameState.PLAYING || this.isDead) return;
        this.handleMovement(dt);
        this.magnetPickup(dt);
        this.updateRegen(dt);
    }

    onDestroy(): void {
        EventBus.off(GameEvent.ENEMY_KILLED, this.onEnemyKilled, this);
        this.unscheduleAllCallbacks();
    }

    // ==================== 触摸移动 ====================

    /**
     * 触摸注册在 Canvas（玩家父节点）上：全屏任意位置可拖拽。
     * 玩家节点需作为 Canvas 的直接子节点（或与 Canvas 同一坐标系）。
     */
    private initTouch(): void {
        const touchTarget = this.node.parent ?? this.node;
        touchTarget.on(cc.Node.EventType.TOUCH_START, this.onTouchStart, this);
        touchTarget.on(cc.Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        touchTarget.on(cc.Node.EventType.TOUCH_END, this.onTouchEnd, this);
        touchTarget.on(cc.Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    private onTouchStart(event: cc.EventTouch): void {
        if (this.isDead) return;
        this.touchPos = this.uiToLocal(event.getUILocation());
    }

    /** 单指拖拽：移动方向 = 触摸点 - 玩家位置 */
    private onTouchMove(event: cc.EventTouch): void {
        if (this.isDead) return;
        this.touchPos = this.uiToLocal(event.getUILocation());
    }

    private onTouchEnd(): void {
        this.touchPos = null; // 松手停步
    }

    /** UI 屏幕坐标 → Canvas 本地坐标（适配屏幕缩放/刘海屏） */
    private uiToLocal(uiPos: cc.Vec2): cc.Vec3 {
        const parent = this.node.parent;
        if (parent) {
            const uiTrans = parent.getComponent(cc.UITransform);
            if (uiTrans) return uiTrans.convertToNodeSpaceAR(cc.v3(uiPos.x, uiPos.y, 0));
        }
        // 兜底：按屏幕像素中心换算
        const size = cc.view.getVisibleSize();
        return cc.v3(uiPos.x - size.width / 2, uiPos.y - size.height / 2, 0);
    }

    private handleMovement(dt: number): void {
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
        this.facing = cc.v3(nx, ny, 0);
        const weaponSystem = this.node.getComponent(WeaponSystem);
        if (weaponSystem) weaponSystem.facing = Math.atan2(ny, nx);

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
        this.collider = this.getComponent(cc.Collider2D);
        if (!this.collider) {
            cc.warnOnce('[Player] 未找到 Collider2D，请为玩家节点添加 BoxCollider2D 并启用 2D 物理');
            return;
        }
        this.collider.setGroup(PhysicsGroups.PLAYER);
        this.collider.setMask(
            PhysicsGroups.ENEMY | PhysicsGroups.ENEMY_BULLET | PhysicsGroups.XP_GEM | PhysicsGroups.GOLD
        );
        this.collider.on(cc.Contact2DType.BEGIN_CONTACT, this.onCollisionEnter, this);
    }

    private onCollisionEnter(
        selfCollider: cc.Collider2D,
        otherCollider: cc.Collider2D,
        contact: cc.IPhysics2DContact | null
    ): void {
        if (this.isDead) return;
        const other = otherCollider.node;
        const group = otherCollider.getGroup();

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
     * 每帧检查磁吸范围内的 XP 宝石：
     *   - pickupRange（80 × 范围倍率）内：向玩家吸附（吸附速度 450px/s）
     *   - 极近距离（14px）内：直接收集（无碰撞体时的兜底拾取）
     */
    private magnetPickup(dt: number): void {
        const radius = this.data.pickupRange; // = magnetRange × area（范围倍率）
        const collectRadius = 14;
        const myPos = this.node.worldPosition;
        const gems = PlayerController.xpGems;

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
                const amount: number = gem['xpAmount'] ?? 1;
                gems.splice(i, 1);
                this.collectXp(amount);
                EventBus.emit(GameEvent.XP_PICKED, { node: gem, amount });
                gem.destroy();
            } else {
                // 向玩家吸附（每帧移动 450px/s）
                const pull = 450 * dt;
                gem.setWorldPosition(gemPos.x + (dx / dist) * pull, gemPos.y + (dy / dist) * pull, gemPos.z);
            }
        }
    }

    // ==================== 伤害 / 死亡 ====================

    /** 受伤：扣血 + 0.5s 无敌帧 + 闪白反馈 */
    public takeDamage(amount: number): void {
        if (this.isInvincible || this.isDead || amount <= 0) return;
        this.data.hp -= amount;
        this.isInvincible = true;
        this.scheduleOnce(() => (this.isInvincible = false), 0.5); // 无敌帧
        this.flashHit();
        EventBus.emit(GameEvent.PLAYER_DAMAGED, { hp: this.data.hp, maxHp: this.data.maxHp, amount });
        if (this.data.hp <= 0) {
            this.data.hp = 0;
            this.die();
        }
    }

    /** 受击闪白 0.1s */
    private flashHit(): void {
        if (!this.sprite) return;
        this.sprite.color = cc.Color.WHITE;
        this.scheduleOnce(() => {
            if (this.sprite && this.baseColor) this.sprite.color = this.baseColor;
        }, 0.1);
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
    }

    /** 击杀妖王（精英）回血 30（GDD 4.2.7） */
    private onEnemyKilled(payload: { type: EnemyType }): void {
        if (payload && payload.type === EnemyType.ELITE) this.heal(30);
    }

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
