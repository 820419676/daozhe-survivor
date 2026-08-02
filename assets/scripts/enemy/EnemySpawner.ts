/**
 * EnemySpawner.ts —— 敌人生成器（基于时间的波次系统）
 *
 * 职责：
 *   - 按时间持续刷怪：密度 = 8 + 2×分钟 只/秒（GDD 4.4 敌人曲线，峰值约 68 只/s）
 *   - 每分钟按权重表决定敌人类型（前期小妖海，中后期散修弹幕怪占比上升）
 *   - 同屏数量上限管理：500 → 300 → 200 三级降级（依实时 FPS 实测自动切换；
 *     最终数值以 MVP 第一周真机四级压测 100/200/300/500 为准，GDD 9.3 技术风险 1）
 *   - 妖王（精英）每 2 分钟生成 1 只；30 分钟渡劫模式 15:00 后双精英同时刷新
 *   - 天劫之主（Boss）在终局前 1 分钟生成（14:00 炼气试炼 / 29:00 渡劫模式），
 *     血量 = 玩家预测 30 秒 DPS × 20 / ×35（GDD 4.3.7）
 *   - 对象池全覆盖（NodePool），敌人死亡/超距回收后复用
 *
 * 事件（emit）：
 *   - 'ENEMY_SPAWNED'  { type, node }      刷怪（技能系统索敌、HUD 计数）
 *   - 'WAVE_STARTED'   { minute }          每分钟波次广播（HUD/音频）
 *   - 'BOSS_SPAWNED'   { node }            天劫降临（演出系统：黑云+雷光）
 *   - 'BOSS_DEFEATED'  { node }            天劫击杀（结算：道心 ×2 等，由 GameManager 处理）
 * 事件（on）：
 *   - 'PLAYER_DIED'                        玩家死亡 → 清场回收
 */
import * as cc from 'cc';
import { GameManager, GameState } from '../core/GameManager';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { Enemy } from './Enemy';
import { EnemyType, EnemyConfig, ENEMY_CONFIGS } from './EnemyTypes';
import { PlayerController } from '../player/PlayerController';

const { ccclass, property } = cc._decorator;

/**
 * 波次权重表：按分钟配置敌人类型权重（GDD：每分钟读取配置表决定敌人类型）。
 * 表项按 minute 递增排列，查询时取最后一个不大于当前分钟的配置。
 * 前期以小妖（近战）为主，散修（远程）随时间逐渐增多。
 */
const WAVE_TABLE: { minute: number; weights: Partial<Record<EnemyType, number>> }[] = [
    { minute: 0, weights: { [EnemyType.BASIC]: 10 } },                                  // 0~1 分钟：纯小妖教学波
    { minute: 1, weights: { [EnemyType.BASIC]: 9, [EnemyType.RANGED]: 1 } },            // 1~2 分钟：散修登场
    { minute: 2, weights: { [EnemyType.BASIC]: 7, [EnemyType.RANGED]: 3 } },
    { minute: 4, weights: { [EnemyType.BASIC]: 6, [EnemyType.RANGED]: 4 } },
    { minute: 7, weights: { [EnemyType.BASIC]: 5, [EnemyType.RANGED]: 5 } },
    { minute: 11, weights: { [EnemyType.BASIC]: 4, [EnemyType.RANGED]: 6 } },           // 11 分钟后：弹幕海
];

/** 性能分级：同屏敌人上限（500 → 300 → 200），依帧率实测切换 */
const PERF_TIERS: number[] = [500, 300, 200];

@ccclass('EnemySpawner')
export class EnemySpawner extends cc.Component {
    /** 敌人预制体（节点上需挂载 Enemy 组件 + Collider2D，组设为 ENEMY） */
    @property({ type: cc.Prefab })
    enemyPrefab: cc.Prefab = null!;

    /** 玩家节点（编辑器指定；留空则从 GameManager.getPlayer() 或 cc.find 获取） */
    @property({ type: cc.Node })
    playerNode: cc.Node = null!;

    /** 初始同屏上限（500；运行中按帧率在 500/300/200 间自动降级/恢复） */
    @property({ tooltip: '初始同屏上限（运行时按帧率在 500/300/200 间降级）' })
    maxEnemies: number = 500;

    /** 生成间隔（秒）：每个 tick 生成 密度×间隔 只，越小越密 */
    @property({ tooltip: '生成间隔（秒）' })
    spawnInterval: number = 0.12;

    /** 妖王（精英）生成间隔（秒），默认 2 分钟 */
    @property({ tooltip: '妖王生成间隔（秒）' })
    eliteInterval: number = 120;

    /** 局时长（秒）：900 = 炼气试炼（15 分钟，终局 14:00）/ 1800 = 渡劫模式（30 分钟，终局 29:00） */
    @property({ tooltip: '局时长（秒）：900 炼气试炼 / 1800 渡劫模式' })
    gameEndTime: number = 900;

    /** 地图半宽（与 PlayerController 的 mapHalfWidth 一致，出生点限制用） */
    @property({ tooltip: '地图半宽（px）' })
    mapHalfWidth: number = 1800;

    /** 地图半高 */
    @property({ tooltip: '地图半高（px）' })
    mapHalfHeight: number = 1800;

    // ==================== 运行时状态 ====================

    private spawnTimer: number = 0;
    private eliteTimer: number = 0;
    private gameTime: number = 0;
    private activeEnemies: number = 0;
    private activeElites: number = 0;
    private enemyPool: cc.NodePool = new cc.NodePool();

    private bossSpawned: boolean = false;
    private bossActive: boolean = false; // Boss 在场期间普通刷怪减量

    private waveMinute: number = -1;

    // —— 性能分级状态 ——
    private perfTier: number = 0; // 0 → 500 只, 1 → 300 只, 2 → 200 只
    private fpsSum: number = 0;
    private fpsCount: number = 0;
    private fpsWindow: number = 0;
    private fpsHighTimer: number = 0; // 帧率持续高于 50fps 的累计秒数（达标可升级档位）

    // ==================== 生命周期 ====================

    onLoad(): void {
        EventBus.on(GameEvent.PLAYER_DIED, this.onPlayerDied, this);
        this.spawnTimer = 0.5;      // 开局 0.5s 后开始刷怪
        this.eliteTimer = this.eliteInterval; // 首只妖王在 2:00
    }

    update(dt: number): void {
        if (GameManager.getInstance().state !== GameState.PLAYING) return;
        this.gameTime += dt;
        this.updatePerformance(dt);
        this.updateWaveAnnounce();
        this.updateBoss();
        this.updateElite(dt);
        this.updateSpawning(dt);
    }

    onDestroy(): void {
        EventBus.off(GameEvent.PLAYER_DIED, this.onPlayerDied, this);
        this.enemyPool.clear();
    }

    // ==================== 常规刷怪 ====================

    private updateSpawning(dt: number): void {
        this.spawnTimer -= dt;

        const cap = this.effectiveCap();
        if (this.spawnTimer > 0 || this.activeEnemies >= cap) {
            if (this.activeEnemies >= cap) this.spawnTimer = Math.min(this.spawnTimer, 0.5); // 满员时 0.5s 后重试
            return;
        }

        const minute = Math.floor(this.gameTime / 60);
        const density = 8 + 2 * minute; // 只/秒（GDD 4.4：峰值约 68 只/s）
        let batch = Math.max(1, Math.round(density * this.spawnInterval));
        if (this.bossActive) batch = Math.max(1, Math.round(batch * 0.3)); // 天劫之战期间减量，聚焦 Boss
        batch = Math.min(batch, Math.max(0, cap - this.activeEnemies));

        for (let i = 0; i < batch; i++) {
            this.spawnEnemy(this.getSpawnConfig(this.gameTime));
        }
        this.spawnTimer = this.spawnInterval;
    }

    /** 当前生效的同屏上限（初始上限 与 性能分级 取小） */
    private effectiveCap(): number {
        return Math.min(this.maxEnemies, PERF_TIERS[this.perfTier]);
    }

    // ==================== 妖王（精英） ====================

    private updateElite(dt: number): void {
        this.eliteTimer -= dt;
        if (this.eliteTimer > 0) return;

        // 30 分钟渡劫模式 15:00 后：双精英同时刷新（GDD 阶段表「天道回馈期」）
        const lateGame = this.gameEndTime >= 1800 && this.gameTime >= 900;
        const maxElites = lateGame ? 4 : 2;
        if (this.activeElites >= maxElites) {
            this.eliteTimer = 10; // 场地精英已满，10s 后重试
            return;
        }
        const count = lateGame ? 2 : 1;
        for (let i = 0; i < count; i++) {
            this.spawnEnemy(ENEMY_CONFIGS[EnemyType.ELITE]);
        }
        this.eliteTimer = this.eliteInterval; // 每 2 分钟一只
    }

    // ==================== 天劫之主（Boss） ====================

    private updateBoss(): void {
        const bossTime = this.gameEndTime - 60; // 终局前 1 分钟：900→840s（14:00）/ 1800→1740s（29:00）
        if (this.bossSpawned || this.gameTime < bossTime) return;
        this.bossSpawned = true;
        this.bossActive = true;

        const cfg = ENEMY_CONFIGS[EnemyType.BOSS];
        // 天劫之主血量 = 玩家预测 30 秒 DPS × 20（炼气试炼）/ ×35（渡劫模式）—— GDD 4.3.7
        const factor = this.gameEndTime >= 1800 ? 35 : 20;
        const hpOverride = Math.round(this.estimatePlayerDps() * 30 * factor);
        const boss = this.spawnEnemy(cfg, hpOverride);
        EventBus.emit(GameEvent.BOSS_SPAWNED, { node: boss ? boss.node : null });
        cc.log(`[Spawner] 天劫降临 @${Math.floor(this.gameTime / 60)}:${String(Math.floor(this.gameTime % 60)).padStart(2, '0')}，血量=${hpOverride}`);
    }

    /** 预测玩家 DPS（战力 ≈ 基础 DPS × 1.2^等级，GDD 4.4 玩家曲线） */
    private estimatePlayerDps(): number {
        const player = this.getPlayerNode();
        const pd = player ? player.getComponent(PlayerController)?.getData() : null;
        if (!pd) return 15; // 缺省兜底
        const baseDps = pd.attackPower * (1.5 / Math.max(0.5, pd.cooldown)); // 约 1.5 次攻击/秒
        return baseDps * Math.pow(1.2, Math.max(0, pd.level - 1));
    }

    // ==================== 生成实现 ====================

    /**
     * 生成一只敌人（优先对象池复用）。
     * @param hpOverride Boss 血量覆盖（按玩家 DPS 动态定标）
     */
    private spawnEnemy(config: EnemyConfig, hpOverride?: number): Enemy | null {
        if (!this.enemyPrefab) {
            cc.warnOnce('[Spawner] 未设置 enemyPrefab 属性');
            return null;
        }
        let node: cc.Node;
        if (this.enemyPool.size() > 0) {
            node = this.enemyPool.get()!;
        } else {
            node = cc.instantiate(this.enemyPrefab);
        }
        const enemy = node.getComponent(Enemy) ?? node.addComponent(Enemy);
        node.parent = this.node;
        node.setPosition(this.getSpawnPosition());
        enemy.init(config, this, this.gameTime / 60, hpOverride);
        enemy.setTarget(this.getPlayerNode());
        node.active = true;

        this.activeEnemies++;
        if (config.type === EnemyType.ELITE) this.activeElites++;
        EventBus.emit(GameEvent.ENEMY_SPAWNED, { type: config.type, node });
        return enemy;
    }

    /**
     * 基于当前时间返回敌人配置（按分钟权重表加权随机）。
     * 妖王/天劫之主不走普通刷怪，由精英/Boss 定时器单独处理。
     */
    private getSpawnConfig(time: number): EnemyConfig {
        const minute = Math.floor(time / 60);
        let entry = WAVE_TABLE[0];
        for (const e of WAVE_TABLE) {
            if (e.minute <= minute) entry = e;
        }
        return this.weightedPick(entry.weights);
    }

    /** 权重随机抽取 */
    private weightedPick(weights: Partial<Record<EnemyType, number>>): EnemyConfig {
        let total = 0;
        for (const w of Object.values(weights)) total += w ?? 0;
        if (total <= 0) return ENEMY_CONFIGS[EnemyType.BASIC];
        let roll = Math.random() * total;
        for (const type of Object.keys(weights) as EnemyType[]) {
            roll -= weights[type] ?? 0;
            if (roll <= 0) return ENEMY_CONFIGS[type];
        }
        return ENEMY_CONFIGS[EnemyType.BASIC];
    }

    /** 屏幕外随机出生点（玩家当前视口外 120px 的圆周上，并限制在地图边界内） */
    private getSpawnPosition(): cc.Vec3 {
        const visible = cc.view.getVisibleSize();
        const margin = 120;
        const radius = Math.max(visible.width, visible.height) / 2 + margin;
        const angle = Math.random() * Math.PI * 2;
        const dir = cc.v3(Math.cos(angle), Math.sin(angle), 0);

        const player = this.getPlayerNode();
        const base = this.toSpawnerLocal(player);
        const x = Math.min(Math.max(base.x + dir.x * radius, -this.mapHalfWidth), this.mapHalfWidth);
        const y = Math.min(Math.max(base.y + dir.y * radius, -this.mapHalfHeight), this.mapHalfHeight);
        return cc.v3(x, y, 0);
    }

    /** 将玩家世界坐标换算为生成器本地坐标（敌人节点是生成器的子节点） */
    private toSpawnerLocal(player: cc.Node | null): cc.Vec3 {
        if (!player) return cc.v3();
        // 同父节点时直接使用玩家本地坐标（常见布局：Player 与 Spawner 同为 Canvas 子节点）
        if (this.node.parent && player.parent === this.node.parent) {
            return player.position.clone();
        }
        const ui = this.node.parent ? this.node.parent.getComponent(cc.UITransform) : null;
        if (ui) return ui.convertToNodeSpaceAR(player.worldPosition);
        return player.worldPosition.clone();
    }

    /** 获取玩家节点（属性指定 → GameManager → cc.find 兜底） */
    private getPlayerNode(): cc.Node | null {
        if (this.playerNode && this.playerNode.isValid) return this.playerNode;
        const p = GameManager.getInstance().getPlayer();
        if (p && p.isValid) return p;
        return cc.find('Canvas/Player');
    }

    // ==================== 性能分级（500 → 300 → 200） ====================

    /**
     * 每 2 秒统计一次平均帧率：
     *   - 平均帧率 < 30fps → 立即降级（500→300→200），直到最低档
     *   - 平均帧率 > 50fps 且持续 10 秒 → 恢复上一档
     * 降级只压缩生成上限，不清场上已有敌人（顺滑过渡）。
     * 注：最终阈值以 MVP 第一周真机四级压测（100/200/300/500 敌人）实测为准（GDD 9.3）。
     */
    private updatePerformance(dt: number): void {
        if (dt <= 0) return;
        this.fpsSum += 1 / dt;
        this.fpsCount++;
        this.fpsWindow += dt;
        if (this.fpsWindow < 2) return;

        const avg = this.fpsSum / this.fpsCount;
        this.fpsSum = 0;
        this.fpsCount = 0;
        this.fpsWindow = 0;

        if (avg < 30) {
            if (this.perfTier < PERF_TIERS.length - 1) {
                this.perfTier++;
                cc.log(`[Spawner] 帧率不足（${avg.toFixed(0)}fps），同屏上限降级至 ${PERF_TIERS[this.perfTier]}`);
            }
            this.fpsHighTimer = 0;
        } else if (avg > 50) {
            this.fpsHighTimer += 2;
            if (this.fpsHighTimer >= 10 && this.perfTier > 0) {
                this.perfTier--;
                this.fpsHighTimer = 0;
                cc.log(`[Spawner] 帧率充裕（${avg.toFixed(0)}fps），同屏上限恢复至 ${PERF_TIERS[this.perfTier]}`);
            }
        } else {
            this.fpsHighTimer = 0;
        }
    }

    // ==================== 波次广播 / 事件 ====================

    /** 每分钟广播一次波次事件（HUD 波次提示、音频节拍） */
    private updateWaveAnnounce(): void {
        const minute = Math.floor(this.gameTime / 60);
        if (minute !== this.waveMinute) {
            this.waveMinute = minute;
            EventBus.emit(GameEvent.WAVE_STARTED, { minute });
        }
    }

    /** 敌人死亡/回收回调（Enemy.recycle 调用）：计数减一 + 对象池归还 */
    public onEnemyRemoved(enemy: Enemy): void {
        this.activeEnemies = Math.max(0, this.activeEnemies - 1);
        const type = enemy.getType();
        if (type === EnemyType.ELITE) {
            this.activeElites = Math.max(0, this.activeElites - 1);
        } else if (type === EnemyType.BOSS) {
            this.bossActive = false;
            EventBus.emit(GameEvent.BOSS_DEFEATED, { node: enemy.node }); // 结算（道心×2 等）由 GameManager 处理
        }
        this.enemyPool.put(enemy.node); // 归还对象池
    }

    /** 玩家死亡 → 清空场上所有敌人并回池 */
    private onPlayerDied(): void {
        this.clearAll();
    }

    /** 清场（对象池保留，下一局复用） */
    public clearAll(): void {
        const children = this.node.children.slice();
        for (const child of children) {
            const enemy = child.getComponent(Enemy);
            if (enemy) {
                enemy.recycle(); // 内部有 recycled 防重入保护
            } else {
                child.destroy();
            }
        }
        this.activeEnemies = 0;
        this.activeElites = 0;
        this.bossActive = false;
    }
}
