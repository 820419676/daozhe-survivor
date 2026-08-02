/**
 * GameConfig.ts —— 全局游戏配置常量
 *
 * 所有可调数值统一收敛在此处，业务代码一律读取本配置，
 * 方便数值调优与远程配置下发，禁止把数值写死在其它代码里。
 */

export const GAME_CONFIG = {
    /** 模式时长（秒）：试炼15分钟 / 深度30分钟 / 极速10分钟 */
    modes: { trial: 900, deep: 1800, speed: 600 },

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
        /** 最高同屏敌人数 */
        maxEnemies: 500,
        /** 第二档：敌人数量降级阈值（触发特效/刷新率降级） */
        degradeLevel2: 300,
        /** 第三档：进一步降级阈值 */
        degradeLevel3: 200,
    },

    /** 玩家基础属性 */
    player: {
        /** 基础移速（像素/秒） */
        baseSpeed: 200,
        /** 经验拾取磁吸范围（像素） */
        magnetRange: 80,
        /** 受击无敌帧时长（秒） */
        invincibleFrames: 0.5,
    },

    /** 经验与升级 */
    xp: {
        /** 1级升2级所需经验 */
        baseRequirement: 20,
        /** 每级经验需求增长率 */
        growthFactor: 1.15,
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
