// ============================================================
// WenxinManager —— 问心核心管理器（单例 Component，核心差异化逻辑）
// ------------------------------------------------------------
// 集成说明（依赖 core/GameManager 的暂停栈与事件流）：
//   - 主触发：core/GameManager 每 90 秒发 WENXIN_TRIGGER 并自动暂停
//     （时间流速降至 20%，GDD 4.3.2；本组件监听该事件维护教学轮/连渡/
//     密度等局内状态）；碎片轮等主动触发请调用本组件的 triggerWenxin()。
//   - 结算：WenxinUI 选择档位后调用 resolveWenxin()，
//     广播 WENXIN_RESULT → core/GameManager 自动恢复游戏。
//   - 玩家数据：通过 core/PlayerRegistry 绑定 PlayerData，
//     同步 xpMultiplier / consecutiveWins / bravery 三个问心字段。
//
// 后台数学（GDD 4.3.4，玩家不可见）：
//   功成：ΔM = M × 押注比例 × 回馈倍率（如 M=1.0 天问功成 → 1.0+0.6×3.5=3.1）
//   未竟：ΔM = −M × 押注比例 × 0.5（受创系数，损失减半），下限 0.5x 永不跌穿
//   软顶：M ≥ 8 后功成不再加 M，转为天道回馈（灵石/道心/碎片）；未竟不减 M（天道护持）
//   保底：连续 4 次未竟后第 5 次功成率上调至 90%（"天将眷顾"，连败 3 次起浮现征兆）
//   教学：前两次问心为教学轮（首问必成 / 受创教学必败，GDD 3.6）
//
// 挂载：任意场景节点（与 GameManager 同节点即可，自动注册单例）。
// ============================================================

import { _decorator, Component } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GameManager, GameState, PauseReason } from '../core/GameManager';
import { PlayerRegistry } from '../core/PlayerRegistry';
import {
    WENXIN_BACKEND,
    WenxinContext,
    WenxinRecord,
    WenxinResult,
    WenxinTier,
} from './WenxinData';

const { ccclass } = _decorator;

/** 修为回馈下限（永不亏本，GDD 4.3.4） */
export const MULTIPLIER_FLOOR = 0.5;
/** 修为回馈软顶（达到后功成转为资源回馈，GDD 4.3.4 动态封顶） */
export const MULTIPLIER_SOFT_CAP = 8.0;
/** 修为回馈硬顶 */
export const MULTIPLIER_HARD_CAP = 10.0;
/** 保底怜悯：连续未竟次数达到该值后，功成率上调 */
export const PITY_LOSS_COUNT = 4;
/** 保底生效后的功成率（"天将眷顾"） */
export const PITY_WIN_RATE = 0.9;
/** 历史记录上限 */
const HISTORY_LIMIT = 50;
/** 教学轮覆盖前两次问心（首问必成 / 受创教学，GDD 3.6） */
const TEACHING_TRIGGER_COUNT = 2;
/** 敌人密度统计窗口（秒） */
const DENSITY_WINDOW = 30;

@ccclass('WenxinManager')
export class WenxinManager extends Component {
    private static _instance: WenxinManager | null = null;

    static getInstance(): WenxinManager {
        return WenxinManager._instance!;
    }

    private history: WenxinRecord[] = [];
    private consecutiveWins: number = 0;
    private consecutiveLosses: number = 0;
    private currentMultiplier: number = 1;   // 当前修为回馈倍率 M（初始 1.0x）
    private inProgress: boolean = false;     // 是否有问心正在流程中

    /** 本局问心触发次数（教学轮判定） */
    private triggerCount: number = 0;
    /** 教学轮：首问必成 */
    private forceSuccessNext: boolean = false;
    /** 教学轮：受创教学（必败） */
    private forceFailNext: boolean = false;

    /** 敌人击杀时间戳窗口（密度统计用） */
    private killTimes: number[] = [];

    // —— 事件回调（框架 EventBus 不绑定 this，必须用箭头函数保持引用稳定） ——
    private handleGameStart = () => { this.reset(); };
    private handleWenxinTriggered = () => { this.onWenxinTriggered(); };
    private handleEnemyKilled = () => { this.onEnemyKilled(); };

    onLoad() {
        WenxinManager._instance = this;
        const bus = EventBus.getInstance();
        bus.on(GameEvent.GAME_START, this.handleGameStart);
        bus.on(GameEvent.WENXIN_TRIGGER, this.handleWenxinTriggered);
        bus.on(GameEvent.ENEMY_KILLED, this.handleEnemyKilled);
    }

    onDestroy() {
        const bus = EventBus.getInstance();
        bus.off(GameEvent.GAME_START, this.handleGameStart);
        bus.off(GameEvent.WENXIN_TRIGGER, this.handleWenxinTriggered);
        bus.off(GameEvent.ENEMY_KILLED, this.handleEnemyKilled);
        if (WenxinManager._instance === this) {
            WenxinManager._instance = null;
        }
    }

    // ============================================================
    // 触发问心
    // ============================================================

    /**
     * 主动触发问心（碎片轮等场景），返回是否成功触发。
     * 主流程（90 秒固定轮）由 core/GameManager 触发，无需调用本方法。
     * @param context 问心上下文（供未来签约生成使用）
     * 触发前把关：问心进行中 / 非 PLAYING / 升级或手动暂停中 → 不触发。
     */
    triggerWenxin(context: WenxinContext): boolean {
        const gm = GameManager.getInstance();
        if (!gm || !gm.enabledInHierarchy) return false;
        if (this.inProgress) return false;
        if (gm.state !== GameState.PLAYING) return false;
        const top = gm.getTopPauseReason();
        if (top === PauseReason.LEVEL_UP || top === PauseReason.MANUAL) return false;

        // context 暂留作未来签约生成（GDD 4.3.3）的输入
        this.inProgress = true;
        EventBus.getInstance().emit(GameEvent.WENXIN_TRIGGER);
        // 若问心尚未暂停（碎片轮主动触发），此处负责进入问心暂停
        if (gm.getTopPauseReason() !== PauseReason.WENXIN) {
            gm.requestPause(PauseReason.WENXIN);
        }
        return true;
    }

    /** 监听框架触发的问心：维护教学轮状态（框架已负责暂停） */
    private onWenxinTriggered() {
        this.inProgress = true;
        this.triggerCount++;
        // 教学轮（GDD 3.6）：第 1 次必成（建立"自选→摇签→揭晓"条件反射），
        // 第 2 次固定未竟（受创教学：教会"输不可怕，保底在途"）
        if (this.triggerCount === 1) {
            this.forceSuccessNext = true;
        } else if (this.triggerCount === TEACHING_TRIGGER_COUNT) {
            this.forceFailNext = true;
        }
    }

    /** 敌人密度统计：击杀事件入窗 */
    private onEnemyKilled() {
        const gm = GameManager.getInstance();
        const now = gm ? gm.elapsedTime : 0;
        this.killTimes.push(now);
        // 清理窗口外的记录
        while (this.killTimes.length > 0 && this.killTimes[0] < now - DENSITY_WINDOW) {
            this.killTimes.shift();
        }
    }

    // ============================================================
    // 问心结算（玩家做出选择后调用，由 WenxinUI.onSelectTier 触发）
    // ============================================================

    /**
     * 结算一次问心。
     * @param tier 玩家选择的档位
     */
    resolveWenxin(tier: WenxinTier): WenxinResult {
        const params = WENXIN_BACKEND[tier];

        // —— 教学轮覆盖 ——
        const forceSuccess = this.forceSuccessNext;
        const forceFail = this.forceFailNext;
        this.forceSuccessNext = false;
        this.forceFailNext = false;

        // —— 保底怜悯（GDD 4.3.9）：连续 4 次未竟后，第 5 次功成率上调至 90% ——
        let actualWinRate = params.winRate;
        let blessingUsed = false;
        if (this.consecutiveLosses >= PITY_LOSS_COUNT) {
            actualWinRate = Math.max(actualWinRate, PITY_WIN_RATE);
            blessingUsed = true;
        }

        let success: boolean;
        if (forceSuccess) {
            success = true;      // 教学轮：首问必成
        } else if (forceFail) {
            success = false;     // 受创教学轮：固定安排一次未竟
        } else {
            success = Math.random() < actualWinRate;
        }

        // —— 修为回馈结算（GDD 4.3.4 后台表 + 动态封顶） ——
        const stake = params.stakeRatio;
        const mult = params.rewardMultiplier;
        let xpMultiplierChange = 0;
        let softCapped = false;
        let softCapReward: WenxinResult['softCapReward'] = null;

        if (success) {
            if (this.currentMultiplier >= MULTIPLIER_SOFT_CAP) {
                // 天道回馈期：功成不再加 M，转为资源发动机（永远正回报）
                softCapped = true;
                softCapReward = {
                    stoneMultiplier: 2,               // 灵石 ×2
                    courageBonus: (tier + 1) * 10,    // 道心 +10×档位
                    fragmentChance: 0.3,              // 30% 概率得 1 命运碎片
                };
                // M ≥ 9 后每次功成额外 +0.1M（边际递减冲刺），10x 硬顶
                if (this.currentMultiplier >= 9) {
                    xpMultiplierChange = 0.1;
                }
            } else {
                xpMultiplierChange = this.currentMultiplier * stake * mult;
            }
        } else {
            if (this.currentMultiplier >= MULTIPLIER_SOFT_CAP) {
                // 天道护持：软顶后未竟不减 M（零下行）
                softCapped = true;
            } else {
                // 受创系数 0.5：未竟只损失押注修为的一半
                xpMultiplierChange = -(this.currentMultiplier * stake * 0.5);
            }
        }
        // 上下限钳制：0.5x 永不跌穿，10x 硬顶
        this.currentMultiplier = Math.min(
            MULTIPLIER_HARD_CAP,
            Math.max(MULTIPLIER_FLOOR, this.currentMultiplier + xpMultiplierChange),
        );

        // —— 道心变化（任务规格；钳制 ≥ 0，保证永久资产不下行） ——
        const courageGain = success ? (tier + 1) * 10 : -(tier + 1) * 3;

        // —— 连渡状态 ——
        if (success) {
            this.consecutiveWins++;
            this.consecutiveLosses = 0;
        } else {
            this.consecutiveLosses++;
            this.consecutiveWins = 0;
        }

        // —— 同步到 PlayerData（PlayerRegistry 绑定后生效） ——
        const pd = PlayerRegistry.getPlayer();
        if (pd) {
            pd.bravery = Math.max(0, pd.bravery + courageGain);
            pd.xpMultiplier = this.currentMultiplier;
            pd.consecutiveWins = this.consecutiveWins;
        }

        // —— 历史记录 ——
        const gm = GameManager.getInstance();
        const record: WenxinRecord = {
            time: gm ? gm.elapsedTime : 0,
            tier,
            success,
            xpGain: xpMultiplierChange,
            courageGain,
        };
        this.history.push(record);
        if (this.history.length > HISTORY_LIMIT) this.history.shift();

        this.inProgress = false;

        const result: WenxinResult = {
            tier,
            success,
            multiplier: this.currentMultiplier,
            multiplierChange: xpMultiplierChange,
            courageGain,
            consecutive: this.consecutiveWins,
            divineBlessingUsed: blessingUsed,
            softCapped,
            softCapReward,
        };

        // 广播完整结果（core/GameManager 收到后恢复游戏；HUD/结算统计读字段）
        EventBus.getInstance().emit(GameEvent.WENXIN_RESULT, result);
        return result;
    }

    /**
     * 放弃问心（"此局不问"，GDD 4.3.6）：
     * 无加成、不扣分、无道心，保底计数器不清零 —— 用错过诱惑推，不用惩罚推。
     */
    skipWenxin(): WenxinResult {
        this.inProgress = false;
        const result: WenxinResult = {
            tier: WenxinTier.STABLE,
            success: false,
            multiplier: this.currentMultiplier,
            multiplierChange: 0,
            courageGain: 0,
            consecutive: this.consecutiveWins,
            divineBlessingUsed: false,
            softCapped: false,
            softCapReward: null,
            skipped: true,
        };
        EventBus.getInstance().emit(GameEvent.WENXIN_RESULT, result);
        return result;
    }

    /**
     * 中止一次问心（防御性：UI 因错峰无法弹出时调用，
     * 广播 WENXIN_RESULT 让 core/GameManager 恢复游戏，防止卡死暂停）。
     */
    abortWenxin(): void {
        if (!this.inProgress) return;
        this.forceSuccessNext = false;
        this.forceFailNext = false;
        this.skipWenxin();
    }

    // ============================================================
    // 查询接口
    // ============================================================

    /** 获取当前修为回馈倍率（XPSystem 拾取 XP 时调用） */
    getCurrentMultiplier(): number {
        return this.currentMultiplier;
    }

    /** 获取连渡信息 */
    getStreak(): { wins: number; losses: number } {
        return { wins: this.consecutiveWins, losses: this.consecutiveLosses };
    }

    /** 是否有"天将眷顾"预兆（连败 3 次起，签筒浮现征兆，GDD 4.3.9 半公开保底） */
    hasDivineBlessing(): boolean {
        return this.consecutiveLosses >= PITY_LOSS_COUNT - 1;
    }

    /** 是否有问心正在流程中 */
    isInProgress(): boolean {
        return this.inProgress;
    }

    /** 获取问心历史记录 */
    getHistory(): readonly WenxinRecord[] {
        return this.history;
    }

    /** 当前敌人密度（近 30 秒击杀数/秒） */
    getEnemyDensity(): number {
        return this.killTimes.length / DENSITY_WINDOW;
    }

    /** 重置（新一局，收到 GAME_START 事件自动调用） */
    reset(): void {
        this.history = [];
        this.consecutiveWins = 0;
        this.consecutiveLosses = 0;
        this.currentMultiplier = 1;
        this.inProgress = false;
        this.triggerCount = 0;
        this.forceSuccessNext = false;
        this.forceFailNext = false;
        this.killTimes = [];
    }
}
