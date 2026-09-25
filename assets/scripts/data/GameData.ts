/**
 * GameData.ts —— 游戏数据统一访问层
 *
 * 职责：
 *   - 整合静态 TypeScript 配置（WeaponData / PassiveData / EnemyTypes）
 *     与动态 JSON 配置（ConfigLoader 加载的远程覆盖层）
 *   - 提供类型安全的统一数据访问接口
 *   - 作为全局单例，供各游戏系统查询配置
 *
 * 数据优先级：
 *   JSON 远程配置 > TypeScript 静态配置
 *   （JSON 存在时覆盖静态值，用于热更新/AB测试；不存在时使用静态默认值）
 *
 * 使用方式：
 *   const data = GameData.getInstance();
 *   data.init();  // 初始化（加载 JSON 覆盖层）
 *   const weaponCfg = data.getWeaponConfig('sword');
 */
import { log } from 'cc';
import { ConfigLoader, WeaponConfigRaw, EnemyConfigRaw } from './ConfigLoader';
import { WEAPON_CONFIGS, WeaponType } from '../combat/WeaponData';
import { ENEMY_CONFIGS, EnemyType, EnemyConfig } from '../enemy/EnemyTypes';
import { PASSIVE_CONFIGS } from '../combat/PassiveData';

export class GameData {
    private static instance: GameData;

    private configLoader: ConfigLoader = new ConfigLoader();
    private weaponOverrides: Map<string, WeaponConfigRaw> = new Map();
    private enemyOverrides: Map<string, EnemyConfigRaw> = new Map();

    static getInstance(): GameData {
        if (!GameData.instance) {
            GameData.instance = new GameData();
        }
        return GameData.instance;
    }

    /** 初始化：加载 JSON 配置覆盖层（可选，不影响静态配置可用性） */
    async init(): Promise<void> {
        try {
            await this.configLoader.loadAll();
            // 构建覆盖索引
            for (const w of this.configLoader.getWeapons()) {
                if (w.id) this.weaponOverrides.set(w.id, w);
            }
            for (const e of this.configLoader.getEnemies()) {
                if (e.id) this.enemyOverrides.set(e.id, e);
            }
            log(`[GameData] 初始化完成：武器覆盖 ${this.weaponOverrides.size}，敌人覆盖 ${this.enemyOverrides.size}`);
        } catch (e) {
            log('[GameData] JSON 覆盖层加载失败，使用纯静态配置');
        }
    }

    // ==================== 武器数据 ====================

    /** 获取武器配置（静态 WEAPON_CONFIGS，支持按 WeaponType 枚举查询） */
    getWeaponConfig(type: WeaponType) {
        return WEAPON_CONFIGS[type];
    }

    /** 获取全部武器配置 */
    getAllWeapons() {
        return WEAPON_CONFIGS;
    }

    /** 获取武器 JSON 覆盖（如有） */
    getWeaponOverride(id: string): WeaponConfigRaw | undefined {
        return this.weaponOverrides.get(id);
    }

    // ==================== 敌人数据 ====================

    /** 获取敌人配置（静态 ENEMY_CONFIGS，支持按 EnemyType 枚举查询） */
    getEnemyConfig(type: EnemyType): EnemyConfig {
        return ENEMY_CONFIGS[type];
    }

    /** 获取全部敌人配置 */
    getAllEnemies() {
        return ENEMY_CONFIGS;
    }

    /** 获取敌人 JSON 覆盖（如有） */
    getEnemyOverride(id: string): EnemyConfigRaw | undefined {
        return this.enemyOverrides.get(id);
    }

    // ==================== 被动数据 ====================

    /** 获取被动技能配置 */
    getPassiveConfigs() {
        return PASSIVE_CONFIGS;
    }

    // ==================== 配置加载器 ====================

    /** 获取底层 ConfigLoader（供高级用法直接访问 JSON 数据） */
    getConfigLoader(): ConfigLoader {
        return this.configLoader;
    }

    /** 是否已完成 JSON 配置加载 */
    isLoaded(): boolean {
        return this.configLoader.isLoaded();
    }
}
