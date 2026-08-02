/**
 * Projectile.ts — 弹幕组件（对象池 + 多模式弹道）
 *
 * 支持弹道模式：
 *   LINEAR    直线飞行（飞剑术 / 寒冰掌）
 *   TRACKING  追踪目标（预留，后续武器可用）
 *   ORBITAL   圆周环绕玩家（太极剑阵）
 *   AURA      光环（烈焰环：以玩家为中心的持续范围灼烧）
 *   LIGHTNING 天雷（雷霆符：落点瞬发范围伤害 + 视觉演出）
 *   FALLING   剑雨（万剑诀：从空中坠落，落地范围伤害）
 *
 * 命中链路：
 *   距离检测命中 → DamageSystem.applyDamage（扣血/击退 + COMBAT_DAMAGE 广播）
 *   穿透：命中不销毁（轨道/贯穿武器）；弹射：非穿透且剩余弹射次数 > 0 时转向最近敌人
 *
 * 对象池：release 后节点入池复用；WeaponSystem 通过 Projectile.spawn 统一生成。
 * 视觉：MVP 无美术资源，用 Graphics 按武器类型绘制占位形状（后续替换图集）。
 *
 * 依赖契约：
 *   - Enemy.alive 注册表（索敌/命中判定遍历）
 *   - Enemy.getRadius() / getType() / takeDamage(amount, knockDir?)
 *   - GameManager.getScaledDt：问心减速 20% 弹幕同步慢放（GDD 4.3.2），
 *     完全暂停（升级/手动）时缩放后 dt = 0，弹幕自然定格
 */
import { _decorator, Component, Node, Vec3, Graphics, Color } from 'cc';
import { Enemy } from '../enemy/Enemy';
import { DamageSystem } from './DamageSystem';
import { WeaponType } from './WeaponData';
import { GameManager } from '../core/GameManager';

const { ccclass } = _decorator;

/** 弹道模式 */
export enum ProjectileMode {
    LINEAR = 0,    // 直线飞行
    TRACKING = 1,  // 追踪目标
    ORBITAL = 2,   // 圆周环绕
    AURA = 3,      // 光环（范围灼烧）
    LIGHTNING = 4, // 天雷（落点瞬伤）
    FALLING = 5,   // 剑雨（坠落）
}

/** 弹幕生成参数（由 WeaponSystem 各武器发射逻辑填充） */
export interface ProjectileSpawnParams {
    owner: Node;             // 归属玩家节点（伤害来源/环绕中心）
    weaponType: WeaponType;  // 武器类型（决定占位视觉颜色）
    mode: ProjectileMode;
    damage: number;          // 已结算伤害（含暴击）
    isCrit: boolean;
    speed: number;           // 直线/追踪/坠落速度（px/s）
    radius: number;          // 碰撞半径（px）
    lifetime: number;        // 生存时长（秒；<=0 表示常驻，如轨道剑阵）
    piercing: boolean;       // 是否穿透（命中不销毁）
    knockback: number;       // 击退力度系数（作用于击退方向向量）
    maxDistance?: number;    // 直线/追踪最大射程（px）
    angle?: number;          // 直线发射角（弧度，0 = 正右）
    target?: Enemy | null;   // 追踪目标
    orbitRadius?: number;    // 环绕半径（px）
    orbitSpeed?: number;     // 环绕角速度（rad/s）
    orbitAngle?: number;     // 初始环绕角（弧度）
    targetPosition?: Vec3;   // 天雷落点 / 剑雨落点
    areaRadius?: number;     // 范围伤害半径（px）
    tickInterval?: number;   // 光环伤害间隔（秒）
    bounceCount?: number;    // 弹射次数（非穿透武器命中后转向最近敌人）
}

@ccclass('Projectile')
export class Projectile extends Component {
    /** 对象池：回收的弹幕节点（挂载本组件，复用前由 setup 重置） */
    private static readonly pool: Node[] = [];

    /** 剑雨从天而降的起始高度（落点上方） */
    private static readonly FALL_START_HEIGHT = 480;

    // ==================== 运行时状态 ====================

    private _p!: ProjectileSpawnParams;
    private _dead = false;

    /** 移动方向（单位向量） */
    private _dir = new Vec3(1, 0, 0);
    /** 当前位置（世界坐标） */
    private _pos = new Vec3();
    /** 累计环绕角（弧度；转满 2π 清空命中表，轨道剑可重复伤害） */
    private _totalOrbit = 0;
    /** 光环伤害计时 */
    private _tickTimer = 0;
    /** 剑雨是否已落地 */
    private _landed = false;
    /** 落地点 y（世界坐标） */
    private _landY = 0;
    /** 落地后淡出计时 */
    private _fadeTimer = 0;
    /** 已生存时长 */
    private _elapsed = 0;
    /** 已飞行距离 */
    private _traveled = 0;
    /** 剩余弹射次数 */
    private _bounceLeft = 0;
    /** 本弹幕已命中的敌人（穿透去重） */
    private readonly _hitSet = new Set<Enemy>();

    private _gfx: Graphics | null = null;
    private _color = new Color(255, 255, 255, 255);

    // ==================== 对象池 ====================

    /**
     * 生成一枚弹幕（优先复用对象池节点）。
     * @param parent 父节点：直线/剑雨 → 场景层；环绕/光环 → 玩家节点（自动跟随）
     */
    public static spawn(parent: Node, params: ProjectileSpawnParams): Projectile {
        const node = Projectile.pool.pop();
        let proj: Projectile;
        if (node) {
            proj = node.getComponent(Projectile)!;
            node.setParent(parent);
        } else {
            const n = new Node('Projectile');
            n.setParent(parent);
            proj = n.addComponent(Projectile);
        }
        proj.setup(params);
        return proj;
    }

    /** 外部（WeaponSystem 清场/进化时）释放某节点上的弹幕：入池或直接销毁 */
    public static releaseNode(node: Node): void {
        const proj = node.getComponent(Projectile);
        if (proj) {
            proj.die();
        } else {
            node.destroy();
        }
    }

    /** 销毁并归还对象池 */
    public die(): void {
        if (this._dead) return;
        this._dead = true;
        this._hitSet.clear();
        this._p = null as unknown as ProjectileSpawnParams; // 释放引用
        this.node.removeFromParent();
        this.node.active = false;
        this.node.angle = 0;
        this.node.setScale(1, 1, 1);
        Projectile.pool.push(this.node);
    }

    // ==================== 初始化 ====================

    onLoad(): void {
        this._gfx = this.node.addComponent(Graphics);
    }

    /** 弹幕参数初始化（对象池复用语义 = 完全重置） */
    private setup(params: ProjectileSpawnParams): void {
        this._p = params;
        this._dead = false;
        this._elapsed = 0;
        this._traveled = 0;
        this._tickTimer = 0;
        this._landed = false;
        this._fadeTimer = 0;
        this._bounceLeft = params.bounceCount ?? 0;
        this._totalOrbit = 0;
        this._hitSet.clear();
        this.node.active = true;
        this._color = Projectile.colorByType(params.weaponType);

        const ownerPos = params.owner.worldPosition;
        switch (params.mode) {
            case ProjectileMode.ORBITAL:
            case ProjectileMode.AURA:
                // 挂到玩家节点下：以玩家为圆心自动跟随
                this.node.setParent(params.owner);
                this.node.setPosition(0, 0, 0);
                break;

            case ProjectileMode.LIGHTNING: {
                // 天雷：落点瞬发范围伤害，随后仅播放视觉演出
                const point = params.targetPosition ?? ownerPos;
                this.node.setWorldPosition(point);
                this.node.angle = 0;
                this._strike();
                break;
            }

            case ProjectileMode.FALLING: {
                // 剑雨：从落点上方坠落
                const land = params.targetPosition ?? ownerPos;
                this._landY = land.y;
                this._pos.set(land.x, land.y + Projectile.FALL_START_HEIGHT, 0);
                this.node.setWorldPosition(this._pos);
                this.node.angle = -90; // 剑尖朝下
                break;
            }

            default: {
                // 直线 / 追踪：从玩家位置出发
                this._pos.set(ownerPos);
                this.node.setWorldPosition(this._pos);
                if (params.angle !== undefined) {
                    this._dir.set(Math.cos(params.angle), Math.sin(params.angle), 0);
                }
                this.node.angle = Math.atan2(this._dir.y, this._dir.x) * 180 / Math.PI;
                break;
            }
        }
        this.redraw();
    }

    // ==================== 帧更新 ====================

    protected update(dt: number): void {
        if (this._dead || !this._p) return;

        // 问心减速（GDD 4.3.2）：弹幕随全局时间流速慢放；完全暂停时缩放后为 0 自然定格
        const gm = GameManager.getInstance();
        const sdt = gm ? gm.getScaledDt(dt) : dt;
        this._elapsed += sdt;

        switch (this._p.mode) {
            case ProjectileMode.LINEAR:
                this.updateLinear(sdt);
                break;
            case ProjectileMode.TRACKING:
                this.updateTracking(sdt);
                break;
            case ProjectileMode.ORBITAL:
                this.updateOrbital(sdt);
                break;
            case ProjectileMode.AURA:
                this.updateAura(sdt);
                break;
            case ProjectileMode.LIGHTNING:
                // 伤害已在落点瞬间结算，仅做演出淡出
                if (this._elapsed >= this._p.lifetime) this.die();
                else this.redraw();
                break;
            case ProjectileMode.FALLING:
                this.updateFalling(sdt);
                break;
        }
    }

    /** 直线飞行：移动 + 命中 + 射程/时限销毁 */
    private updateLinear(sdt: number): void {
        this._pos.add(this._dir.x * this._p.speed * sdt, this._dir.y * this._p.speed * sdt, 0);
        this.node.setWorldPosition(this._pos);
        this._traveled += this._p.speed * sdt;
        this.hitCheck();
        if (
            (this._p.maxDistance !== undefined && this._traveled >= this._p.maxDistance) ||
            (this._p.lifetime > 0 && this._elapsed >= this._p.lifetime)
        ) {
            this.die();
        }
    }

    /** 追踪飞行：平滑转向目标，命中/超时销毁 */
    private updateTracking(sdt: number): void {
        this.steer(sdt);
        this._pos.add(this._dir.x * this._p.speed * sdt, this._dir.y * this._p.speed * sdt, 0);
        this.node.setWorldPosition(this._pos);
        this._traveled += this._p.speed * sdt;
        this.hitCheck();
        if (
            (this._p.maxDistance !== undefined && this._traveled >= this._p.maxDistance) ||
            (this._p.lifetime > 0 && this._elapsed >= this._p.lifetime)
        ) {
            this.die();
        }
    }

    /** 环绕飞行：以玩家为圆心圆周运动，转满一圈重置命中表（可反复切割） */
    private updateOrbital(sdt: number): void {
        this._totalOrbit += (this._p.orbitSpeed ?? 3) * sdt;
        if (this._totalOrbit >= Math.PI * 2) {
            this._totalOrbit -= Math.PI * 2;
            this._hitSet.clear(); // 一圈后可再次命中同一敌人
        }
        const angle = (this._p.orbitAngle ?? 0) + this._totalOrbit;
        const r = this._p.orbitRadius ?? 100;
        this.node.setPosition(Math.cos(angle) * r, Math.sin(angle) * r, 0);
        this.node.angle = angle * 180 / Math.PI + 90; // 剑尖沿切线方向
        this.hitCheck();
    }

    /** 光环：周期性范围灼烧，到期销毁 */
    private updateAura(sdt: number): void {
        this._tickTimer += sdt;
        if (this._tickTimer >= (this._p.tickInterval ?? 0.5)) {
            this._tickTimer = 0;
            this.aoeDamage();
        }
        if (this._p.lifetime > 0 && this._elapsed >= this._p.lifetime) {
            this.die();
        } else {
            this.redraw(); // 光环脉冲/淡出演
        }
    }

    /** 剑雨：坠落 → 落地范围伤害 → 淡出销毁 */
    private updateFalling(sdt: number): void {
        if (this._landed) {
            this._fadeTimer -= sdt;
            if (this._fadeTimer <= 0) this.die();
            return;
        }
        this._pos.y -= this._p.speed * sdt;
        this.node.setWorldPosition(this._pos);
        if (this._pos.y <= this._landY) {
            this._landed = true;
            this._fadeTimer = 0.25;
            this.aoeDamage(); // 落地范围伤害
        }
    }

    /** 追踪转向：朝目标平滑转向（转向率 5/s） */
    private steer(sdt: number): void {
        const target = this._p.target;
        if (!target || !target.node.isValid || target.node.activeInHierarchy === false) return;
        const desired = Vec3.subtract(new Vec3(), target.node.worldPosition, this.node.worldPosition);
        if (desired.lengthSqr() <= 0.0001) return;
        desired.normalize();
        this._dir.lerp(desired, Math.min(1, 5 * sdt)).normalize();
        this.node.angle = Math.atan2(this._dir.y, this._dir.x) * 180 / Math.PI;
    }

    // ==================== 命中检测 ====================

    /** 接触命中：遍历存活敌人注册表做距离检测（MVP 线性扫描，V2.0 换空间哈希） */
    private hitCheck(): void {
        for (const enemy of Enemy.alive) {
            if (this._hitSet.has(enemy)) continue;
            if (!enemy.node.isValid || !enemy.node.activeInHierarchy) continue; // 池中/已回收
            const rr = this._p.radius + enemy.getRadius();
            if (Vec3.squaredDistance(this.node.worldPosition, enemy.node.worldPosition) <= rr * rr) {
                this._hitSet.add(enemy);
                this.onHitEnemy(enemy);
                if (this._dead) return; // 命中后已销毁，停止遍历
            }
        }
    }

    /** 命中敌人：结算伤害 → 穿透/弹射/销毁分支 */
    private onHitEnemy(enemy: Enemy): void {
        // 击退方向：由弹幕指向敌人，携带武器击退力度系数
        const dir = Vec3.subtract(new Vec3(), enemy.node.worldPosition, this.node.worldPosition);
        const len = dir.length();
        if (len > 0.001) dir.multiplyScalar(this._p.knockback / len);
        DamageSystem.applyDamage(enemy, this._p.damage, this._p.isCrit, dir);

        if (this._p.piercing) return; // 穿透：继续飞行

        if (this._bounceLeft > 0) {
            this._bounceLeft--;
            this.redirectToNearest(enemy); // 弹射：转向最近未命中敌人
        } else {
            this.die(); // 非穿透：命中即销毁
        }
    }

    /** 弹射：转向除当前命中外的最近敌人（无目标则销毁） */
    private redirectToNearest(except: Enemy): void {
        let nearest: Enemy | null = null;
        let best = Infinity;
        for (const e of Enemy.alive) {
            if (e === except || this._hitSet.has(e)) continue;
            const d = Vec3.squaredDistance(this.node.worldPosition, e.node.worldPosition);
            if (d < best) {
                best = d;
                nearest = e;
            }
        }
        if (nearest) {
            this._dir.set(
                Vec3.subtract(new Vec3(), nearest.node.worldPosition, this.node.worldPosition)
            ).normalize();
            this.node.angle = Math.atan2(this._dir.y, this._dir.x) * 180 / Math.PI;
        } else {
            this.die();
        }
    }

    /** 范围伤害（天雷落点 / 光环灼烧 / 剑雨落地）；光环可重复命中，其余一次性 */
    private aoeDamage(): void {
        const center = this.node.worldPosition;
        const r = this._p.areaRadius ?? 0;
        const oneShot = this._p.mode !== ProjectileMode.AURA;
        for (const enemy of Enemy.alive) {
            if (oneShot && this._hitSet.has(enemy)) continue;
            if (!enemy.node.isValid || !enemy.node.activeInHierarchy) continue;
            const rr = r + enemy.getRadius();
            if (Vec3.squaredDistance(center, enemy.node.worldPosition) <= rr * rr) {
                if (oneShot) this._hitSet.add(enemy);
                // 击退方向：由圆心指向敌人（径向击退）
                const dir = Vec3.subtract(new Vec3(), enemy.node.worldPosition, center);
                const len = dir.length();
                if (len > 0.001) dir.multiplyScalar(this._p.knockback / len);
                DamageSystem.applyDamage(enemy, this._p.damage, this._p.isCrit, dir);
            }
        }
    }

    // ==================== 天雷落点结算 ====================

    /** 天雷落点瞬发范围伤害（setup 时执行一次） */
    private _strike(): void {
        this.aoeDamage();
    }

    // ==================== 占位视觉（后续替换图集美术） ====================

    /** 按武器类型取占位颜色 */
    private static colorByType(type: WeaponType): Color {
        switch (type) {
            case WeaponType.ORBITAL: return new Color(255, 214, 90);     // 金光（太极剑阵）
            case WeaponType.LIGHTNING: return new Color(170, 220, 255);   // 雷光
            case WeaponType.PROJECTILE: return new Color(150, 220, 255);  // 冰霜（寒冰掌）
            case WeaponType.AURA: return new Color(255, 120, 50);         // 烈焰
            case WeaponType.PIERCING: return new Color(255, 240, 190);    // 白芒（飞剑术）
            case WeaponType.STORM: return new Color(205, 215, 255);       // 剑雨
            default: return new Color(255, 255, 255);
        }
    }

    /** 重绘占位视觉（先清空再绘制，支持对象池复用） */
    private redraw(): void {
        const g = this._gfx;
        if (!g) return;
        g.clear();

        // 淡出透明度（仅光环/天雷逐帧演出的模式使用）
        let alpha = 255;
        if (this._p) {
            if (this._p.mode === ProjectileMode.AURA && this._p.lifetime > 0) {
                // 最后 0.3 秒渐隐
                alpha = Math.round(255 * Math.max(0, Math.min(1, (this._p.lifetime - this._elapsed) / 0.3)));
            } else if (this._p.mode === ProjectileMode.LIGHTNING && this._p.lifetime > 0) {
                alpha = Math.round(255 * Math.max(0, 1 - this._elapsed / this._p.lifetime));
            }
        }
        this._color.a = Math.max(0, Math.min(255, alpha));

        // 外形按武器类型区分（同一弹道模式可对应不同武器，如直线 = 飞剑/寒冰碎片）
        switch (this._p?.weaponType) {
            case WeaponType.ORBITAL:
                this.drawBlade(g, 18);
                break;
            case WeaponType.PIERCING:
                this.drawBlade(g, 26);
                break;
            case WeaponType.PROJECTILE:
                this.drawShard(g);
                break;
            case WeaponType.STORM:
                this.drawBlade(g, 16);
                break;
            case WeaponType.AURA:
                this.drawRing(g);
                break;
            case WeaponType.LIGHTNING:
                this.drawBolt(g);
                break;
            default:
                this.drawDot(g);
                break;
        }
    }

    /** 飞剑（剑尖朝 +x） */
    private drawBlade(g: Graphics, length: number): void {
        g.lineWidth = 2;
        g.strokeColor = this._color;
        g.fillColor = this._color;
        const h = length / 4;
        g.moveTo(-length * 0.5, -h * 0.6);
        g.lineTo(length * 0.35, -h * 0.4);
        g.lineTo(length * 0.5, 0);
        g.lineTo(length * 0.35, h * 0.4);
        g.lineTo(-length * 0.5, h * 0.6);
        g.close();
        g.fill();
        g.stroke();
        // 剑柄
        g.circle(-length * 0.45, 0, h * 0.3);
        g.fill();
    }

    /** 冰霜碎片（寒冰掌） */
    private drawShard(g: Graphics): void {
        g.lineWidth = 1.5;
        g.strokeColor = this._color;
        g.fillColor = this._color;
        g.moveTo(10, 0);
        g.lineTo(-8, 6);
        g.lineTo(-4, 0);
        g.lineTo(-8, -6);
        g.close();
        g.fill();
        g.stroke();
    }

    /** 光环（烈焰环）：脉动圆环 + 半透明填充 */
    private drawRing(g: Graphics): void {
        const pulse = 1 + 0.12 * Math.sin(this._elapsed * 7);
        const r = (this._p.areaRadius ?? 100) * pulse;
        g.lineWidth = 5;
        g.strokeColor = this._color;
        g.circle(0, 0, r);
        g.stroke();
        g.fillColor = new Color(this._color.r, this._color.g, this._color.b, Math.round(this._color.a * 0.18));
        g.circle(0, 0, r);
        g.fill();
    }

    /** 天雷：锯齿闪电 + 落点闪光 */
    private drawBolt(g: Graphics): void {
        g.lineWidth = 3;
        g.strokeColor = this._color;
        const h = 260;
        const seg = 10;
        g.moveTo(0, h);
        for (let i = 1; i <= seg; i++) {
            const yy = h - (h * i) / seg;
            const xx = i === seg ? 0 : (Math.random() - 0.5) * 36;
            g.lineTo(xx, yy);
        }
        g.stroke();
        g.fillColor = this._color;
        g.circle(0, 0, (this._p.areaRadius ?? 60) * 0.5);
        g.fill();
    }

    /** 追踪弹占位（小圆点） */
    private drawDot(g: Graphics): void {
        g.fillColor = this._color;
        g.circle(0, 0, 5);
        g.fill();
    }
}
