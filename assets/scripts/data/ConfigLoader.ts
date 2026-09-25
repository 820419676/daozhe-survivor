/**
 * ConfigLoader.ts —— 资源配置加载器
 *
 * 职责：
 *   - 从 resources/ 目录加载 JSON 配置文件（weapons.json / enemy.json / skills.json）
 *   - 提供统一的异步加载接口
 *   - 支持配置缓存与热更新覆盖
 *
 * 使用方式：
 *   const loader = new ConfigLoader();
 *   await loader.loadAll();
 *   const weapons = loader.getWeapons();
 *
 * 注意：
 *   JSON 文件需放置在 assets/resources/ 目录下才能被 resources.load() 加载。
 *   当前版本优先使用 TypeScript 静态配置（WeaponData / EnemyTypes / PassiveData），
 *   JSON 配置作为远程热更新/AB测试的覆盖层（可选）。
 */
import { resources, JsonAsset, log, warn } from 'cc';

/** 武器配置原始数据（JSON 格式） */
export interface WeaponConfigRaw {
    id: string;
    name: string;
    type: string;
    damage: number;
    cooldown: number;
    projectileCount?: number;
    area?: number;
    speed?: number;
    knockback?: number;
    [key: string]: unknown;
}

/** 敌人配置原始数据（JSON 格式） */
export interface EnemyConfigRaw {
    id: string;
    type: string;
    displayName: string;
    hp: number;
    damage: number;
    speed: number;
    xpDrop: number;
    goldDrop: number;
    size: number;
    [key: string]: unknown;
}

/** 技能配置原始数据（JSON 格式） */
export interface SkillConfigRaw {
    id: string;
    name: string;
    description: string;
    type: string;
    [key: string]: unknown;
}

export class ConfigLoader {
    private weapons: WeaponConfigRaw[] = [];
    private enemies: EnemyConfigRaw[] = [];
    private skills: SkillConfigRaw[] = [];
    private loaded: boolean = false;

    /** 是否已完成加载 */
    isLoaded(): boolean {
        return this.loaded;
    }

    /** 加载全部配置文件 */
    async loadAll(): Promise<void> {
        await Promise.all([
            this.loadWeapons(),
            this.loadEnemies(),
            this.loadSkills(),
        ]);
        this.loaded = true;
        log('[ConfigLoader] 全部配置加载完成');
    }

    /** 加载武器配置 */
    async loadWeapons(): Promise<WeaponConfigRaw[]> {
        try {
            const asset = await this.loadJson<WeaponConfigRaw[]>('weapons');
            this.weapons = asset ?? [];
            log(`[ConfigLoader] 武器配置加载完成：${this.weapons.length} 条`);
        } catch (e) {
            warn('[ConfigLoader] weapons.json 未找到或加载失败，使用静态配置');
        }
        return this.weapons;
    }

    /** 加载敌人配置 */
    async loadEnemies(): Promise<EnemyConfigRaw[]> {
        try {
            const asset = await this.loadJson<EnemyConfigRaw[]>('enemy');
            this.enemies = asset ?? [];
            log(`[ConfigLoader] 敌人配置加载完成：${this.enemies.length} 条`);
        } catch (e) {
            warn('[ConfigLoader] enemy.json 未找到或加载失败，使用静态配置');
        }
        return this.enemies;
    }

    /** 加载技能配置 */
    async loadSkills(): Promise<SkillConfigRaw[]> {
        try {
            const asset = await this.loadJson<SkillConfigRaw[]>('skills');
            this.skills = asset ?? [];
            log(`[ConfigLoader] 技能配置加载完成：${this.skills.length} 条`);
        } catch (e) {
            warn('[ConfigLoader] skills.json 未找到或加载失败，使用静态配置');
        }
        return this.skills;
    }

    /** 获取武器配置 */
    getWeapons(): WeaponConfigRaw[] {
        return this.weapons;
    }

    /** 获取敌人配置 */
    getEnemies(): EnemyConfigRaw[] {
        return this.enemies;
    }

    /** 获取技能配置 */
    getSkills(): SkillConfigRaw[] {
        return this.skills;
    }

    /**
     * 通用 JSON 加载（Promise 封装 resources.load）
     * @param path resources/ 目录下的相对路径（不含扩展名）
     */
    private loadJson<T>(path: string): Promise<T | null> {
        return new Promise<T | null>((resolve, reject) => {
            resources.load(path, JsonAsset, (err, asset) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(asset.json as T);
            });
        });
    }
}
