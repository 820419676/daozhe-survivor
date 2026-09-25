/**
 * GameConfig.ts —— 全局游戏配置常量
 *
 * 所有可调数值统一收敛在此处，业务代码一律读取本配置，
 * 方便数值调优与远程配置下发，禁止把数值写死在其它代码里。
 */

/** 调试 UI（右下角可玩状态面板）：正式版改为 false 即可整体关闭 */
export const DEBUG_UI = true;

/** 2 分钟测试模式（仅开发环境）：开局时长 120 秒、跳过问心、无终局 Boss */
export const TEST_2MIN_MODE = true;

export const GAME_CONFIG = {
    /** 模式时长（秒）：试炼15分钟 / 深度30分钟 / 极速10分钟 / 2分钟开发测试 */
    modes: { trial: 900, deep: 1800, speed: 600, test2Min: 120 },

    /** 开发 / 调试开关 */
    debug: {
        /** 右下角可玩状态调试面板（Enemies/Kills/XP/Weapon/State） */
        debugUi: DEBUG_UI,
        /** 2 分钟测试模式（验证完整循环用；正式版置 false 恢复 15 分钟试炼） */
        test2Minute: TEST_2MIN_MODE,
    },

    /** 问心系统配置 */
    wenxin: {
        /** 默认触发间隔（秒） */
        defaultInterval: 90,
        /** AB测试间隔分组（秒）：60 / 90 / 120 */
        abTestIntervals: [60, 90, 120],
        /** 问心决策窗口（秒）：弹窗出现后玩家需在窗口内做出选择 */
        decisionWindow: 3,
    },

    /** 同屏性能分级（敌人数） */
    screen: {
        /** MVP 同屏敌人数上限（验收：60） */
        maxEnemies: 60,
        /** 第二档：敌人数量降级阈值（MVP 暂不启用，保留字段） */
        degradeLevel2: 120,
        /** 第三档：进一步降级阈值 */
        degradeLevel3: 200,
    },

    /** 玩家基础属性 */
    player: {
        /** 基础移速（像素/秒） */
        baseSpeed: 200,
        /** 经验拾取磁吸范围（像素；略大于剑阵轨道半径 140，击杀掉落的灵珠立即飞向玩家） */
        magnetRange: 150,
        /** 受击无敌帧时长（秒）：敌人接触/弹幕命中的最小间隔 */
        invincibleFrames: 0.8,
        /** 受击判定半径（像素；敌人接触与弹幕命中的距离判定用） */
        hitRadius: 22,
    },

    /** 经验与升级（MVP 节奏：1 级仅需 10 点，首局 30–45 秒内必升 2 级） */
    xp: {
        /** 1级升2级所需经验 */
        baseRequirement: 10,
        /** 每级经验需求增长率 */
        growthFactor: 1.2,
        /** 单个经验玉价值 */
        gemValue: 1,
    },

    /** 御风步（唯一主动技能：移动 + 一个主动按钮，保持操作极简） */
    dash: {
        /** 冷却（秒） */
        cooldown: 6,
        /** 冲刺距离（像素） */
        distance: 180,
        /** 冲刺时长（秒；期间无敌） */
        duration: 0.18,
        /** 冲刺路径判定半径（像素，用于击退并统计穿过的敌人） */
        hitRadius: 46,
        /** 一次冲刺穿过该数量以上敌人 → "身法绝妙"横幅 */
        perfectCount: 3,
        /** 穿过敌人时的击退力度系数 */
        knockback: 1.2,
        /** 冲刺对穿过敌人造成的伤害（灵脉奖励"冲刺伤害翻倍"会 ×2） */
        damage: 20,
    },

    /** 灵脉（地图资源点：把移动从"单纯逃跑"变成"主动决定是否冒险抢资源"） */
    lingmai: {
        /** 生成间隔（秒） */
        interval: 35,
        /** 与玩家的距离下限（像素） */
        minDistance: 350,
        /** 与玩家的距离上限（像素） */
        maxDistance: 500,
        /** 采集所需停留时长（秒；离开则进度清零） */
        holdSeconds: 3,
        /** 法阵判定半径（像素） */
        radius: 62,
        /** 未采集自动消失时长（秒） */
        lifetime: 20,
        /** 经验奖励：灵珠颗数与单颗价值（合计 24 点，远高于普通刷怪） */
        xpOrbs: 12,
        xpPerOrb: 2,
        /** 武器伤害奖励（本局 +15%） */
        damageBonus: 0.15,
    },

    /** 精英妖王（P1：每 45 秒一只，必须有可躲避的技能预警） */
    elite: {
        /** 出现间隔（秒），首次出现即第 45 秒 */
        interval: 45,
        /** 火圈技能：冷却 / 预警时长 / 半径 / 伤害倍率（相对精英接触伤害） */
        novaInterval: 6,
        novaTelegraph: 0.9,
        novaRadius: 210,
        novaDamageMultiplier: 2.2,
    },

    /** 宝箱（精英掉落；开启后三选一） */
    chest: {
        /** 开启判定半径（像素） */
        radius: 54,
        /** 未开启自动消失时长（秒） */
        lifetime: 30,
    },

    /**
     * 问心后台参数（玩家不可见）
     * 稳心境 / 进取境 / 天道境 的胜率、奖励倍率与下注比例
     */
    wenxinBackend: {
        stable: { winRate: 0.85, rewardMult: 2.0, stakeRatio: 0.2 },
        venture: { winRate: 0.65, rewardMult: 2.5, stakeRatio: 0.4 },
        heaven: { winRate: 0.40, rewardMult: 3.5, stakeRatio: 0.6 },
    },
};
