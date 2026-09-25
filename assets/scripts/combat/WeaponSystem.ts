/**
 * WeaponSystem.ts — 武器系统（管理玩家所有武器的自动攻击）
 *
 * 职责：
 *   1. 持有武器运行时实例（等级/冷却计时/运行节点），每帧推进冷却并自动开火
 *   2. 六类武器发射逻辑：环绕（太极剑阵）/ 天雷（雷霆符）/ 扇形（寒冰掌）/
 *      光环（烈焰环）/ 贯穿（飞剑术）/ 剑雨（万剑诀）
 *   3. 进化判定：武器满级（WEAPON_MAX_LEVEL=8）+ 持有对应被动 → 替换为进化武器
 *   4. 与 PlayerData 武器/被动槽位双向同步：
 *      - 本系统 addWeapon/upgradeWeapon 同步写入槽位；
 *      - 升级三选一（LevelUpUI 等）直接写槽位时，本系统每帧 reconcile 自动接管
 *      - 本表被动（combat/PassiveData）效果自动应用到玩家属性（台账防重复）
 *
 * 挂载：玩家节点（环绕/光环武器以其为圆心）。
 * 事件（emit）：
 *   - WEAPON_ADDED / WEAPON_UPGRADED / WEAPON_EVOLVED（HUD 武器栏监听）
 *
 * 依赖契约：
 *   - PlayerData：player/PlayerData，经 PlayerRegistry 共享（PlayerController 开局 bind；
 *     未注册时使用独立实例，也可 setPlayerData 显式注入）
 *   - Projectile：对象池弹幕（Enemy.alive 注册表索敌/命中）
 *   - GameManager.getScaledDt：问心减速 20% 武器冷却慢放（GDD 4.3.2），
 *     完全暂停（升级/手动）时缩放后 dt = 0，武器停火定格
 */
import { _decorator, Component, Node, Vec3 } from 'cc';
import { WEAPON_CONFIGS, WeaponConfig, WeaponType } from './WeaponData';
import { PASSIVE_CONFIGS, PassiveStat } from './PassiveData';
import { Projectile, ProjectileMode } from './Projectile';
import { DamageSystem } from './DamageSystem';
import { PlayerData } from '../player/PlayerData';
import { PlayerRegistry } from '../core/PlayerRegistry';
import { Enemy } from '../enemy/Enemy';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GameManager, GameState } from '../core/GameManager';
import { BuildSystem } from '../progression/BuildSystem';

const { ccclass } = _decorator;

/** 武器满级（满级 + 持有对应被动 → 进化超武） */
export const WEAPON_MAX_LEVEL = 8;

/** 武器运行时实例（含发射状态） */
export interface WeaponInstance {
    config: WeaponConfig;
    level: number;
    cooldownTimer: number;
    orbitalNodes: Node[];  // 环绕武器：已生成的飞剑节点
    auraNode: Node | null; // 光环武器：运行中的光环节点
}

@ccclass('WeaponSystem')
export class WeaponSystem extends Component {
    /** 武器表：id → 运行时实例 */
    private weapons: Map<string, WeaponInstance> = new Map();

    private _playerData: PlayerData | null = null;
    /** 已应用被动等级台账（防重复应用；重开一局需 clearAll 清零） */
    private appliedPassiveLevels: Map<string, number> = new Map();
    /** 未知武器 id 告警去重（武器表不一致时避免每帧刷屏） */
    private warnedIds: Set<string> = new Set();

    /** 面朝方向（弧度，0 = 正右；寒冰掌等前方系武器使用，由 PlayerController 每帧更新） */
    public facing = 0;

    /** 玩家数据（优先取 PlayerRegistry 共享实例，未注册时使用独立实例） */
    public get playerData(): PlayerData {
        if (!this._playerData) {
            this._playerData = PlayerRegistry.getPlayer() ?? new PlayerData();
        }
        return this._playerData;
    }

    public set playerData(value: PlayerData) {
        this._playerData = value;
    }

    /** 注入共享玩家数据（Player 系统接线：setPlayerData(playerController.getData())） */
    public setPlayerData(data: PlayerData): void {
        this._playerData = data;
    }

    /** 初始化入口（骨架契约：显式注入玩家数据；等价于 setPlayerData） */
    public init(playerData: PlayerData): void {
        this._playerData = playerData;
    }

    // ==================== 生命周期 ====================

    onLoad(): void {
        // 新一局：清空运行时武器与被动台账
        // （被动台账不清会导致重开后被动效果不再重新应用）
        EventBus.getInstance().on(GameEvent.GAME_START, this.onGameStart);
    }

    onDestroy(): void {
        EventBus.getInstance().off(GameEvent.GAME_START, this.onGameStart);
    }

    private onGameStart = (): void => {
        this.clearAll();
    };

    // ==================== 帧更新 ====================

    protected update(dt: number): void {
        // 与 PlayerData 槽位同步（升级三选一等系统直接写槽位时自动接管）
        this.syncFromPlayerData();

        // 问心减速（GDD 4.3.2）：武器冷却与发射走全局时间流速；
        // 完全暂停（升级/手动）时缩放后 dt = 0，冷却不再推进、不会误开火
        const gm = GameManager.getInstance();
        // 结算界面背后不应继续开火（问心慢动作属于 PAUSED，需保留，故只拦 GAME_OVER）
        if (gm && gm.state === GameState.GAME_OVER) return;
        const sdt = gm ? gm.getScaledDt(dt) : dt;

        // 遍历所有武器：推进冷却，归零则开火
        for (const [id, weapon] of this.weapons) {
            weapon.cooldownTimer -= sdt;
            if (weapon.cooldownTimer <= 0) {
                if (sdt > 0) {
                    this.fireWeapon(id, weapon);
                    weapon.cooldownTimer = weapon.config.cooldown / Math.max(0.1, this.playerData.cooldown);
                    // 开火统计（DebugPanel 用释放次数排查"只释放一次"类问题）
                    EventBus.getInstance().emit(GameEvent.WEAPON_FIRED, {
                        id: weapon.config.id,
                        name: weapon.config.name,
                        level: weapon.level,
                    });
                }
                // sdt === 0（完全暂停）：不发射也不重置计时，恢复后立即补发
            }
        }
    }

    // ==================== 与 PlayerData 槽位同步 ====================

    /**
     * 每帧 reconcile 武器/被动槽位：
     *  - 槽位新增武器 → 登记开火（无配置则告警一次）
     *  - 槽位等级变化 → 更新实例（轨道剑阵重建 + 进化判定）
     *  - 槽位移除武器 → 停用释放
     *  - 本表被动升级 → 逐级应用效果（台账防重复）
     */
    private syncFromPlayerData(): void {
        const pd = this.playerData;

        for (const slot of pd.weapons) {
            const inst = this.weapons.get(slot.id);
            if (!inst) {
                const cfg = WEAPON_CONFIGS[slot.id];
                if (!cfg) {
                    if (!this.warnedIds.has(slot.id)) {
                        this.warnedIds.add(slot.id);
                        console.warn(`[WeaponSystem] 武器表缺失：${slot.id}（升级系统需改用 combat/WeaponData 的武器 id）`);
                    }
                    continue;
                }
                this.weapons.set(slot.id, {
                    config: cfg,
                    level: slot.level,
                    cooldownTimer: 0,
                    orbitalNodes: [],
                    auraNode: null,
                });
                EventBus.getInstance().emit(GameEvent.WEAPON_ADDED, {
                    id: cfg.id,
                    name: cfg.name,
                    level: slot.level,
                });
            } else if (inst.level !== slot.level) {
                inst.level = slot.level;
                this.onWeaponUpgraded(inst);
            }
        }

        // 槽位中已移除的武器 → 停用
        for (const id of Array.from(this.weapons.keys())) {
            if (!pd.weapons.some((w) => w.id === id)) this.removeWeapon(id);
        }

        // 被动效果应用（仅 combat/PassiveData 表的被动；其余被动表由对应系统处理）
        for (const slot of pd.passives) {
            const cfg = PASSIVE_CONFIGS[slot.id];
            if (!cfg) continue;
            const applied = this.appliedPassiveLevels.get(slot.id) ?? 0;
            if (slot.level > applied) {
                for (let i = applied; i < slot.level; i++) {
                    for (const e of cfg.effects) this.applyPassiveEffect(e.stat, e.valuePerLevel);
                }
                this.appliedPassiveLevels.set(slot.id, slot.level);
                console.log(`[WeaponSystem] 被动「${cfg.name}」Lv.${slot.level} 生效`);
            }
        }
    }

    /**
     * 应用一级被动效果（player/PlayerData 未提供方法，按 PassiveData 语义就地实现）。
     * 说明：速度（speed）属性同时影响移速与弹速（PlayerData 注释），属规格约定。
     */
    private applyPassiveEffect(stat: PassiveStat, valuePerLevel: number): void {
        const pd = this.playerData;
        switch (stat) {
            case 'might': pd.might += valuePerLevel; break;
            case 'area': pd.area += valuePerLevel; break;
            case 'speed': pd.speed += valuePerLevel; break; // 弹速/移速倍率
            case 'duration': pd.duration += valuePerLevel; break;
            case 'cooldown': pd.cooldown = Math.max(0.4, pd.cooldown * (1 - valuePerLevel)); break; // 冷却缩减（下限 0.4）
            case 'luck': pd.luck += valuePerLevel; break;  // critChance getter 自动随 luck 重算
            case 'greed': pd.greed += valuePerLevel; break;
            case 'maxHp': pd.maxHp += valuePerLevel; pd.hp += valuePerLevel; break;
            default:
                console.warn(`[WeaponSystem] 未知被动属性：${stat}`);
        }
    }

    // ==================== 武器管理 API ====================

    /** 获得武器（登记开火 + 同步 PlayerData 槽位；重复获得视为升级） */
    public addWeapon(weaponId: string, level: number = 1): void {
        const cfg = WEAPON_CONFIGS[weaponId];
        if (!cfg) {
            console.warn(`[WeaponSystem] 未知武器：${weaponId}`);
            return;
        }
        if (this.weapons.has(weaponId)) {
            this.upgradeWeapon(weaponId, level);
            return;
        }
        // 同步槽位（PlayerData.addWeapon 含 6 槽上限与防重复）
        const pd = this.playerData;
        if (!pd.weapons.some((w) => w.id === weaponId)) {
            if (!pd.addWeapon(weaponId)) {
                console.warn(`[WeaponSystem] 武器槽已满，无法获得「${cfg.name}」`);
                return;
            }
        }
        const slot = pd.weapons.find((w) => w.id === weaponId);
        if (slot) slot.level = level;

        this.weapons.set(weaponId, {
            config: cfg,
            level,
            cooldownTimer: 0, // 首次获得立即开火
            orbitalNodes: [],
            auraNode: null,
        });
        EventBus.getInstance().emit(GameEvent.WEAPON_ADDED, { id: cfg.id, name: cfg.name, level });
    }

    /** 武器升级（封顶 WEAPON_MAX_LEVEL；满级自动检查进化） */
    public upgradeWeapon(weaponId: string, levels: number = 1): void {
        const w = this.weapons.get(weaponId);
        if (!w) {
            this.addWeapon(weaponId, levels);
            return;
        }
        w.level = Math.min(w.level + levels, WEAPON_MAX_LEVEL);
        // 同步槽位等级（PlayerData.upgradeWeapon 每次仅 +1，此处直接对齐）
        const slot = this.playerData.weapons.find((s) => s.id === weaponId);
        if (slot) slot.level = w.level;
        this.onWeaponUpgraded(w);
    }

    /** 武器升级后的处理：轨道剑阵重建（数量随等级）+ 广播 + 进化判定 */
    private onWeaponUpgraded(w: WeaponInstance): void {
        if (w.config.type === WeaponType.ORBITAL) {
            this.clearWeaponState(w);
            this.spawnOrbital(w);
        }
        EventBus.getInstance().emit(GameEvent.WEAPON_UPGRADED, {
            id: w.config.id,
            name: w.config.name,
            level: w.level,
        });
        this.checkEvolution(w.config.id);
    }

    /**
     * 进化判定：武器满级 + 持有对应被动（evolutionPair）→ 替换为进化武器。
     * @returns 是否成功进化
     */
    public checkEvolution(weaponId: string): boolean {
        const w = this.weapons.get(weaponId);
        if (!w) return false;
        const cfg = w.config;
        if (!cfg.evolutionPair || !cfg.evolutionId) return false; // 已是最终形态
        if (w.level < WEAPON_MAX_LEVEL) return false;
        if (!this.playerData.hasPassive(cfg.evolutionPair)) return false;

        const evolved = WEAPON_CONFIGS[cfg.evolutionId];
        if (!evolved) {
            console.warn(`[WeaponSystem] 进化目标武器缺失：${cfg.evolutionId}`);
            return false;
        }

        // 释放旧武器运行时状态（剑阵/光环），替换配置并立即开火
        this.clearWeaponState(w);
        w.config = evolved;
        w.cooldownTimer = 0;
        // 更新 Map 键为进化武器 id（与槽位一致，防止同步时被当作新武器重复登记）
        this.weapons.delete(weaponId);
        this.weapons.set(evolved.id, w);
        // 同步槽位 id → 进化武器（等级保留）
        const slot = this.playerData.weapons.find((s) => s.id === weaponId);
        if (slot) slot.id = evolved.id;

        EventBus.getInstance().emit(GameEvent.WEAPON_EVOLVED, { weaponId: evolved.id, name: evolved.name });
        console.log(`[WeaponSystem] 进化！${cfg.name} → ${evolved.name}`);
        return true;
    }

    /** 移除武器（释放运行状态；PlayerData 槽位由升级系统自行处理） */
    public removeWeapon(weaponId: string): void {
        const w = this.weapons.get(weaponId);
        if (!w) return;
        this.clearWeaponState(w);
        this.weapons.delete(weaponId);
    }

    /** 清空全部武器与被动台账（重开一局时调用） */
    public clearAll(): void {
        for (const w of this.weapons.values()) this.clearWeaponState(w);
        this.weapons.clear();
        this.appliedPassiveLevels.clear();
        this.warnedIds.clear();
        this.facing = 0;
    }

    /** 释放武器运行时节点（剑阵/光环）入对象池 */
    private clearWeaponState(weapon: WeaponInstance): void {
        for (const n of weapon.orbitalNodes) {
            if (n && n.isValid) Projectile.releaseNode(n);
        }
        weapon.orbitalNodes = [];
        if (weapon.auraNode && weapon.auraNode.isValid) Projectile.releaseNode(weapon.auraNode);
        weapon.auraNode = null;
    }

    /** HUD 武器栏数据 */
    public getWeaponList(): { id: string; name: string; level: number; evolved: boolean }[] {
        const list: { id: string; name: string; level: number; evolved: boolean }[] = [];
        for (const w of this.weapons.values()) {
            list.push({ id: w.config.id, name: w.config.name, level: w.level, evolved: !w.config.evolutionId });
        }
        return list;
    }

    // ==================== 发射逻辑（六类武器） ====================

    /** 冷却归零开火：按武器类型分发发射逻辑 */
    private fireWeapon(id: string, weapon: WeaponInstance): void {
        switch (weapon.config.type) {
            case WeaponType.ORBITAL: this.spawnOrbital(weapon); break;
            case WeaponType.LIGHTNING: this.spawnLightning(weapon); break;
            case WeaponType.PROJECTILE: this.spawnSpread(weapon); break;
            case WeaponType.AURA: this.activateAura(weapon); break;
            case WeaponType.PIERCING: this.spawnPiercing(weapon); break;
            case WeaponType.STORM: this.spawnStorm(weapon); break;
        }
    }

    /** 太极剑阵：飞剑绕玩家圆周飞行，持续接触切割（首召后常驻） */
    private spawnOrbital(weapon: WeaponInstance): void {
        if (weapon.orbitalNodes.some((n) => n.isValid)) return; // 剑阵已在运行
        const cfg = weapon.config;
        const count = cfg.projectileCount;
        const orbitRadius = cfg.area * 100 * this.playerData.area; // 范围系数 ×100px × 范围倍率
        const startAngle = Math.random() * Math.PI * 2;
        weapon.orbitalNodes = [];
        for (let i = 0; i < count; i++) {
            const res = DamageSystem.roll(this.playerData, cfg, weapon.level);
            const proj = Projectile.spawn(this.node, {
                owner: this.node,
                weaponType: cfg.type,
                mode: ProjectileMode.ORBITAL,
                damage: res.amount,
                isCrit: res.isCrit,
                speed: 0,
                radius: 20,
                lifetime: -1, // 常驻，直到武器被移除/进化
                piercing: true,
                knockback: cfg.knockback,
                orbitRadius,
                orbitSpeed: 2.6,
                orbitAngle: startAngle + (i * Math.PI * 2) / count,
            });
            weapon.orbitalNodes.push(proj.node);
        }
    }

    /** 雷霆符：随机目标位置天雷轰击（范围内随机敌人，无敌人则随机落点） */
    private spawnLightning(weapon: WeaponInstance): void {
        const cfg = weapon.config;
        const range = cfg.area * 150;
        const target = this.getRandomEnemy(range);
        const point = target
            ? target.node.worldPosition.clone()
            : this.getRandomPointAroundPlayer(Math.max(120, range * 0.8));

        for (let i = 0; i < cfg.projectileCount; i++) {
            const res = DamageSystem.roll(this.playerData, cfg, weapon.level);
            Projectile.spawn(this.getSceneParent(), {
                owner: this.node,
                weaponType: cfg.type,
                mode: ProjectileMode.LIGHTNING,
                damage: res.amount,
                isCrit: res.isCrit,
                speed: 0,
                radius: 0,
                lifetime: Math.max(0.1, cfg.duration), // 视觉演出时长
                piercing: true,
                knockback: cfg.knockback,
                targetPosition: point,
                areaRadius: cfg.area * 60,
            });
        }
    }

    /** 寒冰掌：面朝方向扇形散射（非穿透） */
    private spawnSpread(weapon: WeaponInstance): void {
        const cfg = weapon.config;
        const count = cfg.projectileCount;
        const spread = 0.8; // 总扇角约 46°
        const baseAngle = this.facing;
        const speed = cfg.speed * this.playerData.speed;
        const lifetime = (cfg.duration || 0.5) * this.playerData.duration;
        for (let i = 0; i < count; i++) {
            const angle = baseAngle - spread / 2 + (spread * i) / Math.max(1, count - 1);
            const res = DamageSystem.roll(this.playerData, cfg, weapon.level);
            Projectile.spawn(this.getSceneParent(), {
                owner: this.node,
                weaponType: cfg.type,
                mode: ProjectileMode.LINEAR,
                damage: res.amount,
                isCrit: res.isCrit,
                speed,
                radius: 14,
                lifetime,
                piercing: false,
                knockback: cfg.knockback,
                angle,
                maxDistance: 900,
            });
        }
    }

    /** 烈焰环：以玩家为中心的持续火焰光环（周期性范围灼烧） */
    private activateAura(weapon: WeaponInstance): void {
        // 注意：光环弹幕到期后回收到对象池（node.active=false、removeFromParent），
        // 节点本身仍是 valid —— 守卫必须检查 activeInHierarchy，否则光环整局只放出一次。
        if (weapon.auraNode && weapon.auraNode.isValid && weapon.auraNode.activeInHierarchy) return; // 光环已在运行
        const cfg = weapon.config;
        const res = DamageSystem.roll(this.playerData, cfg, weapon.level);
        let proj: Projectile | null = null;
        proj = Projectile.spawn(this.node, {
            owner: this.node,
            weaponType: cfg.type,
            mode: ProjectileMode.AURA,
            damage: res.amount,
            isCrit: res.isCrit,
            speed: 0,
            radius: 0,
            lifetime: (cfg.duration || 1.5) * this.playerData.duration,
            piercing: true,
            knockback: cfg.knockback,
            // 流派天赋「焚天领域」：光环范围 +35%
            areaRadius: cfg.area * 80 * (BuildSystem.hasTalent('flame_domain') ? 1.35 : 1),
            tickInterval: 0.5,
            // 光环结束（到期 / 武器被移除）时清除武器侧引用：
            // 节点是回收到共享对象池的（可能被雷霆符等借走复用），
            // 引用不清除会导致下一次冷却被守卫误判为"光环仍在运行"而永不重放。
            onDeath: () => {
                if (proj && weapon.auraNode === proj.node) weapon.auraNode = null;
            },
        });
        weapon.auraNode = proj.node;
    }

    /** 飞剑术：朝最近敌人发射高速贯穿飞剑（穿透全部敌人） */
    private spawnPiercing(weapon: WeaponInstance): void {
        const cfg = weapon.config;
        const nearest = this.getNearestEnemy(2000);
        const baseAngle = nearest
            ? Math.atan2(
                  nearest.node.worldPosition.y - this.node.worldPosition.y,
                  nearest.node.worldPosition.x - this.node.worldPosition.x
              )
            : this.facing;
        const speed = cfg.speed * this.playerData.speed;
        for (let i = 0; i < cfg.projectileCount; i++) {
            const res = DamageSystem.roll(this.playerData, cfg, weapon.level);
            Projectile.spawn(this.getSceneParent(), {
                owner: this.node,
                weaponType: cfg.type,
                mode: ProjectileMode.LINEAR,
                damage: res.amount,
                isCrit: res.isCrit,
                speed,
                radius: 16,
                lifetime: -1, // 以射程为准（maxDistance）
                piercing: true,
                knockback: cfg.knockback,
                angle: baseAngle + (Math.random() - 0.5) * 0.08, // 多剑略微分散
                maxDistance: 1500,
            });
        }
    }

    /** 万剑诀：以玩家为中心的大范围剑雨（随机落点，落地范围伤害） */
    private spawnStorm(weapon: WeaponInstance): void {
        const cfg = weapon.config;
        const radius = cfg.area * 130;
        const playerPos = this.node.worldPosition;
        for (let i = 0; i < cfg.projectileCount; i++) {
            // 半径内均匀随机落点（sqrt 保证分布均匀）
            const angle = Math.random() * Math.PI * 2;
            const r = radius * Math.sqrt(Math.random());
            const land = new Vec3(playerPos.x + Math.cos(angle) * r, playerPos.y + Math.sin(angle) * r, 0);
            const res = DamageSystem.roll(this.playerData, cfg, weapon.level);
            Projectile.spawn(this.getSceneParent(), {
                owner: this.node,
                weaponType: cfg.type,
                mode: ProjectileMode.FALLING,
                damage: res.amount,
                isCrit: res.isCrit,
                speed: cfg.speed * this.playerData.speed * (0.85 + Math.random() * 0.3), // 下落速度差异化
                radius: 0,
                lifetime: -1, // 落地后自动销毁
                piercing: false,
                knockback: cfg.knockback,
                targetPosition: land,
                areaRadius: 70,
            });
        }
    }

    // ==================== 索敌辅助 ====================

    /** 场景父节点（脱离玩家独立飞行的弹幕挂载处） */
    private getSceneParent(): Node {
        return this.node.parent ?? this.node;
    }

    /** 范围内最近敌人（弹幕索敌；无敌人返回 null） */
    private getNearestEnemy(maxRange: number): Enemy | null {
        let best: Enemy | null = null;
        let bestD = maxRange * maxRange;
        const pos = this.node.worldPosition;
        for (const e of Enemy.alive) {
            if (!e.node.isValid || !e.node.activeInHierarchy) continue;
            const d = Vec3.squaredDistance(pos, e.node.worldPosition);
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    /** 范围内随机敌人（天雷索敌；无敌人返回 null） */
    private getRandomEnemy(maxRange: number): Enemy | null {
        const pos = this.node.worldPosition;
        const list = Enemy.alive.filter(
            (e) => e.node.isValid && e.node.activeInHierarchy && Vec3.squaredDistance(pos, e.node.worldPosition) <= maxRange * maxRange
        );
        if (list.length === 0) return null;
        return list[Math.floor(Math.random() * list.length)];
    }

    /** 玩家周围均匀随机点（天雷无目标时的落点） */
    private getRandomPointAroundPlayer(radius: number): Vec3 {
        const angle = Math.random() * Math.PI * 2;
        const r = radius * Math.sqrt(Math.random());
        const pos = this.node.worldPosition;
        return new Vec3(pos.x + Math.cos(angle) * r, pos.y + Math.sin(angle) * r, 0);
    }
}
