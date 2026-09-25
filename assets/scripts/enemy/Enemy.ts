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
    Prefab, UITransform, find, warn, instantiate, Graphics,
    UIOpacity, BoxCollider2D, tween, Tween,
} from 'cc';
import { GameManager, GameState } from '../core/GameManager';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { EnemyType, EnemyConfig } from './EnemyTypes';

const { ccclass, property } = _decorator;

/**
 * Spawner 句柄（结构化类型，避免 Enemy ↔ Spawner 互相 import 造成循环依赖）。
 * EnemySpawner 天然满足该接口（其 onEnemyRemoved 负责计数与对象池归还）。
 */
export interface EnemySpawnerHandle {
    onEnemyRemoved(enemy: Enemy): void;
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
    /** 场上属于自己的弹幕（移动/生命周期） */
    private bullets: Node[] = [];
    private bulletVels: Vec3[] = [];
    private bulletLife: number[] = [];

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
     */
    public init(config: EnemyConfig, spawner: EnemySpawnerHandle, timeMinutes: number, hpOverride?: number): void {
        this.config = config;
        this.spawner = spawner;
        this.recycled = false;
        this.isBoss = config.isBoss;
        this.bossPhaseTwo = false;
        this.knockbackVel.set(0, 0, 0);
        this.strafePhase = 0;
        this.shootTimer = 0;
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

        this.updateMove(dt);
        this.updateShoot(dt);
        this.updateBullets(dt);
        this.checkDespawn();
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
        const step = this.moveSpeed * dt;
        this.node.setPosition(pos.x + moveDir.x * step, pos.y + moveDir.y * step, pos.z);
    }

    /** 获取追踪目标（Spawner 传入的优先，其次 GameManager，最后按路径查找） */
    private findTarget(): boolean {
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

    /** 发射一颗弹幕（弹速 320px/s，寿命 3s；弹幕节点需自行配置碰撞体并设置组为 ENEMY_BULLET） */
    private fireBullet(angle: number): void {
        if (!this.bulletPrefab) {
            warn('[Enemy] 远程敌人缺少 bulletPrefab 属性，弹幕未发射');
            return;
        }
        const bullet = instantiate(this.bulletPrefab);
        bullet.setWorldPosition(this.node.worldPosition);
        bullet['bulletDamage'] = this.damage; // PlayerController 碰撞时读取
        const v = v3(Math.cos(angle), Math.sin(angle), 0).multiplyScalar(320);
        this.bullets.push(bullet);
        this.bulletVels.push(v);
        this.bulletLife.push(3);
        if (this.node.parent) this.node.parent.addChild(bullet);
    }

    /** 驱动弹幕移动与生命周期 */
    private updateBullets(dt: number): void {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            const v = this.bulletVels[i];
            this.bulletLife[i] -= dt;
            const overRange = Math.abs(b.position.x) > 4000 || Math.abs(b.position.y) > 4000;
            if (!b.isValid || this.bulletLife[i] <= 0 || overRange) {
                if (b.isValid) b.destroy();
                this.bullets.splice(i, 1);
                this.bulletVels.splice(i, 1);
                this.bulletLife.splice(i, 1);
                continue;
            }
            b.setPosition(b.position.x + v.x * dt, b.position.y + v.y * dt, 0);
        }
    }

    private clearBullets(): void {
        for (const b of this.bullets) if (b.isValid) b.destroy();
        this.bullets.length = 0;
        this.bulletVels.length = 0;
        this.bulletLife.length = 0;
    }

    // ==================== 受击 ====================

    /**
     * 受到伤害（武器系统调用）。
     * @param amount   伤害数值
     * @param knockDir 击退方向（单位向量），不传则无击退
     */
    public takeDamage(amount: number, knockDir?: Vec3): void {
        if (this.recycled || this.dying || !this.config) return;
        this.hp -= amount;
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
        this.clearBullets();
    }
}
