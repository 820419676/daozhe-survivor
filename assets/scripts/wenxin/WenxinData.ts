// ============================================================
// 问心数据定义（天道问心签 · 核心差异化系统）
// ------------------------------------------------------------
// 设计原则（GDD 4.3.4）：前台简单、后台复杂
//   - 前台（玩家可见）：只有档位名 + 星级 + 签文文案，界面零数字
//   - 后台（玩家不可见）：成功率 / 回馈倍率 / 押注比例
// 后台数值统一收敛在 core/GameConfig.GAME_CONFIG.wenxinBackend，
// 此处仅做映射（遵循框架"数值写死在 GameConfig、业务代码只读"的约定）。
// 期望随档位严格递增（+0.33 → +0.58 → +0.66），全档期望为正（正和结构）。
// ============================================================

import { GAME_CONFIG } from '../core/GameConfig';

/** 前台档位（玩家可见）：稳问 ★★★★★ / 搏问 ★★★ / 天问 ★ */
export enum WenxinTier {
    STABLE = 0,   // 稳问 ★★★★★ "天道酬勤，十拿九稳"
    VENTURE = 1,  // 搏问 ★★★   "富贵险中求"
    HEAVEN = 2,   // 天问 ★     "逆天改命，九死一生"
}

/** 后台参数（玩家不可见） */
export interface WenxinBackendParams {
    tier: WenxinTier;
    winRate: number;          // 实际成功率（后台）
    rewardMultiplier: number; // 天道回馈倍率（后台）
    stakeRatio: number;       // 修为押注比例（后台）
}

/** 后台参数表（GAME_CONFIG.wenxinBackend → 档位映射；期望随档位严格递增） */
export const WENXIN_BACKEND: Record<WenxinTier, WenxinBackendParams> = {
    [WenxinTier.STABLE]: {
        tier: WenxinTier.STABLE,
        winRate: GAME_CONFIG.wenxinBackend.stable.winRate,
        rewardMultiplier: GAME_CONFIG.wenxinBackend.stable.rewardMult,
        stakeRatio: GAME_CONFIG.wenxinBackend.stable.stakeRatio,
    },
    [WenxinTier.VENTURE]: {
        tier: WenxinTier.VENTURE,
        winRate: GAME_CONFIG.wenxinBackend.venture.winRate,
        rewardMultiplier: GAME_CONFIG.wenxinBackend.venture.rewardMult,
        stakeRatio: GAME_CONFIG.wenxinBackend.venture.stakeRatio,
    },
    [WenxinTier.HEAVEN]: {
        tier: WenxinTier.HEAVEN,
        winRate: GAME_CONFIG.wenxinBackend.heaven.winRate,
        rewardMultiplier: GAME_CONFIG.wenxinBackend.heaven.rewardMult,
        stakeRatio: GAME_CONFIG.wenxinBackend.heaven.stakeRatio,
    },
};

/** 问心决策倒计时（秒），超时默认稳问（收敛在 GAME_CONFIG.wenxin.decisionWindow） */
export const WENXIN_DECISION_WINDOW = GAME_CONFIG.wenxin.decisionWindow;

/** 前端展示（给 UI 用）：星级 / 签文文案 / 显示颜色 / 奖励与风险说明 */
export interface WenxinFrontendDisplay {
    tier: WenxinTier;
    starCount: number;   // 星级（5/3/1）
    slogan: string;      // 签文文案
    color: string;       // 显示颜色
    /** 奖励文案（成功时获得什么 —— 问心是构筑决策，必须明码标价） */
    rewardText: string;
    /** 风险文案（失败时会发生什么；稳问为"无风险"） */
    riskText: string;
}

export const WENXIN_FRONTEND: Record<WenxinTier, WenxinFrontendDisplay> = {
    [WenxinTier.STABLE]: {
        tier: WenxinTier.STABLE, starCount: 5, slogan: '天道酬勤，十拿九稳', color: '#4CAF50',
        rewardText: '当前最高等级武器 +1',
        riskText: '无风险',
    },
    [WenxinTier.VENTURE]: {
        tier: WenxinTier.VENTURE, starCount: 3, slogan: '富贵险中求', color: '#FF9800',
        rewardText: '随机武器进化进度 +2',
        riskText: '失败：敌人移速 +20%（10 秒）',
    },
    [WenxinTier.HEAVEN]: {
        tier: WenxinTier.HEAVEN, starCount: 1, slogan: '逆天改命，九死一生', color: '#F44336',
        rewardText: '获得一个流派天赋',
        riskText: '失败：立刻降临一只妖王',
    },
};

/** 档位名称（前台展示用） */
export const TIER_NAMES: Record<WenxinTier, string> = {
    [WenxinTier.STABLE]: '稳问',
    [WenxinTier.VENTURE]: '搏问',
    [WenxinTier.HEAVEN]: '天问',
};

/** 一次问心的历史记录 */
export interface WenxinRecord {
    time: number;         // 触发时间（局内秒）
    tier: WenxinTier;     // 选择的档位
    success: boolean;     // 是否功成
    xpGain: number;       // 修为变化（ΔM，可正可负）
    courageGain: number;  // 道心变化
}

/** 问心上下文（生成签文 / 教学轮时用） */
export interface WenxinContext {
    playerLevel: number;
    currentXpMultiplier: number;
    consecutiveWins: number;
    consecutiveLosses: number;
    enemyDensity: number;   // 当前敌人密度
}

/** 天道回馈奖励（修为达到 8x 软顶后，功成转为资源回馈，GDD 4.3.4） */
export interface SoftCapReward {
    stoneMultiplier: number; // 灵石 ×N
    courageBonus: number;    // 道心 +N
    fragmentChance: number;  // 命运碎片概率（0~1）
}

/** 问心结算结果（resolveWenxin 的返回值，供 UI 演出使用） */
export interface WenxinResult {
    tier: WenxinTier;
    success: boolean;
    multiplier: number;          // 结算后的当前修为回馈倍率
    multiplierChange: number;    // 本次修为变化 ΔM
    courageGain: number;         // 本次道心变化
    consecutive: number;         // 当前连渡数（连续功成）
    divineBlessingUsed: boolean; // 是否触发了"天将眷顾"保底
    softCapped: boolean;         // 是否处于天道回馈期（8x 软顶）
    softCapReward: SoftCapReward | null;
    skipped?: boolean;           // 是否为"此局不问"（放弃问心）
}
