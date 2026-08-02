/**
 * EnemyTypes.ts —— 敌人类型枚举、配置表与物理分组
 *
 * 《问道幸存者》敌人体系（修仙主题命名，对应 GDD 反派设定）：
 *   - 小妖（basic）：近战追踪，炮灰主力
 *   - 散修（ranged）：远程弹幕，保持距离风筝
 *   - 妖王（elite）：精英，高血量，100% 掉宝箱（技能系统后续接入：冲锋/放射弹/召唤）
 *   - 天劫之主（boss）：终局九重天劫 Boss，阶段行为（P2 半血狂暴），掉落传说宝箱
 *
 * 数值依据（GDD 4.4 敌人曲线）：
 *   - 普通怪血量按 20 × 1.35^分钟 时间缩放（生成时在 Enemy.init 中应用）
 *   - 妖王血量按 1500 × (1 + 0.12×分钟) 缩放
 *   - 天劫之主血量 = 玩家预测 30 秒 DPS × 20（炼气试炼）/ ×35（渡劫模式），
 *     由 EnemySpawner 在生成时动态计算并覆盖 hp 字段
 *   - 宝箱掉率：普通怪 0.5%，妖王/天劫之主 100%（GDD 4.2.6）
 */
import * as cc from 'cc';

/** 敌人类型枚举 */
export enum EnemyType {
    /** 小妖：近战追踪 */
    BASIC = 'basic',
    /** 散修：远程弹幕 */
    RANGED = 'ranged',
    /** 妖王：精英（高HP/光环/宝箱掉落） */
    ELITE = 'elite',
    /** 天劫之主：Boss（终局九重天劫） */
    BOSS = 'boss',
}

/** 敌人配置（数值为时间 0 时的基础值，生成时按游戏时间缩放） */
export interface EnemyConfig {
    /** 敌人类型 */
    type: EnemyType;
    /** 修仙主题显示名（HUD / 击杀提示使用） */
    displayName: string;
    /** 基础血量 */
    hp: number;
    /** 对玩家伤害 */
    damage: number;
    /** 移动速度（px/s） */
    speed: number;
    /** 经验宝石数量（蓝=1 / 紫=5，GDD 4.2.3） */
    xpDrop: number;
    /** 灵石掉落数量 */
    goldDrop: number;
    /** 碰撞/显示尺寸（px） */
    size: number;
    /** 形象颜色（区分类型，预制体共用时按类型染色） */
    color: cc.Color;
    /** 是否远程弹幕 */
    canShoot: boolean;
    /** 弹幕发射间隔（秒） */
    shootInterval: number;
    /** 是否 Boss */
    isBoss: boolean;
    /** 宝箱掉落率（0~1；普通 0.5%，精英/Boss 100%） */
    chestDropRate: number;
    /** 击退抗性（0~1，精英/Boss 越高越难被推走） */
    knockResistance: number;
}

/** 所有敌人类型的配置表 */
export const ENEMY_CONFIGS: Record<EnemyType, EnemyConfig> = {
    // ---------------- 小妖（近战追踪，炮灰主力） ----------------
    [EnemyType.BASIC]: {
        type: EnemyType.BASIC,
        displayName: '小妖',
        hp: 20,          // 基础血量，随 1.35^分钟 增长
        damage: 8,       // 玩家 100 HP 约可挨 12 下，配合 0.5s 无敌帧
        speed: 90,
        xpDrop: 1,       // 蓝宝石 = 1 点经验
        goldDrop: 1,
        size: 24,
        color: new cc.Color(139, 157, 195), // 灰蓝
        canShoot: false,
        shootInterval: 0,
        isBoss: false,
        chestDropRate: 0.005, // 0.5%
        knockResistance: 0,
    },

    // ---------------- 散修（远程弹幕，风筝怪） ----------------
    [EnemyType.RANGED]: {
        type: EnemyType.RANGED,
        displayName: '散修',
        hp: 12,          // 脆皮，鼓励玩家优先集火
        damage: 6,
        speed: 65,       // 慢速，维持 260px 攻击距离
        xpDrop: 2,
        goldDrop: 2,
        size: 26,
        color: new cc.Color(156, 116, 214), // 紫
        canShoot: true,
        shootInterval: 2.4,
        isBoss: false,
        chestDropRate: 0.005, // 0.5%
        knockResistance: 0,
    },

    // ---------------- 妖王（精英：高HP/光环/宝箱掉落） ----------------
    [EnemyType.ELITE]: {
        type: EnemyType.ELITE,
        displayName: '妖王',
        hp: 1500,        // 按 1500 × (1 + 0.12×分钟) 缩放
        damage: 15,
        speed: 120,      // 追击型精英
        xpDrop: 5,       // 紫宝石 = 5 点经验
        goldDrop: 25,
        size: 60,
        color: new cc.Color(196, 62, 62), // 猩红
        canShoot: false, // 技能系统后续接入：冲锋 / 放射弹 / 召唤杂鱼
        shootInterval: 0,
        isBoss: false,
        chestDropRate: 1, // 100% 掉宝箱（GDD 4.2.6）
        knockResistance: 0.6,
    },

    // ---------------- 天劫之主（终局 Boss：九重天劫） ----------------
    [EnemyType.BOSS]: {
        type: EnemyType.BOSS,
        displayName: '天劫之主',
        hp: 9000,        // 占位基础值，生成时由 Spawner 按玩家 DPS 动态覆盖
        damage: 30,
        speed: 100,
        xpDrop: 200,     // 大量经验
        goldDrop: 300,
        size: 140,
        color: new cc.Color(92, 44, 148), // 暗紫（雷劫意象）
        canShoot: true,
        shootInterval: 1.1, // 8 向弹幕，P2 狂暴后 ×0.6
        isBoss: true,
        chestDropRate: 1,   // 传说宝箱
        knockResistance: 0.85,
    },
};

/**
 * 物理分组（位掩码）
 * 注意：需与项目「项目设置 → 物理系统 → 分组」中配置的组索引保持一致。
 * 分组由本常量统一定义，拾取物系统（XP宝石/灵石/宝箱）生成时也请使用本常量设置碰撞组。
 */
export const PhysicsGroups = {
    DEFAULT: 1 << 0,
    PLAYER: 1 << 1,
    ENEMY: 1 << 2,
    ENEMY_BULLET: 1 << 3,
    XP_GEM: 1 << 4,
    GOLD: 1 << 5,
    CHEST: 1 << 6,
} as const;
