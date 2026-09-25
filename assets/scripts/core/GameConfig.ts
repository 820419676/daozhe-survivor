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
