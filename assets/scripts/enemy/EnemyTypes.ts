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
import { Color } from 'cc';

/** 敌人类型枚举 */
export enum EnemyType {
    /** 小妖：近战追踪（红色菱形，炮灰主力） */
    BASIC = 'basic',
    /** 分裂小妖：血量低，死亡分裂为 2 个子体（浅红小菱形） */
    SPLITTER = 'splitter',
    /** 散修：远程弹幕，保持距离风筝（紫色三角形） */
    RANGED = 'ranged',
    /** 冲锋妖兽：预警线 → 高速直线冲锋 → 撞墙/未命中后眩晕（橙红六边形） */
    CHARGE = 'charge',
    /** 妖王：精英（高HP/光环/宝箱掉落） */
    ELITE = 'elite',
    /** 天劫之主：Boss（终局九重天劫） */
    BOSS = 'boss',
}

/** 冲锋技能参数（冲锋妖兽专属；让玩家必须观察与走位） */
export interface ChargeSkillConfig {
    /** 冷却（秒）：每该时间锁定一次玩家当前位置 */
    interval: number;
    /** 预警时长（秒）：红色预警线显示时间，玩家据此走位 */
    telegraph: number;
    /** 冲锋速度（px/s） */
    speed: number;
    /** 最大冲锋距离（px；未命中且未撞墙时按此结束） */
    maxDistance: number;
    /** 冲锋结束后的眩晕时长（秒；眩晕期间承受双倍伤害） */
    stun: number;
    /** 预警线宽度（px） */
    warningWidth: number;
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
    color: Color;
    /** 是否远程弹幕 */
    canShoot: boolean;
    /** 弹幕发射间隔（秒） */
    shootInterval: number;
    /** 接触攻击间隔（秒；贴身后每隔该时间造成一次伤害，实际频率受玩家无敌帧限制） */
    attackInterval: number;
    /** 分裂参数（分裂小妖：死亡后分裂为 N 个子体，子体不再分裂；省略/0 = 不分裂） */
    splitsInto?: number;
    /** 冲锋技能参数（冲锋妖兽专属；省略 = 无冲锋技能） */
    chargeSkill?: ChargeSkillConfig;
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
        damage: 5,       // 玩家 100 HP 约可挨 20 下（配合 0.8s 无敌帧 ≈ 连续贴身 16 秒）
        speed: 90,
        xpDrop: 1,       // 蓝宝石 = 1 点经验
        goldDrop: 1,
        size: 24,
        color: new Color(225, 88, 112), // 赤红，首屏可与玩家/灵珠明确区分
        canShoot: false,
        shootInterval: 0,
        attackInterval: 1.0,
        isBoss: false,
        chestDropRate: 0.005, // 0.5%
        knockResistance: 0,
    },

    // ---------------- 分裂小妖（低血量，死亡分裂，高收益但扩大包围圈） ----------------
    [EnemyType.SPLITTER]: {
        type: EnemyType.SPLITTER,
        displayName: '分裂小妖',
        hp: 10,          // 血量低，容易被清掉——但清掉之后会变两只
        damage: 4,
        speed: 100,
        xpDrop: 2,       // 合计收益高于普通妖（本体 2 + 两个子体各 1）
        goldDrop: 2,
        size: 22,
        color: new Color(255, 156, 156), // 浅红（与赤红普通妖区分）
        canShoot: false,
        shootInterval: 0,
        attackInterval: 1.0,
        splitsInto: 2,   // 死亡 → 2 个子体（子体不再分裂）
        isBoss: false,
        chestDropRate: 0.005,
        knockResistance: 0,
    },

    // ---------------- 冲锋妖兽（60 秒后登场：预警 → 冲锋 → 眩晕可反击） ----------------
    [EnemyType.CHARGE]: {
        type: EnemyType.CHARGE,
        displayName: '冲锋妖兽',
        hp: 60,
        damage: 8,
        speed: 70,       // 平时慢速逼近
        xpDrop: 3,
        goldDrop: 6,
        size: 34,
        color: new Color(255, 132, 60), // 橙红六边形（体型大于普通妖的 24）
        canShoot: false,
        shootInterval: 0,
        attackInterval: 1.0,
        chargeSkill: {
            interval: 7,        // 每 7 秒锁定一次玩家位置
            telegraph: 0.7,     // 红色预警线 0.7 秒
            speed: 700,         // 冲锋速度
            maxDistance: 620,   // 最大冲锋距离
            stun: 1.0,          // 撞墙/未命中后眩晕 1 秒（承伤 ×2）
            warningWidth: 46,   // 预警线宽度
        },
        isBoss: false,
        chestDropRate: 0.01,
        knockResistance: 0.35, // 体型厚重，不易被击退
    },

    // ---------------- 散修（远程弹幕，风筝怪） ----------------
    [EnemyType.RANGED]: {
        type: EnemyType.RANGED,
        displayName: '散修',
        hp: 12,          // 脆皮，鼓励玩家优先集火
        damage: 4,
        speed: 65,       // 慢速，维持 260px 攻击距离
        xpDrop: 2,
        goldDrop: 2,
        size: 26,
        color: new Color(156, 116, 214), // 紫
        canShoot: true,
        shootInterval: 2.4,
        attackInterval: 1.2,
        isBoss: false,
        chestDropRate: 0.005, // 0.5%
        knockResistance: 0,
    },

    // ---------------- 妖王（精英：高HP/光环/宝箱掉落） ----------------
    [EnemyType.ELITE]: {
        type: EnemyType.ELITE,
        displayName: '妖王',
        hp: 1500,        // 按 1500 × (1 + 0.12×分钟) 缩放
        damage: 10,
        speed: 120,      // 追击型精英
        xpDrop: 5,       // 紫宝石 = 5 点经验
        goldDrop: 25,
        size: 60,
        color: new Color(255, 112, 40), // 橙红（六边形精英，验收视觉）
        canShoot: false, // 技能系统后续接入：冲锋 / 放射弹 / 召唤杂鱼
        shootInterval: 0,
        attackInterval: 1.2,
        isBoss: false,
        chestDropRate: 1, // 100% 掉宝箱（GDD 4.2.6）
        knockResistance: 0.6,
    },

    // ---------------- 天劫之主（终局 Boss：九重天劫） ----------------
    [EnemyType.BOSS]: {
        type: EnemyType.BOSS,
        displayName: '天劫之主',
        hp: 9000,        // 占位基础值，生成时由 Spawner 按玩家 DPS 动态覆盖
        damage: 18,
        speed: 100,
        xpDrop: 200,     // 大量经验
        goldDrop: 300,
        size: 140,
        color: new Color(92, 44, 148), // 暗紫（雷劫意象）
        canShoot: true,
        shootInterval: 1.6, // 8 向弹幕，P2 狂暴后 ×0.6
        attackInterval: 1.0,
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
