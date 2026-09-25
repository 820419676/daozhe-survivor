/**
 * Enemy.ts —— 敌人控制器（挂载到敌人节点）
 *
 * 职责：
 *   - 追踪 AI（小妖/妖王追击；散修保持距离风筝 + 小幅横移；天劫之主追击 + 8 向弹幕）
 *   - 碰撞玩家造成伤害（由 PlayerController.onCollisionEnter 读取 getDamage() 结算）
 *   - 受击闪白 + 击退（精英/Boss 有击退抗性）
 *   - 死亡掉落（XP宝石 / 灵石 / 宝箱，通过 EventBus 事件交给拾取物系统）
 *   - 对象池支持（init 即重置，recycle 归还池中）
 *   - 与玩家距离过远自动回收（控制同屏对象数，配合 Spawner 的 500/300/200 性能分级）
 *
 * 事件（emit）：
 *   - 'ENEMY_KILLED'    { type, node, position, xp, gold }   击杀统计/精英回血/问心签约判定
 *   - 'DROP_XP'         { position, amount }                 经验宝石掉落
 *   - 'DROP_GOLD'       { position, amount }                 灵石掉落
 *   - 'DROP_CHEST'      { position, quality }                宝箱掉落（normal/legendary）
 *   - 'BOSS_PHASE_TWO'  { node }                             天劫之主半血狂暴
 */
import {
    _decorator, Component, Node, Vec3, v3, Sprite, Color,
    Prefab, UITransform, find, instantiate, Graphics,
    UIOpacity, BoxCollider2D, tween, Tween,
} from 'cc';
import { GameManager, GameState } from '../core/GameManager';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GAME_CONFIG } from '../core/GameConfig';
import { DamageNumber } from '../ui/DamageNumber';
import { EnemyType, EnemyConfig } from './EnemyTypes';

const { ccclass, property } = _decorator;

/** 敌方弹幕参数（未配置 bulletPrefab 时由代码生成弹幕节点） */
const BULLET_SPEED = 210;   // 缓慢弹丸：玩家有充足时间走位躲避
const BULLET_LIFETIME = 4;
const BULLET_RADIUS = 7;
/** 弹幕轨迹点生成间隔（秒） */
const BULLET_TRAIL_INTERVAL = 0.12;

/** 冲锋妖兽状态机 */
enum ChargeState {
    CHASE = 0,      // 逼近玩家（等待冲锋冷却）
    TELEGRAPH = 1,  // 红色预警线（0.7s，玩家据此走位）
    CHARGING = 2,   // 高速直线冲锋
    STUNNED = 3,    // 撞墙 / 未命中后眩晕（承受双倍伤害）
}

/**
 * Spawner 句柄（结构化类型，避免 Enemy ↔ Spawner 互相 import 造成循环依赖）。
 * EnemySpawner 天然满足该接口（其 onEnemyRemoved 负责计数与对象池归还）。
 */
export interface EnemySpawnerHandle {
    onEnemyRemoved(enemy: Enemy): void;
    /** 地图半宽（冲锋妖兽撞墙判定用，与生成器边界一致） */
    mapHalfWidth: number;
    /** 地图半高 */
    mapHalfHeight: number;
    /** 分裂：在指定位置生成子体（分裂小妖死亡时由 Enemy.die 调用） */
    spawnSplitChildren?(config: EnemyConfig, position: Vec3, count: number): void;
}

@ccclass('Enemy')
export class Enemy extends Component {
    /** 远程弹幕预制体（散修/天劫之主使用；可留空，留空则不发射） */
    @property({ type: Prefab, tooltip: '远程弹幕预制体（散修/天劫之主使用，可留空）' })
    bulletPrefab: Prefab = null!;

    /** 与玩家距离超过该值自动回收（对象池归还） */
    @property({ tooltip: '与玩家距离超过该值自动回收' })
    despawnRadius: number = 1600;

    // ==================== 运行时状态 ====================

    private config: EnemyConfig | null = null;
    private spawner: EnemySpawnerHandle | null = null;
    private target: Node | null = null;

    private hp: number = 0;
    private maxHp: number = 0;
    private damage: number = 0;
    private moveSpeed: number = 0;
    private knockResistance: number = 0;

    /** 击退速度（指数阻尼衰减） */
    private knockbackVel: Vec3 = v3();
    /** 风筝怪的横移相位 */
    private strafePhase: number = 0;

    /** 弹幕计时器 */
    private shootTimer: number = 0;
    /** 接触攻击计时器（贴身后每隔 attackInterval 造成一次伤害） */
    private attackTimer: number = 0;
    /** 场上属于自己的弹幕（移动/生命周期） */
    private bullets: Node[] = [];
    private bulletVels: Vec3[] = [];
    private bulletLife: number[] = [];
    /** 每颗弹幕的伤害（与 bullets 平行，命中时结算） */
    private bulletDamages: number[] = [];
    /** 每颗弹幕的轨迹计时（与 bullets 平行） */
    private bulletTrailTimers: number[] = [];

    // —— 冲锋妖兽状态 ——
    private chargeState: ChargeState = ChargeState.CHASE;
    /** 当前状态剩余时间（预警 / 眩晕） */
    private chargeTimer: number = 0;
    /** 距下次锁定玩家的时间 */
    private chargeCooldown: number = 0;
    /** 锁定的冲锋方向（预警时确定，之后不再转向 —— 这是"可躲避"的基础） */
    private chargeDir: Vec3 = v3(1, 0, 0);
    private chargeTraveled: number = 0;
    /** 红色预警线节点（冲锋前 0.7s 显示） */
    private chargeWarning: Node | null = null;
    /** 眩晕剩余时间（>0 时承受双倍伤害） */
    private stunTimer: number = 0;
    /** 分裂子体标记（子体不再继续分裂） */
    private isSplitChild: boolean = false;

    // —— 精英火圈技能 ——
    /** 火圈冷却计时 */
    private novaTimer: number = 0;
    /** 火圈预警剩余时间（>0 表示正在预警，期间停止移动） */
    private novaTelegraph: number = 0;
    /** 火圈预警圈节点 */
    private novaWarnNode: Node | null = null;

    // —— 减速（流派天赋「焚天领域」等施加） ——
    private slowTimer: number = 0;
    private slowFactor: number = 1;

    // —— 残影诱饵（流派天赋「流云身法」） ——
    /** 当前残影节点：范围内的敌人会被吸引过去 */
    private static decoy: Node | null = null;
    /** 残影吸引半径（px） */
    private static readonly DECOY_ATTRACT_RANGE = 420;

    /** 设置/清除残影诱饵（御风步冲刺后留下） */
    public static setDecoy(node: Node | null): void {
        Enemy.decoy = node;
    }

    public static clearDecoy(node: Node): void {
        if (Enemy.decoy === node) Enemy.decoy = null;
    }

    // —— 全局移速增益（问心搏问失败：敌人移速 +20%，持续 10 秒） ——
    private static speedBuffMultiplier: number = 1;
    private static speedBuffUntil: number = 0;

    /** 施加全局敌人移速增益（取当前时间点 + 持续秒数；不叠加、覆盖式） */
    public static applyGlobalSpeedBuff(multiplier: number, seconds: number): void {
        const gm = GameManager.getInstance();
        const now = gm ? gm.elapsedTime : 0;
        Enemy.speedBuffMultiplier = multiplier;
        Enemy.speedBuffUntil = now + seconds;
    }

    /** 当前全局移速倍率（过期自动恢复 1） */
    private static getSpeedBuff(): number {
        const gm = GameManager.getInstance();
        const now = gm ? gm.elapsedTime : 0;
        return now < Enemy.speedBuffUntil ? Enemy.speedBuffMultiplier : 1;
    }

    /** 施加减速（取更强的一次，不叠加） */
    public applySlow(seconds: number, factor: number): void {
        if (this.recycled || this.dying) return;
        this.slowTimer = Math.max(this.slowTimer, seconds);
        this.slowFactor = Math.min(this.slowFactor, Math.max(0.1, factor));
    }

    /** 已回收标记（防重复回收/重复回调） */
    private recycled: boolean = false;
    /** 死亡演出中（缩小+淡出，期间冻结 AI 与碰撞） */
    private dying: boolean = false;
    /** 受击闪白中（Graphics 以白色重绘） */
    private flashWhite: boolean = false;
    /** 是否 Boss */
    private isBoss: boolean = false;
    /** Boss 二阶段（半血狂暴） */
    private bossPhaseTwo: boolean = false;

    private sprite: Sprite | null = null;
    private baseColor: Color | null = null;

    // ==================== 战斗系统共享注册表（增量接入） ====================

    /**
     * 场上存活敌人注册表（弹幕索敌/命中检测使用）。
     * 生命周期：init() 登记，recycle()/onDestroy() 注销。
     * 说明：弹幕系统不做物理碰撞（性能考虑，GDD 9.3），
     * 命中判定直接遍历本注册表做距离检测。
     */
    public static alive: Enemy[] = [];

    // ==================== 初始化（对象池语义 = 重置） ====================

    /**
     * 由 EnemySpawner 在取出节点后调用（每次生成必调，等价于对象池 reset）。
     * @param config        敌人配置
     * @param spawner       生成器句柄（死亡/回收时回调计数）
     * @param timeMinutes   当前游戏分钟数，用于数值时间缩放
     * @param hpOverride    覆盖血量（仅 Boss 使用，由 Spawner 按玩家 DPS 估算）
     * @param isSplitChild  是否为分裂子体（子体不再分裂）
     */
    public init(
        config: EnemyConfig,
        spawner: EnemySpawnerHandle,
        timeMinutes: number,
        hpOverride?: number,
        isSplitChild: boolean = false,
    ): void {
        this.config = config;
        this.spawner = spawner;
        this.recycled = false;
        this.isSplitChild = isSplitChild;
        this.isBoss = config.isBoss;
        this.bossPhaseTwo = false;
        this.knockbackVel.set(0, 0, 0);
        this.strafePhase = 0;
        this.shootTimer = 0;
        this.attackTimer = 0.4; // 接触后 0.4s 才首次造成伤害，给玩家反应时间
        // 冲锋状态复位（首次冲锋略早于常规间隔，让玩家尽快看到"可反制的敌人"）
        this.chargeState = ChargeState.CHASE;
        this.chargeTimer = 0;
        this.chargeCooldown = config.chargeSkill ? config.chargeSkill.interval * 0.6 : 0;
        this.chargeTraveled = 0;
        this.stunTimer = 0;
        this.novaTimer = config.novaSkill ? config.novaSkill.interval * 0.5 : 0;
        this.novaTelegraph = 0;
        this.slowTimer = 0;
        this.slowFactor = 1;
        this.destroyChargeWarning();
        this.clearNovaWarning();
        this.unscheduleAllCallbacks();
        this.clearBullets();

        // —— 数值时间缩放（GDD 4.4 敌人曲线） ——
        let scaledHp = config.hp;
        if (hpOverride !== undefined) {
            // Boss：血量由生成器按玩家 DPS 动态定标
            scaledHp = hpOverride;
        } else if (config.type === EnemyType.ELITE) {
            // 妖王：1500 起，+12%/分钟
            scaledHp = config.hp * (1 + 0.12 * timeMinutes);
        } else {
            // 普通怪：20 × 1.35^分钟
            scaledHp = config.hp * Math.pow(1.35, timeMinutes);
        }
        this.maxHp = Math.round(scaledHp);
        this.hp = this.maxHp;
        // 伤害轻量缩放（+5%/分钟，15 分钟约 1.75 倍）
        this.damage = Math.round(config.damage * (1 + 0.05 * timeMinutes));
        // 移速轻量缩放（封顶 +40%）
        this.moveSpeed = config.speed * (1 + Math.min(0.02 * timeMinutes, 0.4));
        this.knockResistance = config.knockResistance;

        // —— 显示重置 ——
        this.node.active = true;
        this.node.setScale(1, 1, 1);
        this.dying = false;
        this.flashWhite = false;
        Tween.stopAllByTarget(this.node); // 取消残留的死亡演出 tween
        const op = this.getComponent(UIOpacity);
        if (op) {
            op.opacity = 255;
            Tween.stopAllByTarget(op);
        }
        const col = this.getComponent(BoxCollider2D);
        if (col) col.enabled = true; // 死亡演出期间会临时禁用
        const ui = this.node.getComponent(UITransform);
        if (ui) ui.setContentSize(config.size, config.size); // 体型
        this.sprite = this.getComponent(Sprite);
        this.baseColor = config.color;
        if (this.sprite) this.sprite.color = config.color;   // 按类型染色（兼容预制体路径）
        this.redraw(); // 分型绘制（菱形/三角/六边形 + 双眼 + 头顶血条）

        // 登记到战斗系统存活注册表（防重入：同一实例不重复登记）
        if (Enemy.alive.indexOf(this) < 0) Enemy.alive.push(this);
    }

    /** 碰撞半径（px，弹幕命中判定用；等于体型 size 的一半） */
    public getRadius(): number {
        return this.config ? this.config.size / 2 : 12;
    }

    /** 设置追踪目标（由 Spawner 传入玩家节点；未设置时自动查找） */
    public setTarget(node: Node | null): void {
        this.target = node;
    }

    /** 当前伤害值（PlayerController 碰撞结算时读取） */
    public getDamage(): number {
        return this.damage;
    }

    /** 当前敌人类型（Spawner 计数/事件分发使用） */
    public getType(): EnemyType | null {
        return this.config ? this.config.type : null;
    }

    // ==================== 帧更新 ====================

    update(dt: number): void {
        if (GameManager.getInstance().state !== GameState.PLAYING) return; // 暂停时冻结全场
        if (!this.config || this.recycled || this.dying) return;

        if (this.slowTimer > 0) {
            this.slowTimer -= dt;
            if (this.slowTimer <= 0) this.slowFactor = 1;
        }

        // 精英火圈预警期间停止移动 —— 这段时间正是玩家走出圈子的窗口
        if (this.novaTelegraph > 0) {
            const nova = this.config.novaSkill!;
            this.novaTelegraph -= dt;
            this.updateNovaWarning(1 - Math.max(0, this.novaTelegraph) / nova.telegraph);
            if (this.novaTelegraph <= 0) this.explodeNova();
        } else if (this.config.chargeSkill && !this.isSplitChild) {
            // 冲锋妖兽走独立状态机（逼近 → 预警 → 冲锋 → 眩晕），其余走标准追击
            this.updateChargeBrain(dt);
        } else {
            this.updateMove(dt);
        }
        this.updateNovaCooldown(dt);
        this.updateMeleeAttack(dt);
        this.updateShoot(dt);
        this.updateBullets(dt);
        this.checkDespawn();
    }

    // ==================== 精英火圈（有预警、可走位躲避） ====================

    /** 火圈冷却：玩家在射程内才起手，避免对着空气放技能 */
    private updateNovaCooldown(dt: number): void {
        const nova = this.config?.novaSkill;
        if (!nova || this.novaTelegraph > 0) return;
        this.novaTimer -= dt;
        if (this.novaTimer > 0) return;
        if (!this.findTarget()) return;
        const dist = Vec3.distance(this.node.worldPosition, this.target!.worldPosition);
        if (dist > nova.radius + 160) return;
        this.novaTimer = nova.interval;
        this.novaTelegraph = nova.telegraph;
    }

    /** 火圈爆发：圈内玩家受伤（预警 0.9s 足够走出 210px 半径） */
    private explodeNova(): void {
        const nova = this.config?.novaSkill;
        this.novaTelegraph = 0;
        this.clearNovaWarning();
        if (!nova || !this.findTarget()) return;

        const dist = Vec3.distance(this.node.worldPosition, this.target!.worldPosition);
        if (dist <= nova.radius + GAME_CONFIG.player.hitRadius) {
            EventBus.emit(GameEvent.ENEMY_ATTACK, {
                damage: Math.round(this.damage * nova.damageMultiplier),
                kind: 'nova',
            });
        }
        // 爆发视觉：白色扩散圆环（复用击杀圆环）
        DamageNumber.ring(this.node.worldPosition.clone());
    }

    /** 火圈预警圈：危险区填充 + 从外圈收缩的黄色倒计时环 */
    private updateNovaWarning(progress: number): void {
        const nova = this.config?.novaSkill;
        const parent = this.node.parent;
        if (!nova || !parent) return;

        if (!this.novaWarnNode || !this.novaWarnNode.isValid) {
            const n = new Node('NovaWarning');
            n.setParent(parent);
            n.addComponent(UITransform).setContentSize(nova.radius * 2, nova.radius * 2);
            n.addComponent(Graphics);
            this.novaWarnNode = n;
        }
        const g = this.novaWarnNode.getComponent(Graphics);
        if (!g) return;
        const r = nova.radius;
        const p = Math.max(0, Math.min(1, progress));

        g.clear();
        // 危险区填充（随预警进度加深）
        g.fillColor = new Color(255, 70, 40, Math.round(35 + 95 * p));
        g.circle(0, 0, r);
        g.fill();
        // 范围外圈
        g.lineWidth = 4;
        g.strokeColor = new Color(255, 90, 60, 225);
        g.circle(0, 0, r);
        g.stroke();
        // 收缩倒计时环
        g.lineWidth = 5;
        g.strokeColor = new Color(255, 230, 120, 240);
        g.circle(0, 0, r * (1 - p) + 12);
        g.stroke();

        this.novaWarnNode.setPosition(this.node.position.x, this.node.position.y, 0);
        this.novaWarnNode.active = true;
    }

    /** 销毁火圈预警节点 */
    private clearNovaWarning(): void {
        if (this.novaWarnNode && this.novaWarnNode.isValid) this.novaWarnNode.destroy();
        this.novaWarnNode = null;
    }

    // ==================== 冲锋妖兽（有预警、可躲避、撞墙可反打） ====================

    /**
     * 冲锋状态机：
     *   逼近（每 7 秒）→ 锁定玩家当前位置 → 红色预警线 0.7s → 高速直线冲锋
     *   → 撞墙或未命中则眩晕 1s（承受双倍伤害），命中玩家则直接进入下一轮冷却。
     * 方向在预警时锁定、冲锋中不再转向 —— 玩家横向移动或御风步即可躲开。
     */
    private updateChargeBrain(dt: number): void {
        const skill = this.config!.chargeSkill;
        if (!skill) {
            this.updateMove(dt);
            return;
        }

        // 眩晕：不移动、不预警，且承受双倍伤害（见 takeDamage）
        if (this.stunTimer > 0) {
            this.stunTimer -= dt;
            this.updateChargeWarning(-1);
            if (this.stunTimer <= 0) {
                this.chargeState = ChargeState.CHASE;
                this.redraw(); // 移除眩晕环
            }
            return;
        }

        switch (this.chargeState) {
            case ChargeState.CHASE: {
                this.updateMove(dt);
                this.chargeCooldown -= dt;
                if (this.chargeCooldown > 0) break;
                if (!this.findTarget()) break;
                const dx = this.target!.worldPosition.x - this.node.worldPosition.x;
                const dy = this.target!.worldPosition.y - this.node.worldPosition.y;
                const distSq = dx * dx + dy * dy;
                if (distSq > 720 * 720 || distSq < 1) break; // 太远不冲锋
                // 锁定玩家当前位置（冲锋方向不再追踪，玩家因此可以躲）
                this.chargeDir = v3(dx, dy, 0).normalize();
                this.chargeTimer = skill.telegraph;
                this.chargeState = ChargeState.TELEGRAPH;
                break;
            }

            case ChargeState.TELEGRAPH: {
                this.chargeTimer -= dt;
                const progress = 1 - Math.max(0, this.chargeTimer / skill.telegraph);
                this.updateChargeWarning(progress); // 预警线随进度长满
                if (this.chargeTimer <= 0) {
                    this.chargeState = ChargeState.CHARGING;
                    this.chargeTraveled = 0;
                    this.attackTimer = 0; // 冲锋接触立即结算伤害
                    this.updateChargeWarning(-1);
                }
                break;
            }

            case ChargeState.CHARGING: {
                const step = skill.speed * dt;
                const pos = this.node.position;
                const halfW = this.spawner ? this.spawner.mapHalfWidth : 950;
                const halfH = this.spawner ? this.spawner.mapHalfHeight : 950;
                let nx = pos.x + this.chargeDir.x * step;
                let ny = pos.y + this.chargeDir.y * step;
                let hitWall = false;
                // 撞墙判定：地图边界（被钳制即视为撞墙）
                if (nx < -halfW || nx > halfW) {
                    nx = Math.min(Math.max(nx, -halfW), halfW);
                    hitWall = true;
                }
                if (ny < -halfH || ny > halfH) {
                    ny = Math.min(Math.max(ny, -halfH), halfH);
                    hitWall = true;
                }
                this.node.setPosition(nx, ny, pos.z);
                this.chargeTraveled += step;

                if (this.isTouchingPlayer()) {
                    // 命中玩家：冲锋成功，直接进入下一轮冷却（不眩晕）
                    this.chargeState = ChargeState.CHASE;
                    this.chargeCooldown = skill.interval;
                } else if (hitWall || this.chargeTraveled >= skill.maxDistance) {
                    // 撞墙 / 冲空：眩晕，期间承受双倍伤害 —— 玩家的反击窗口
                    this.enterStun(skill.stun);
                }
                break;
            }

            case ChargeState.STUNNED:
                break;
        }
    }

    /** 进入眩晕（撞墙/未命中）：停止移动，期间承受双倍伤害 */
    private enterStun(seconds: number): void {
        const skill = this.config?.chargeSkill;
        this.chargeState = ChargeState.STUNNED;
        this.stunTimer = Math.max(0.1, seconds);
        this.chargeCooldown = skill ? skill.interval : 0;
        this.updateChargeWarning(-1);
        this.redraw(); // 眩晕环视觉
    }

    /** 是否与玩家接触（冲锋命中判定；与接触攻击同一套距离口径） */
    private isTouchingPlayer(): boolean {
        if (!this.target || !this.target.isValid) return false;
        const reach = this.getRadius() + GAME_CONFIG.player.hitRadius;
        return Vec3.squaredDistance(this.node.worldPosition, this.target.worldPosition) <= reach * reach;
    }

    /** 更新红色冲锋预警线（progress < 0 表示隐藏） */
    private updateChargeWarning(progress: number): void {
        const skill = this.config?.chargeSkill;
        const parent = this.node.parent;
        if (!skill || !parent) return;

        if (progress < 0) {
            if (this.chargeWarning && this.chargeWarning.isValid) this.chargeWarning.active = false;
            return;
        }

        if (!this.chargeWarning || !this.chargeWarning.isValid) {
            const n = new Node('ChargeWarning');
            n.setParent(parent);
            n.addComponent(UITransform).setContentSize(skill.maxDistance, skill.warningWidth);
            n.addComponent(Graphics);
            this.chargeWarning = n;
        }
        const g = this.chargeWarning.getComponent(Graphics);
        if (!g) return;
        const len = skill.maxDistance;
        const w = skill.warningWidth;
        g.clear();
        // 底面警示带
        g.fillColor = new Color(255, 60, 60, 55);
        g.rect(0, -w / 2, len, w);
        g.fill();
        // 进度填充（0 → 长满 = 即将冲锋）
        g.fillColor = new Color(255, 60, 60, 135);
        g.rect(0, -w / 2, len * Math.max(0, Math.min(1, progress)), w);
        g.fill();
        // 描边
        g.lineWidth = 3;
        g.strokeColor = new Color(255, 96, 96, 220);
        g.rect(0, -w / 2, len, w);
        g.stroke();

        this.chargeWarning.setPosition(this.node.position.x, this.node.position.y, 0);
        this.chargeWarning.angle = (Math.atan2(this.chargeDir.y, this.chargeDir.x) * 180) / Math.PI;
        this.chargeWarning.active = true;
    }

    /** 销毁预警线节点（回收/复位时调用） */
    private destroyChargeWarning(): void {
        if (this.chargeWarning && this.chargeWarning.isValid) {
            this.chargeWarning.destroy();
        }
        this.chargeWarning = null;
    }

    // ==================== 接触攻击 ====================

    /**
     * 接触攻击：贴身时按 attackInterval 造成伤害（实际频率受玩家无敌帧限制）。
     * 走 ENEMY_ATTACK 事件而非直接调用玩家组件，避免 Enemy ↔ PlayerController 循环依赖；
     * 判定为距离检测（代码驱动），不依赖 2D 物理系统的碰撞回调。
     */
    private updateMeleeAttack(dt: number): void {
        const cfg = this.config;
        if (!cfg) return;
        this.attackTimer -= dt;
        if (this.attackTimer > 0) return;
        if (!this.findTarget()) return;
        const reach = this.getRadius() + GAME_CONFIG.player.hitRadius;
        if (Vec3.squaredDistance(this.node.worldPosition, this.target!.worldPosition) > reach * reach) return;
        this.attackTimer = Math.max(0.2, cfg.attackInterval);
        EventBus.emit(GameEvent.ENEMY_ATTACK, { damage: this.damage, kind: 'melee' });
    }

    // ==================== 移动 AI ====================

    private updateMove(dt: number): void {
        // 击退速度（指数阻尼，8/s 衰减）
        if (this.knockbackVel.lengthSqr() > 0.0001) {
            const pos = this.node.position;
            this.node.setPosition(pos.x + this.knockbackVel.x * dt, pos.y + this.knockbackVel.y * dt, pos.z);
            this.knockbackVel.multiplyScalar(Math.exp(-8 * dt));
        }
        if (!this.findTarget()) return;

        const myPos = this.node.worldPosition;
        const pPos = this.target!.worldPosition;
        const dx = pPos.x - myPos.x;
        const dy = pPos.y - myPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return;

        const cfg = this.config!;
        const isKiter = cfg.canShoot && cfg.type !== EnemyType.BOSS; // 散修风筝；Boss 贴脸追击
        let moveDir: Vec3;

        if (isKiter) {
            // 散修：保持 260px 攻击距离（太近后撤，太远靠近）+ 正弦横移走位
            const desired = 260;
            const radial = dist > desired + 40 ? 1 : dist < desired - 60 ? -1 : 0;
            const dir = v3(dx / dist, dy / dist, 0);
            const perp = v3(-dir.y, dir.x, 0);
            this.strafePhase += dt * 1.5;
            moveDir = v3(
                dir.x * radial + perp.x * Math.sin(this.strafePhase) * 0.6,
                dir.y * radial + perp.y * Math.sin(this.strafePhase) * 0.6,
                0
            );
        } else {
            // 小妖/妖王/天劫之主：直线追击（Boss 二阶段加一点横移走位）
            const dir = v3(dx / dist, dy / dist, 0);
            moveDir = dir.clone();
            if (this.isBoss && this.bossPhaseTwo) {
                const perp = v3(-dir.y, dir.x, 0);
                this.strafePhase += dt * 0.8;
                moveDir = v3(
                    dir.x + perp.x * Math.sin(this.strafePhase) * 0.4,
                    dir.y + perp.y * Math.sin(this.strafePhase) * 0.4,
                    0
                );
            }
        }

        const len = Math.max(0.1, moveDir.length());
        moveDir.multiplyScalar(1 / len);
        const pos = this.node.position;
        // 减速（烈焰环「焚天领域」）与全局移速增益（问心搏问失败）只作用于常规移动，
        // 不影响冲锋技能速度
        const slow = this.slowTimer > 0 ? this.slowFactor : 1;
        const step = this.moveSpeed * dt * slow * Enemy.getSpeedBuff();
        this.node.setPosition(pos.x + moveDir.x * step, pos.y + moveDir.y * step, pos.z);
    }

    /** 获取追踪目标（残影诱饵 > Spawner 传入 > GameManager > 路径查找） */
    private findTarget(): boolean {
        // 残影诱饵（流云身法）：范围内的敌人优先扑向残影
        const decoy = Enemy.decoy;
        if (decoy && decoy.isValid) {
            const dd = Vec3.squaredDistance(this.node.worldPosition, decoy.worldPosition);
            if (dd <= Enemy.DECOY_ATTRACT_RANGE * Enemy.DECOY_ATTRACT_RANGE) {
                this.target = decoy;
                return true;
            }
        }
        if (this.target && this.target.isValid) return true;
        this.target = GameManager.getInstance().getPlayer(); // 契约：getPlayer(): Node | null
        if (!this.target || !this.target.isValid) {
            this.target = find('Canvas/Player'); // 兜底查找
        }
        return !!this.target && this.target.isValid;
    }

    // ==================== 远程弹幕 ====================

    private updateShoot(dt: number): void {
        const cfg = this.config;
        if (!cfg || !cfg.canShoot) return;
        this.shootTimer -= dt;
        if (this.shootTimer > 0) return;
        if (!this.findTarget()) return;

        // 二阶段狂暴：射速 ×1.67（间隔 ×0.6）
        this.shootTimer = cfg.shootInterval * (this.bossPhaseTwo ? 0.6 : 1);

        if (cfg.type === EnemyType.BOSS) {
            // 天劫之主：8 向弹幕（GDD 7.4 阶段行为）
            for (let i = 0; i < 8; i++) this.fireBullet((Math.PI * 2 * i) / 8);
        } else {
            // 散修：指向玩家单发
            const myPos = this.node.worldPosition;
            const pPos = this.target!.worldPosition;
            this.fireBullet(Math.atan2(pPos.y - myPos.y, pPos.x - myPos.x));
        }
    }

    /**
     * 发射一颗弹幕：优先使用 bulletPrefab，未配置时程序化生成，
     * 保证散修 / 天劫之主始终有攻击手段（此前缺预制体时弹幕完全不发射）。
     * 命中判定见 updateBullets（距离检测，不依赖 2D 物理碰撞矩阵）。
     */
    private fireBullet(angle: number): void {
        const parent = this.node.parent;
        if (!parent) return;

        const bullet = this.bulletPrefab
            ? instantiate(this.bulletPrefab)
            : this.createProceduralBullet();
        parent.addChild(bullet);
        bullet.setWorldPosition(this.node.worldPosition);
        bullet['bulletDamage'] = this.damage; // 兼容旧的物理碰撞读取约定

        this.bullets.push(bullet);
        this.bulletVels.push(v3(Math.cos(angle), Math.sin(angle), 0).multiplyScalar(BULLET_SPEED));
        this.bulletLife.push(BULLET_LIFETIME);
        this.bulletDamages.push(this.damage);
        this.bulletTrailTimers.push(0);
    }

    /** 程序化弹幕（紫色灵光弹）：带地面阴影，便于判断落点与轨迹 */
    private createProceduralBullet(): Node {
        const bullet = new Node('EnemyBullet');
        bullet.addComponent(UITransform).setContentSize(BULLET_RADIUS * 4, BULLET_RADIUS * 4);
        const g = bullet.addComponent(Graphics);
        // 地面阴影（偏移下方，暗示高度与落点）
        g.fillColor = new Color(30, 10, 60, 90);
        g.ellipse(0, -BULLET_RADIUS - 4, BULLET_RADIUS * 1.3, BULLET_RADIUS * 0.55);
        g.fill();
        // 外圈柔光
        g.fillColor = new Color(186, 120, 255, 70);
        g.circle(0, 0, BULLET_RADIUS + 4);
        g.fill();
        // 弹体
        g.fillColor = new Color(198, 138, 255, 255);
        g.circle(0, 0, BULLET_RADIUS);
        g.fill();
        // 白色描边
        g.lineWidth = 2;
        g.strokeColor = new Color(255, 255, 255, 200);
        g.circle(0, 0, BULLET_RADIUS);
        g.stroke();
        return bullet;
    }

    /** 生成一个轨迹残影（0.35s 淡出），让弹幕"有明显轨迹" */
    private spawnBulletTrail(parent: Node, pos: Vec3): void {
        const dot = new Node('BulletTrail');
        parent.addChild(dot);
        dot.setWorldPosition(pos);
        dot.addComponent(UITransform).setContentSize(BULLET_RADIUS * 2, BULLET_RADIUS * 2);
        const g = dot.addComponent(Graphics);
        g.fillColor = new Color(198, 138, 255, 150);
        g.circle(0, 0, BULLET_RADIUS * 0.7);
        g.fill();
        const op = dot.addComponent(UIOpacity);
        op.opacity = 170;
        tween(op)
            .to(0.35, { opacity: 0 })
            .call(() => {
                if (dot.isValid) dot.destroy();
            })
            .start();
    }

    /** 驱动弹幕移动、轨迹、命中玩家判定与生命周期 */
    private updateBullets(dt: number): void {
        const target = this.target && this.target.isValid ? this.target : null;
        const hitRadius = BULLET_RADIUS + GAME_CONFIG.player.hitRadius;
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            const v = this.bulletVels[i];
            this.bulletLife[i] -= dt;
            const overRange = Math.abs(b.position.x) > 4000 || Math.abs(b.position.y) > 4000;
            if (!b.isValid || this.bulletLife[i] <= 0 || overRange) {
                if (b.isValid) b.destroy();
                this.removeBulletAt(i);
                continue;
            }
            b.setPosition(b.position.x + v.x * dt, b.position.y + v.y * dt, 0);

            // 轨迹残影（低频生成，控制节点数量）
            this.bulletTrailTimers[i] -= dt;
            if (this.bulletTrailTimers[i] <= 0 && b.parent) {
                this.bulletTrailTimers[i] = BULLET_TRAIL_INTERVAL;
                this.spawnBulletTrail(b.parent, b.worldPosition.clone());
            }

            // 命中玩家：距离判定 + 广播 ENEMY_ATTACK（不依赖 2D 物理）
            if (target && Vec3.squaredDistance(b.worldPosition, target.worldPosition) <= hitRadius * hitRadius) {
                EventBus.emit(GameEvent.ENEMY_ATTACK, {
                    damage: this.bulletDamages[i] ?? this.damage,
                    kind: 'bullet',
                });
                b.destroy();
                this.removeBulletAt(i);
            }
        }
    }

    /** 移除第 i 颗弹幕的全部平行记录 */
    private removeBulletAt(i: number): void {
        this.bullets.splice(i, 1);
        this.bulletVels.splice(i, 1);
        this.bulletLife.splice(i, 1);
        this.bulletDamages.splice(i, 1);
        this.bulletTrailTimers.splice(i, 1);
    }

    private clearBullets(): void {
        for (const b of this.bullets) if (b.isValid) b.destroy();
        this.bullets.length = 0;
        this.bulletVels.length = 0;
        this.bulletLife.length = 0;
        this.bulletDamages.length = 0;
        this.bulletTrailTimers.length = 0;
    }

    // ==================== 受击 ====================

    /**
     * 受到伤害（武器系统调用）。
     * @param amount   伤害数值
     * @param knockDir 击退方向（单位向量），不传则无击退
     * @returns 实际结算的伤害（0 = 被忽略，如已死亡）；眩晕中的冲锋妖兽承受双倍伤害
     */
    public takeDamage(amount: number, knockDir?: Vec3): number {
        if (this.recycled || this.dying || !this.config) return 0;
        // 眩晕（撞墙/冲锋未命中）期间承受双倍伤害：这是玩家"反打"的收益
        const multiplier = this.stunTimer > 0 ? 2 : 1;
        const applied = Math.max(1, Math.round(amount * multiplier));
        this.hp -= applied;
        this.flashHit(); // 受击闪白（Graphics 重绘）
        this.redraw();   // 同步刷新头顶血条

        // 击退（精英/Boss 抗性高）
        if (knockDir && knockDir.lengthSqr() > 0.0001) {
            const force = 260 * (1 - this.knockResistance);
            this.knockbackVel.set(knockDir.x * force, knockDir.y * force, 0);
        }

        if (this.hp <= 0) {
            this.die();
        } else if (this.isBoss && !this.bossPhaseTwo && this.hp <= this.maxHp * 0.5) {
            // 天劫之主半血进入二阶段：狂暴（GDD 7.4 P2 冲刺+全屏雷暴，雷暴演出由技能系统实现）
            this.bossPhaseTwo = true;
            this.moveSpeed *= 1.3;
            EventBus.emit(GameEvent.BOSS_PHASE_TWO, { node: this.node });
        }
        return applied;
    }

    /** 受击闪白（0.08s 后恢复基础色；Graphics 与 Sprite 双路径） */
    private flashHit(): void {
        this.flashWhite = true;
        this.redraw();
        if (this.sprite) this.sprite.color = Color.WHITE;
        this.scheduleOnce(() => {
            this.flashWhite = false;
            if (this.recycled || this.dying) return; // 已回收/死亡不再重绘
            this.redraw();
            if (this.sprite && this.baseColor) this.sprite.color = this.baseColor;
        }, 0.08);
    }

    // ==================== 占位视觉（Graphics 分型绘制） ====================

    /** 重绘敌人：按类型绘制菱形 / 三角 / 六边形 + 双眼 + 头顶绿色血条 */
    private redraw(): void {
        const graphics = this.getComponent(Graphics);
        if (!graphics || !this.config) return;
        graphics.clear();
        const r = this.config.size / 2;
        const body = this.flashWhite
            ? new Color(255, 255, 255, 255)
            : this.config.color;
        switch (this.config.type) {
            case EnemyType.RANGED:
                this.drawTriangle(graphics, r, body);
                break;
            case EnemyType.ELITE:
            case EnemyType.BOSS:
                this.drawHexagon(graphics, r, body);
                break;
            default:
                this.drawDiamond(graphics, r, body);
                break;
        }
        if (!this.flashWhite) this.drawEyes(graphics, r);
        this.drawHealthBar(graphics);
        if (this.stunTimer > 0) this.drawStunRing(graphics, r);
    }

    /** 眩晕标识（头顶黄色星环）：提示"现在是反击窗口，承伤翻倍" */
    private drawStunRing(g: Graphics, r: number): void {
        g.lineWidth = 3;
        g.strokeColor = new Color(255, 216, 90, 235);
        g.circle(0, r + 22, Math.max(5, r * 0.28));
        g.stroke();
    }

    /** 普通怪：红色菱形 */
    private drawDiamond(g: Graphics, r: number, color: Color): void {
        g.fillColor = color;
        g.moveTo(0, r); g.lineTo(r, 0); g.lineTo(0, -r); g.lineTo(-r, 0); g.close();
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = new Color(255, 255, 255, 90);
        g.moveTo(0, r); g.lineTo(r, 0); g.lineTo(0, -r); g.lineTo(-r, 0); g.close();
        g.stroke();
    }

    /** 远程怪：紫色三角形 */
    private drawTriangle(g: Graphics, r: number, color: Color): void {
        g.fillColor = color;
        g.moveTo(0, r * 1.1);
        g.lineTo(r * 0.95, -r * 0.8);
        g.lineTo(-r * 0.95, -r * 0.8);
        g.close();
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = new Color(255, 255, 255, 90);
        g.moveTo(0, r * 1.1);
        g.lineTo(r * 0.95, -r * 0.8);
        g.lineTo(-r * 0.95, -r * 0.8);
        g.close();
        g.stroke();
    }

    /** 精英 / Boss：橙红六边形（Boss 额外加一圈强调环） */
    private drawHexagon(g: Graphics, r: number, color: Color): void {
        const pts: [number, number][] = [];
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            pts.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
        g.fillColor = color;
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < 6; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.close();
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = new Color(255, 255, 255, 110);
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < 6; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.close();
        g.stroke();
        if (this.config && this.config.isBoss) {
            g.lineWidth = 2;
            g.strokeColor = new Color(255, 255, 255, 70);
            g.circle(0, 0, r + 8);
            g.stroke();
        }
    }

    /** 白色眼睛（普通/精英两只；远程一只） */
    private drawEyes(g: Graphics, r: number): void {
        g.fillColor = new Color(255, 255, 255, 255);
        if (this.config && this.config.type === EnemyType.RANGED) {
            g.circle(0, r * 0.15, Math.max(2, r * 0.14));
        } else {
            g.circle(-r * 0.28, r * 0.12, Math.max(2, r * 0.13));
            g.circle(r * 0.28, r * 0.12, Math.max(2, r * 0.13));
        }
        g.fill();
    }

    /** 在菱形妖物上方补绘一个极简血条，MVP 中让伤害与击杀因果可见。 */
    private drawHealthBar(graphics: Graphics): void {
        if (!this.config || this.maxHp <= 0) return;
        const r = this.config.size / 2;
        const width = Math.max(26, this.config.size);
        const ratio = Math.max(0, Math.min(1, this.hp / this.maxHp));
        graphics.fillColor = new Color(25, 18, 28, 220);
        graphics.rect(-width / 2, r + 8, width, 5);
        graphics.fill();
        graphics.fillColor = new Color(102, 235, 137, 255);
        graphics.rect(-width / 2, r + 8, width * ratio, 5);
        graphics.fill();
    }

    // ==================== 死亡 / 掉落 / 回收 ====================

    private die(): void {
        if (this.dying) return;
        this.dying = true;
        const pos = this.node.worldPosition.clone();
        const cfg = this.config!;
        this.rollDrops(pos, cfg);
        EventBus.emit(GameEvent.ENEMY_KILLED, {
            type: cfg.type,
            node: this.node,
            position: pos,
            xp: cfg.xpDrop,
            gold: cfg.goldDrop,
        });
        // 分裂小妖：死亡后分裂为子体（子体不再分裂）—— 高收益但包围圈会扩大
        if (cfg.splitsInto && cfg.splitsInto > 0 && !this.isSplitChild && this.spawner?.spawnSplitChildren) {
            this.spawner.spawnSplitChildren(cfg, pos, cfg.splitsInto);
        }
        this.updateChargeWarning(-1);
        this.playDeathAnimation();
    }

    /**
     * 死亡演出：0.25s 缩小 + 淡出，随后回收入池（验收：死亡时缩小并淡出）。
     * 演出期间禁用碰撞体并冻结 AI，避免对已死敌人二次结算。
     */
    private playDeathAnimation(): void {
        const col = this.getComponent(BoxCollider2D);
        if (col) col.enabled = false;
        const op = this.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);
        op.opacity = 255;
        Tween.stopAllByTarget(this.node);
        Tween.stopAllByTarget(op);
        this.node.setScale(1, 1, 1);
        tween(op)
            .to(0.25, { opacity: 0 })
            .start();
        tween(this.node)
            .to(0.25, { scale: new Vec3(0.1, 0.1, 1) }, { easing: 'quadIn' })
            .call(() => this.recycle())
            .start();
    }

    /** 掉落结算（通过事件交给拾取物系统生成宝石/灵石/宝箱） */
    private rollDrops(pos: Vec3, cfg: EnemyConfig): void {
        // XP 宝石（蓝=1 / 紫=5，GDD 4.2.3）
        EventBus.emit(GameEvent.DROP_XP, { position: pos, amount: cfg.xpDrop });
        // 灵石
        if (cfg.goldDrop > 0) EventBus.emit(GameEvent.DROP_GOLD, { position: pos, amount: cfg.goldDrop });
        // 宝箱：普通怪 0.5%，妖王/天劫之主 100%（GDD 4.2.6）
        if (cfg.chestDropRate > 0 && Math.random() < cfg.chestDropRate) {
            EventBus.emit(GameEvent.DROP_CHEST, { position: pos, quality: cfg.isBoss ? 'legendary' : 'normal' });
        }
    }

    /**
     * 回收（对象池归还）：清理弹幕 → 通知 Spawner 计数 → 隐藏节点 → 入池。
     * 死亡与超距静默回收共用此路径；对象池 get 后由 init() 完成重置。
     */
    public recycle(): void {
        if (this.recycled) return;
        this.recycled = true;
        this.destroyChargeWarning(); // 预警线是独立节点，必须一并清理
        this.clearNovaWarning();
        this.clearBullets();
        this.target = null;
        // 注销战斗系统注册表
        const idx = Enemy.alive.indexOf(this);
        if (idx >= 0) Enemy.alive.splice(idx, 1);
        if (this.spawner) this.spawner.onEnemyRemoved(this); // Spawner 负责计数 + NodePool.put
        this.node.active = false;
    }

    /** 与玩家距离过远 → 静默回收（维持同屏对象数，配合性能分级） */
    private checkDespawn(): void {
        if (!this.target || !this.target.isValid) return;
        if (Vec3.distance(this.node.worldPosition, this.target.worldPosition) > this.despawnRadius) {
            this.recycle();
        }
    }

    onDestroy(): void {
        // 注销战斗系统注册表（节点被直接销毁时兜底）
        const idx = Enemy.alive.indexOf(this);
        if (idx >= 0) Enemy.alive.splice(idx, 1);
        this.destroyChargeWarning();
        this.clearNovaWarning();
        this.clearBullets();
    }
}
