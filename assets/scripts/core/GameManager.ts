// ============================================================
// GameManager —— 全局游戏管理器（单例 Component，全项目唯一基座）
// ------------------------------------------------------------
// 职责：
//   1. 游戏状态机：IDLE → PLAYING → PAUSED → GAME_OVER
//   2. 局内计时（试炼15分钟 / 深度30分钟 / 极速10分钟），每秒发 SECOND_TICK
//   3. 问心固定轮：每 90 秒一次（60/90/120 秒 AB 可配，GDD 4.3.1）
//      触发后进入问心暂停：时间流速降至 20%（GDD 4.3.2 画面减速，
//      getScaledDt 慢动作不打断割草手感；敌人/玩家仍按 state 冻结）
//   4. 暂停栈：可叠加（问心/升级/手动），栈空才真正恢复；
//      问心与升级弹窗错峰（8 秒间隙，GDD 4.3.2 演出纪律）
//   5. 玩家节点注册（Enemy / EnemySpawner 索敌目标）
//
// 使用约定：
//   - 挂到场景常驻节点（如 Canvas 下的 GameRoot），全场景唯一
//   - 玩法组件：武器/弹幕等用 getScaledDt(dt) 享受问心慢动作；
//     敌人/玩家组件用 state !== GameState.PLAYING 判断暂停冻结
//   - 升级三选一确认后由 LevelUpUI 弹出暂停栈中全部 LEVEL_UP
//   - 问心结算（WenxinManager 广播 WENXIN_RESULT）后自动恢复游戏
//   - 玩家死亡时调用 endGame()；超时也会自动结束
// ============================================================

import { _decorator, Component, Node, find, log, warn } from 'cc';
import { EventBus } from './EventBus';
import { GameEvent } from './GameEvent';
import { GAME_CONFIG } from '../core/GameConfig';
import { PlayerRegistry } from './PlayerRegistry';
import { PlayerData } from '../player/PlayerData';
// 暂停原因枚举的权威定义在 core/PauseReason.ts，此处对外转发
// （兼容两种导入路径：`../core/GameManager` 与 `../core/PauseReason`）
export { PauseReason } from './PauseReason';
import { PauseReason } from './PauseReason';

const { ccclass } = _decorator;

/** 游戏状态机 */
export enum GameState {
    IDLE = 0,      // 空闲：未开局
    PLAYING = 1,   // 进行中：计时与战斗逻辑正常运转
    PAUSED = 2,    // 暂停：问心 / 升级三选一 / 手动暂停
    GAME_OVER = 3, // 结束：结算展示中
}

/** 游戏模式（枚举值 = 对局时长秒数） */
export enum GameMode {
    TRIAL_15 = 900, // 15分钟试炼
    DEEP_30 = 1800, // 30分钟深度
    SPEED_10 = 600, // 10分钟极速
    TEST_DEV = 180, // 3分钟开发测试（仅开发环境：正好覆盖 180 秒完整六段循环）
}

/** 问心减速时间流速（GDD 4.3.2：画面减速至 20%，不暂停割草） */
export const WENXIN_TIMESCALE = 0.2;

@ccclass('GameManager')
export class GameManager extends Component {
    /** 全局单例 */
    private static instance: GameManager = null as unknown as GameManager;

    /** 获取全局单例（场景中必须有挂载本组件的节点） */
    static getInstance(): GameManager {
        return GameManager.instance;
    }

    /** 当前游戏状态 */
    state: GameState = GameState.IDLE;
    /** 当前模式 */
    mode: GameMode = GameMode.TRIAL_15;
    /** 已进行时间（秒，暂停期间不计时） */
    elapsedTime: number = 0;
    /** 问心触发间隔（秒），AB测试可配 60/90/120 */
    wenxinInterval: number = GAME_CONFIG.wenxin.defaultInterval;
    /** 下一次问心触发的绝对时间点（秒） */
    nextWenxinTime: number = GAME_CONFIG.wenxin.defaultInterval;

    /** 暂停栈：可叠加多个暂停原因，栈空才真正恢复 */
    private pauseStack: PauseReason[] = [];
    /** 本局累计击杀数（结算用） */
    private totalKills: number = 0;
    /** 上一个已发送的整秒数（保证每秒只发一次 tick） */
    private lastTickSecond: number = 0;
    /** 最近一次升级发生的时间（秒），用于与问心错峰 */
    private lastLevelUpTime: number = -1;
    /** 问心与升级弹窗的最小错峰间隔（秒） */
    private readonly STAGGER_GAP: number = 8;
    /** 当前时间流速（1 = 正常 / 0.2 = 问心慢动作 / 0 = 完全冻结） */
    private currentTimeScale: number = 1;
    /** 玩家节点（Enemy / EnemySpawner 索敌目标） */
    private playerNode: Node | null = null;

    /** 问心决策窗口（秒）：弹窗出现后玩家须在窗口内做出选择 */
    get decisionWindow(): number {
        return GAME_CONFIG.wenxin.decisionWindow;
    }

    /** 当前局玩家数据（PlayerRegistry 绑定后可用；HUD/升级/问心系统共用） */
    get playerData(): PlayerData | null {
        return PlayerRegistry.getPlayer();
    }

    // ==================== 玩家节点 ====================

    /** 注册玩家节点（PlayerController.onLoad 调用，也可由场景接线） */
    setPlayer(node: Node | null): void {
        this.playerNode = node;
    }

    /** 获取玩家节点（注册的优先；失效时按 'Canvas/Player' 命名兜底查找） */
    getPlayer(): Node | null {
        if (this.playerNode && this.playerNode.isValid) return this.playerNode;
        this.playerNode = find('Canvas/Player');
        return this.playerNode;
    }

    // ==================== 生命周期 ====================

    onLoad() {
        // 单例注册（场景中应只保留一个挂载节点）
        GameManager.instance = this;
    }

    start() {
        // 订阅全局事件
        const bus = EventBus.getInstance();
        bus.on(GameEvent.PLAYER_LEVEL_UP, this.handleLevelUp);
        bus.on(GameEvent.ENEMY_KILLED, this.handleEnemyKilled);
        bus.on(GameEvent.WENXIN_RESULT, this.handleWenxinResult);

        // 默认直接开局：开发环境 3 分钟测试模式（GAME_CONFIG.debug.test2Minute），
        // 正式版置 false 后恢复 15 分钟试炼
        this.startGame(
            GAME_CONFIG.debug.test2Minute ? GameMode.TEST_DEV : GameMode.TRIAL_15
        );
    }

    onDestroy() {
        // 退订全部事件，防止悬挂引用
        const bus = EventBus.getInstance();
        bus.off(GameEvent.PLAYER_LEVEL_UP, this.handleLevelUp);
        bus.off(GameEvent.ENEMY_KILLED, this.handleEnemyKilled);
        bus.off(GameEvent.WENXIN_RESULT, this.handleWenxinResult);
        if (GameManager.instance === this) {
            GameManager.instance = null as unknown as GameManager;
        }
    }

    /**
     * 开始一局游戏（重置全部局内状态）
     * @param mode 游戏模式，默认15分钟试炼
     */
    startGame(mode: GameMode = GameMode.TRIAL_15) {
        this.mode = mode;
        this.elapsedTime = 0;
        this.lastTickSecond = 0;
        this.totalKills = 0;
        this.lastLevelUpTime = -1;
        this.pauseStack.length = 0;
        this.currentTimeScale = 1;

        // 问心间隔复位为默认值（AB测试分组由外部在开局后重新下发）
        this.wenxinInterval = GAME_CONFIG.wenxin.defaultInterval;
        // 首次问心定在默认间隔（通常位于第一次升级之后）
        this.nextWenxinTime = GAME_CONFIG.wenxin.defaultInterval;

        this.state = GameState.PLAYING;

        log(`[GameManager] 开局：模式=${this.mode}秒，问心间隔=${this.wenxinInterval}s`);
        EventBus.getInstance().emit(GameEvent.GAME_START);
    }

    /**
     * 帧更新：仅 PLAYING 状态推进
     * 1) 计时累计 + 每秒发送 SECOND_TICK
     * 2) 检查问心触发点（含与升级错峰）
     * 3) 检查时限，到时自动结束
     */
    update(dt: number) {
        if (this.state !== GameState.PLAYING) return;

        this.elapsedTime += dt;

        // —— 每秒整秒 tick（供 HUD、音频、后台统计等订阅） ——
        const currentSecond = Math.floor(this.elapsedTime);
        if (currentSecond > this.lastTickSecond) {
            this.lastTickSecond = currentSecond;
            EventBus.getInstance().emit(GameEvent.SECOND_TICK, { elapsed: currentSecond });
        }

        // —— 问心触发点检查 ——
        this.checkWenxinTrigger();

        // —— 时间到，自动结束 ——
        if (this.elapsedTime >= this.mode) {
            this.endGame();
        }
    }

    /** 检查并触发问心（含与升级弹窗错峰） */
    private checkWenxinTrigger() {
        if (this.elapsedTime < this.nextWenxinTime) return;

        // 错峰规则：若距上次升级不足8秒（升级弹窗每30~90秒一次），
        // 把问心顺延到上次升级8秒之后，避免两个弹窗撞车
        if (
            this.lastLevelUpTime >= 0 &&
            this.elapsedTime - this.lastLevelUpTime < this.STAGGER_GAP
        ) {
            this.nextWenxinTime = this.lastLevelUpTime + this.STAGGER_GAP + 0.5;
            return;
        }

        this.triggerWenxin();
    }

    /** 触发一次问心：发事件 → 进入问心暂停（时间流速 20%）→ 排定下一次 */
    private triggerWenxin() {
        log(`[GameManager] 第${Math.floor(this.elapsedTime)}秒触发问心`);
        EventBus.getInstance().emit(GameEvent.WENXIN_TRIGGER);
        this.requestPause(PauseReason.WENXIN);
        this.nextWenxinTime = this.elapsedTime + this.wenxinInterval;
    }

    // ==================== 暂停 / 恢复（暂停栈 + 时间流速） ====================

    /**
     * 请求暂停（可叠加）
     * - 仅 PLAYING 状态会真正进入 PAUSED；已在暂停中则只入栈保持暂停
     * - 问心触发、升级弹窗、手动暂停均走此入口
     * - 时间流速：WENXIN → 20%（不打断割草）；其余原因 → 0（完全冻结）
     */
    requestPause(reason: PauseReason) {
        if (this.state !== GameState.PLAYING && this.state !== GameState.PAUSED) {
            warn(`[GameManager] 当前状态 ${this.state} 不允许暂停`);
            return;
        }
        this.pauseStack.push(reason);
        if (this.state === GameState.PLAYING) {
            this.state = GameState.PAUSED;
        }
        this.recomputeTimeScale();
    }

    /**
     * 请求恢复（从暂停栈中移除对应原因，栈空才恢复 PLAYING）
     * @returns 是否真正恢复了游戏
     */
    requestResume(reason: PauseReason): boolean {
        const index = this.pauseStack.lastIndexOf(reason);
        if (index < 0) {
            warn(`[GameManager] 暂停栈中不存在原因 ${reason}，忽略恢复`);
            return false;
        }
        this.pauseStack.splice(index, 1);
        this.recomputeTimeScale();
        if (this.pauseStack.length === 0 && this.state === GameState.PAUSED) {
            this.state = GameState.PLAYING;
            return true;
        }
        return false;
    }

    /**
     * 是否处于暂停状态。
     * @param reason 指定原因时：仅当该原因在暂停栈中返回 true
     *               （如 isPaused(PauseReason.SETTINGS) 判断设置面板是否开着）
     */
    isPaused(reason?: PauseReason): boolean {
        if (reason !== undefined) {
            return this.pauseStack.indexOf(reason) >= 0;
        }
        return this.state === GameState.PAUSED;
    }

    /** 当前栈顶暂停原因（无暂停返回 null，调试/UI判断用） */
    getTopPauseReason(): PauseReason | null {
        if (this.pauseStack.length === 0) return null;
        return this.pauseStack[this.pauseStack.length - 1];
    }

    /** 当前时间流速（1 = 正常 / 0.2 = 问心慢动作 / 0 = 完全冻结） */
    getTimeScale(): number {
        return this.currentTimeScale;
    }

    /**
     * 玩法逻辑统一使用本方法获取缩放后的 delta（享受问心慢动作）。
     * @example 武器冷却：weapon.cooldownTimer -= gm.getScaledDt(dt);
     */
    getScaledDt(dt: number): number {
        return dt * this.currentTimeScale;
    }

    /** 依据暂停栈重算时间流速：问心 0.2x，其余完全冻结 */
    private recomputeTimeScale(): void {
        let hasFullPause = false;
        for (const reason of this.pauseStack) {
            if (reason !== PauseReason.WENXIN) {
                hasFullPause = true;
                break;
            }
        }
        if (hasFullPause) {
            this.currentTimeScale = 0;
        } else if (this.pauseStack.length > 0) {
            this.currentTimeScale = WENXIN_TIMESCALE;
        } else {
            this.currentTimeScale = 1;
        }
    }

    // ==================== 结束 ====================

    /**
     * 结束游戏（超时自动调用 / 玩家死亡时由战斗系统调用）
     * 广播 GAME_OVER（存活时间 + 击杀数），由结算UI展示
     */
    endGame() {
        if (this.state === GameState.GAME_OVER) return; // 防止重复结算
        this.state = GameState.GAME_OVER;
        this.pauseStack.length = 0;
        this.currentTimeScale = 1;
        log(`[GameManager] 游戏结束：存活${this.elapsedTime.toFixed(1)}秒，击杀${this.totalKills}`);
        EventBus.getInstance().emit(GameEvent.GAME_OVER, {
            survivedTime: this.elapsedTime,
            kills: this.totalKills,
        });
    }

    // ==================== 事件回调（箭头函数保证引用稳定） ====================

    /** 玩家升级：记录时间点 + 自动进入升级暂停（等待三选一） */
    private handleLevelUp = (data: { level: number }) => {
        this.lastLevelUpTime = this.elapsedTime;
        log(`[GameManager] 玩家升级到${data.level}级（第${Math.floor(this.elapsedTime)}秒）`);
        this.requestPause(PauseReason.LEVEL_UP);
    };

    /** 击杀累计（结算用） */
    private handleEnemyKilled = () => {
        this.totalKills++;
    };

    /** 问心结算完成 → 恢复游戏（若问心暂停仍在栈中则弹出） */
    private handleWenxinResult = () => {
        this.requestResume(PauseReason.WENXIN);
    };

    // ==================== AB测试配置接口 ====================

    /**
     * AB测试：按分组索引下发问心间隔
     * @param index 0→60秒，1→90秒，2→120秒（越界自动收敛）
     */
    applyWenxinAbInterval(index: number) {
        const intervals = GAME_CONFIG.wenxin.abTestIntervals;
        const safeIndex = Math.max(0, Math.min(index, intervals.length - 1));
        this.setWenxinInterval(intervals[safeIndex]);
    }

    /** 动态调整问心间隔（远程配置用），同时保证下一次触发点有效 */
    setWenxinInterval(seconds: number) {
        this.wenxinInterval = Math.max(1, seconds);
        // 新的触发点不得早于当前排定的时间，避免反复横跳
        this.nextWenxinTime = Math.max(
            this.nextWenxinTime,
            this.elapsedTime + this.wenxinInterval
        );
    }
}
