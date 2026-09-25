/**
 * WeaponData.ts — 武器数据表（《问道幸存者》MVP）
 *
 * 6 把基础武器 + 6 把进化武器。
 * 进化规则：武器升满级（WEAPON_MAX_LEVEL = 8）且持有对应被动（evolutionPair）时，
 * 由 WeaponSystem.checkEvolution 触发，替换为 evolutionId 对应的进化武器。
 *
 * 数值约定：
 *  - area  范围系数，实际像素半径 = area × 100
 *  - speed 弹幕速度（px/秒）
 *  - cooldown 冷却时间（秒）
 *  - duration 持续时间（秒）
 */

/** 武器类型枚举 */
export enum WeaponType {
    PROJECTILE, // 散射弹幕（寒冰掌）
    AURA,       // 光环（烈焰环）
    LIGHTNING,  // 天雷（雷霆符）
    ORBITAL,    // 环绕（太极剑阵）
    PIERCING,   // 贯穿（飞剑术）
    STORM,      // 剑雨（万剑诀）
}

export interface WeaponConfig {
    id: string;
    name: string;           // 中文名
    description: string;    // 描述
    type: WeaponType;
    baseDamage: number;
    cooldown: number;       // 秒
    projectileCount: number;
    area: number;           // 范围系数（×100px = 实际半径）
    duration: number;       // 持续（秒）
    speed: number;          // 弹幕速度（px/秒）
    piercing: boolean;      // 穿透
    knockback: number;      // 击退力度
    evolutionPair: string;  // 进化所需被动id（空串表示不可进化）
    evolutionId: string;    // 进化后武器id（空串表示最终形态）
    targeting: 'nearest' | 'random' | 'frontal' | 'all';
}

export const WEAPON_CONFIGS: Record<string, WeaponConfig> = {
    // ==================== 基础武器（6 把） ====================

    /** 太极剑阵 — 环绕型，飞剑绕周身持续切割 */
    'sword_array': {
        id: 'sword_array', name: '太极剑阵', description: '飞剑环绕周身',
        type: WeaponType.ORBITAL, baseDamage: 15, cooldown: 3, projectileCount: 3,
        area: 1.2, duration: 0, speed: 300, piercing: true, knockback: 0.3,
        evolutionPair: 'taoist_nature', evolutionId: 'eight_trigrams',
        targeting: 'all'
    },
    /** 雷霆符 — 随机天雷轰击落点范围伤害 */
    'thunder_talisman': {
        id: 'thunder_talisman', name: '雷霆符', description: '随机天雷轰击',
        type: WeaponType.LIGHTNING, baseDamage: 35, cooldown: 2, projectileCount: 1,
        area: 2, duration: 0.35, speed: 0, piercing: true, knockback: 0.5,
        evolutionPair: 'heavenly_secret', evolutionId: 'nine_heaven_thunder',
        targeting: 'random'
    },
    /** 寒冰掌 — 前方扇形冰霜散射，非穿透 */
    'ice_palm': {
        id: 'ice_palm', name: '寒冰掌', description: '前方扇形冰霜',
        type: WeaponType.PROJECTILE, baseDamage: 20, cooldown: 1.5, projectileCount: 5,
        area: 0.8, duration: 0.5, speed: 400, piercing: false, knockback: 0.8,
        evolutionPair: 'spirit_bone', evolutionId: 'absolute_zero',
        targeting: 'frontal'
    },
    /** 烈焰环 — 周期性火焰光环（以玩家为中心的范围灼烧） */
    'flame_ring': {
        id: 'flame_ring', name: '烈焰环', description: '周期性火焰光环',
        type: WeaponType.AURA, baseDamage: 25, cooldown: 4, projectileCount: 1,
        area: 1.5, duration: 1.5, speed: 0, piercing: true, knockback: 0.2,
        evolutionPair: 'spirit_guard', evolutionId: 'phoenix_rebirth',
        targeting: 'all'
    },
    /** 飞剑术 — 朝最近敌人发射高速贯穿飞剑 */
    'flying_sword': {
        id: 'flying_sword', name: '飞剑术', description: '直线贯穿飞剑',
        type: WeaponType.PIERCING, baseDamage: 30, cooldown: 1, projectileCount: 1,
        area: 0.3, duration: 0, speed: 800, piercing: true, knockback: 0.1,
        evolutionPair: 'taoist_nature', evolutionId: 'thousand_swords',
        targeting: 'nearest'
    },
    /** 万剑诀 — 全屏剑雨（随机落点，落地范围伤害） */
    'sword_storm': {
        id: 'sword_storm', name: '万剑诀', description: '全屏剑雨',
        type: WeaponType.STORM, baseDamage: 18, cooldown: 6, projectileCount: 20,
        area: 3, duration: 0.3, speed: 600, piercing: false, knockback: 0.3,
        evolutionPair: 'heavenly_secret', evolutionId: 'celestial_sword_rain',
        targeting: 'random'
    },

    // ==================== 进化武器（6 把，MVP 内置以保证 checkEvolution 可落地） ====================

    /** 太极剑阵 + 道法自然 → 八阵剑图 */
    'eight_trigrams': {
        id: 'eight_trigrams', name: '八阵剑图', description: '八柄飞剑，阴阳相济，剑光织成阵图',
        type: WeaponType.ORBITAL, baseDamage: 30, cooldown: 2.5, projectileCount: 8,
        area: 1.6, duration: 0, speed: 360, piercing: true, knockback: 0.5,
        evolutionPair: '', evolutionId: '',
        targeting: 'all'
    },
    /** 雷霆符 + 天机推演 → 九霄神雷 */
    'nine_heaven_thunder': {
        id: 'nine_heaven_thunder', name: '九霄神雷', description: '天雷滚滚，三雷连击，万物辟易',
        type: WeaponType.LIGHTNING, baseDamage: 80, cooldown: 1.8, projectileCount: 3,
        area: 3, duration: 0.4, speed: 0, piercing: true, knockback: 0.8,
        evolutionPair: '', evolutionId: '',
        targeting: 'random'
    },
    /** 寒冰掌 + 仙骨丹 → 绝对零度 */
    'absolute_zero': {
        id: 'absolute_zero', name: '绝对零度', description: '七道寒芒，冰封百里',
        type: WeaponType.PROJECTILE, baseDamage: 45, cooldown: 1.2, projectileCount: 7,
        area: 1.2, duration: 0.8, speed: 520, piercing: false, knockback: 1.2,
        evolutionPair: '', evolutionId: '',
        targeting: 'frontal'
    },
    /** 烈焰环 + 灵气护体 → 凤火涅槃 */
    'phoenix_rebirth': {
        id: 'phoenix_rebirth', name: '凤火涅槃', description: '火凤展翅，焚尽八荒',
        type: WeaponType.AURA, baseDamage: 55, cooldown: 3, projectileCount: 1,
        area: 2.2, duration: 2.5, speed: 0, piercing: true, knockback: 0.4,
        evolutionPair: '', evolutionId: '',
        targeting: 'all'
    },
    /** 飞剑术 + 道法自然 → 千剑诀 */
    'thousand_swords': {
        id: 'thousand_swords', name: '千剑诀', description: '一剑化千，三剑齐发，贯穿一切',
        type: WeaponType.PIERCING, baseDamage: 60, cooldown: 0.7, projectileCount: 3,
        area: 0.4, duration: 0, speed: 950, piercing: true, knockback: 0.2,
        evolutionPair: '', evolutionId: '',
        targeting: 'nearest'
    },
    /** 万剑诀 + 天机推演 → 天剑雨幕 */
    'celestial_sword_rain': {
        id: 'celestial_sword_rain', name: '天剑雨幕', description: '天剑如雨，遮天蔽日',
        type: WeaponType.STORM, baseDamage: 40, cooldown: 4.5, projectileCount: 30,
        area: 4, duration: 0.4, speed: 650, piercing: false, knockback: 0.4,
        evolutionPair: '', evolutionId: '',
        targeting: 'random'
    },
};

/** 按 id 获取武器配置（不存在返回 undefined） */
export function getWeaponConfig(id: string): WeaponConfig | undefined {
    return WEAPON_CONFIGS[id];
}
