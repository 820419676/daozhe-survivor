// ============================================================
// GameOverUI —— 本局结算界面（死亡 / 超时结束后弹出）
// ------------------------------------------------------------
// 挂载：Canvas 下任意节点，全场景唯一。
// UI 全部由代码生成（纯色矩形 + 文字），无需任何美术资源。
//
// 弹出方式：
//   - 自动：订阅 GAME_OVER（框架版 GameManager 超时广播）与
//     PLAYER_DIED（PlayerController 死亡广播，当前运行时主路径）
//   - 手动：调用 show(results) 传入 GameOverResults
//
// 功能：
//   - 再来一局：GameManager.startGame() 重置全局限时/数据
//   - 返回主界面：预留场景切换钩子（TODO：接入主菜单场景）
//   - 死亡复活（激励视频）：继续 30 秒，每局限 1 次。
//     观看成功后广播 GameEvent.PLAYER_REVIVED（玩家系统监听后恢复控制并给予保护）
//   - 结算翻倍（激励视频）：道心 +50%，每局限 1 次
// ============================================================

import { _decorator, Component, Node, Label, Color, view, tween, Tween, UIOpacity, Button, find } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GameManager, GameState } from '../core/GameManager';
import { PauseReason } from '../core/PauseReason';
import { hexColor, makeButton, makeLabel, makePanel } from '../core/UIUtils';
import { WenxinResult } from '../wenxin/WenxinData';
import { WxManager } from '../platform/WxManager';
import { PlayerController } from '../player/PlayerController';

const { ccclass } = _decorator;

// 事件名统一走 core/GameEvent 枚举：
//   GameEvent.PLAYER_DIED    —— 玩家死亡（PlayerController 广播，当前运行时死亡主路径）
//   GameEvent.PLAYER_REVIVED —— 复活（本界面观看激励视频成功后广播，玩家系统监听）

/** 激励视频广告位 ID（微信公众平台申请后填入正式 ID，测试期占位） */
const AD_REVIVE_ID = 'adunit-revive-xxxx';
const AD_DOUBLE_REWARD_ID = 'adunit-double-xxxx';
/** 复活后的续命时长（秒） */
const REVIVE_GRACE_SECONDS = 30;

/** 结算数据 */
export interface GameOverResults {
    survivedTime: number;  // 存活时间（秒）
    kills: number;         // 击杀数
    maxLevel: number;      // 最高等级
    courageGained: number; // 道心获取（本局累计）
    gold: number;          // 本局灵石（金币）
    wenxinCount: number;   // 问心次数
    successCount: number;  // 功成次数
}

/** 秒数 → MM:SS */
function formatMMSS(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

@ccclass('GameOverUI')
export class GameOverUI extends Component {
    // —— 统计行（名称 → 数值） ——
    private statRows: { name: Label; value: Label }[] = [];
    // —— 按钮 ——
    private restartBtn: Node | null = null;
    private backBtn: Node | null = null;
    private reviveBtn: Node | null = null;
    private reviveBtnLabel: Label | null = null;
    private doubleBtn: Node | null = null;
    private doubleBtnLabel: Label | null = null;
    // —— 提示 ——
    private toastLabel: Label | null = null;

    // —— 局内统计（事件累计，GAME_START 清零） ——
    private kills: number = 0;
    private wenxinCount: number = 0;
    private successCount: number = 0;

    /** 复活 / 翻倍是否已在本局使用 */
    private reviveUsed: boolean = false;
    private doubleUsed: boolean = false;
    /** 是否正在等待广告回调（防连点） */
    private busy: boolean = false;
    /** 界面是否展示中 */
    private shown: boolean = false;
    /** 最近一次结算数据（广告加成后刷新显示用） */
    private lastResults: GameOverResults | null = null;

    // ============================================================
    // 生命周期
    // ============================================================

    onLoad() {
        const bus = EventBus.getInstance();
        bus.on(GameEvent.GAME_OVER, this.onGameOver, this);
        bus.on(GameEvent.PLAYER_DIED, this.onPlayerDied, this);
        bus.on(GameEvent.ENEMY_KILLED, this.onEnemyKilled, this);
        bus.on(GameEvent.WENXIN_RESULT, this.onWenxinResult, this);
        bus.on(GameEvent.GAME_START, this.onGameStart, this);
        this.buildUI();
        this.node.active = false;
    }

    onDestroy() {
        const bus = EventBus.getInstance();
        bus.off(GameEvent.GAME_OVER, this.onGameOver, this);
        bus.off(GameEvent.PLAYER_DIED, this.onPlayerDied, this);
        bus.off(GameEvent.ENEMY_KILLED, this.onEnemyKilled, this);
        bus.off(GameEvent.WENXIN_RESULT, this.onWenxinResult, this);
        bus.off(GameEvent.GAME_START, this.onGameStart, this);
    }

    // ============================================================
    // 事件入口（自动弹出结算）
    // ============================================================

    /** 超时结算（core 版 GameManager 广播） */
    private onGameOver(payload: { survivedTime: number; kills: number }) {
        if (this.shown) return;
        this.collectAndShow(payload ? payload.survivedTime : undefined);
    }

    /** 玩家死亡（当前运行时主路径） */
    private onPlayerDied() {
        if (this.shown) return;
        this.collectAndShow();
    }

    private onEnemyKilled() {
        this.kills++;
    }

    private onWenxinResult(result: WenxinResult) {
        if (!result) return;
        this.wenxinCount++;
        if (result.success) this.successCount++;
    }

    /** 新一局：清空统计与广告次数，收起界面 */
    private onGameStart() {
        this.kills = 0;
        this.wenxinCount = 0;
        this.successCount = 0;
        this.reviveUsed = false;
        this.doubleUsed = false;
        this.busy = false;
        this.lastResults = null;
        this.resetButtons();
        this.hide();
    }

    /** 收集局内数据并展示结算 */
    private collectAndShow(survivedTimeOverride?: number) {
        const gm = GameManager.getInstance();
        const pd = gm ? gm.playerData : null;

        const results: GameOverResults = {
            survivedTime: survivedTimeOverride !== undefined ? survivedTimeOverride : (gm ? gm.elapsedTime : 0),
            kills: this.kills,
            maxLevel: pd ? pd.level : 1,
            courageGained: pd ? pd.bravery : 0,
            gold: this.getPlayerGold(),
            wenxinCount: this.wenxinCount,
            successCount: this.successCount,
        };
        this.show(results);
    }

    // ============================================================
    // 展示 / 关闭
    // ============================================================

    /**
     * 展示结算界面（游戏完全暂停）
     * @param results 结算数据
     */
    show(results: GameOverResults) {
        if (this.shown) return;
        this.shown = true;
        this.lastResults = results;

        // 结算期间完全暂停游戏（若已处于 GAME_OVER 冻结态则无需再暂停）
        const gm = GameManager.getInstance();
        if (gm && (gm.state === GameState.PLAYING || gm.state === GameState.PAUSED)) {
            gm.requestPause(PauseReason.SETTINGS);
        }

        // 填充统计行
        const values = [
            formatMMSS(results.survivedTime),
            String(results.kills),
            String(results.maxLevel),
            String(Math.max(0, Math.round(results.courageGained))),
            String(results.gold),
            String(results.wenxinCount),
            String(results.successCount),
        ];
        this.statRows.forEach((row, i) => {
            if (row.value && values[i] !== undefined) row.value.string = values[i];
        });

        this.node.active = true;
        this.node.setSiblingIndex(this.node.parent ? this.node.parent.children.length - 1 : 0);
    }

    /** 关闭结算界面（恢复游戏；再来一局/复活成功后调用） */
    hide() {
        if (!this.shown) return;
        this.shown = false;
        this.node.active = false;
        const gm = GameManager.getInstance();
        if (gm && gm.isPaused(PauseReason.SETTINGS)) gm.requestResume(PauseReason.SETTINGS);
    }

    // ============================================================
    // 按钮交互
    // ============================================================

    /** 再来一局：重置整局（玩家系统应监听 GAME_START 恢复） */
    private onRestart() {
        const gm = GameManager.getInstance();
        if (!gm) return;
        gm.startGame(); // 内部广播 GAME_START → onGameStart 清统计 + hide()
    }

    /** 返回主界面（TODO：切换主菜单场景后替换实现） */
    private onBackToMenu() {
        this.hide();
        console.log('[GameOverUI] 返回主界面：请在此切换到主菜单场景');
    }

    /** 死亡复活（激励视频，续 30 秒，每局限 1 次） */
    private onRevive() {
        if (this.reviveUsed || this.busy) return;
        this.busy = true;
        this.setBusyText(this.reviveBtnLabel, '复活中…');

        const gm = GameManager.getInstance();
        // 广告期间暂停（GAME_OVER 冻结态下 requestPause 会拒绝并告警，需先判状态）
        const canPause = !!gm && (gm.state === GameState.PLAYING || gm.state === GameState.PAUSED);
        if (canPause) gm!.requestPause(PauseReason.AD);

        WxManager.getInstance().showRewardedAd(AD_REVIVE_ID).then((ok) => {
            if (canPause) gm!.requestResume(PauseReason.AD);
            this.busy = false;
            this.setBusyText(this.reviveBtnLabel, '复活');

            if (ok) {
                // 恢复运行态并回拨 30 秒（续命时长）：结算若由超时/结束触发，
                // 状态机停在 GAME_OVER，必须显式恢复 PLAYING 才可继续
                if (gm) {
                    gm.state = GameState.PLAYING;
                    gm.elapsedTime = Math.max(0, gm.elapsedTime - REVIVE_GRACE_SECONDS);
                }
                // 广播复活事件：玩家系统监听后恢复控制，并给予 30 秒续命
                EventBus.getInstance().emit(GameEvent.PLAYER_REVIVED, { graceSeconds: REVIVE_GRACE_SECONDS });
                this.reviveUsed = true;
                this.hide();
            } else {
                this.showToast('未完整观看广告，未能复活');
            }
        });
    }

    /** 结算翻倍（激励视频，道心 +50%，每局限 1 次） */
    private onDoubleReward() {
        if (this.doubleUsed || this.busy) return;
        this.busy = true;
        this.setBusyText(this.doubleBtnLabel, '翻倍中…');

        const gm = GameManager.getInstance();
        if (gm) gm.requestPause(PauseReason.AD);

        WxManager.getInstance().showRewardedAd(AD_DOUBLE_REWARD_ID).then((ok) => {
            if (gm) gm.requestResume(PauseReason.AD);
            this.busy = false;
            this.setBusyText(this.doubleBtnLabel, '结算翻倍');

            if (ok) {
                this.doubleUsed = true;
                // 道心 +50%（写入 playerData 永久道心，并刷新结算行）
                if (gm && gm.playerData) {
                    const bonus = Math.round(gm.playerData.bravery * 0.5);
                    gm.playerData.bravery += bonus;
                    if (this.lastResults) {
                        this.lastResults.courageGained = gm.playerData.bravery;
                        const row = this.statRows[3];
                        if (row) row.value.string = String(gm.playerData.bravery);
                    }
                    this.showToast(`道心 +${bonus}！`);
                }
                // 按钮标记已使用
                if (this.doubleBtn) this.doubleBtn.getComponent(Button)!.interactable = false;
                if (this.doubleBtnLabel) this.doubleBtnLabel.string = '已翻倍';
            } else {
                this.showToast('未完整观看广告');
            }
        });
    }

    /** 按钮忙碌文案（防连点期间的视觉反馈） */
    private setBusyText(label: Label | null, text: string) {
        if (label) label.string = text;
    }

    /** 重置按钮状态（新一局） */
    private resetButtons() {
        if (this.reviveBtn) {
            const btn = this.reviveBtn.getComponent(Button);
            if (btn) btn.interactable = true;
        }
        if (this.reviveBtnLabel) this.reviveBtnLabel.string = '死亡复活 · 续命30秒';
        if (this.doubleBtn) {
            const btn = this.doubleBtn.getComponent(Button);
            if (btn) btn.interactable = true;
        }
        if (this.doubleBtnLabel) this.doubleBtnLabel.string = '结算翻倍 · 道心+50%';
    }

    /** 底部提示（广告未看完等），自动淡出 */
    private showToast(msg: string) {
        if (!this.toastLabel) return;
        this.toastLabel.string = msg;
        this.toastLabel.node.active = true;
        const op = this.toastLabel.node.getComponent(UIOpacity)
            ?? this.toastLabel.node.addComponent(UIOpacity);
        op.opacity = 255;
        Tween.stopAllByTarget(op);
        tween(op)
            .delay(0.6)
            .to(0.8, { opacity: 0 })
            .call(() => { this.toastLabel!.node.active = false; })
            .start();
    }

    /** 读取玩家当前灵石（PlayerController 持有运行时金币） */
    private getPlayerGold(): number {
        const player = find('Canvas/Player');
        if (!player) return 0;
        const ctrl = player.getComponent(PlayerController);
        return ctrl ? ctrl.getData().gold : 0;
    }

    // ============================================================
    // UI 搭建（全部代码生成）
    // ============================================================

    private buildUI() {
        const size = view.getVisibleSize();
        const W = size.width;
        const H = size.height;

        // —— 全屏暗色遮罩 ——
        const root = makePanel(this.node, W, H, new Color(0, 0, 0, 190), 0);
        root.name = 'GameOverRoot';

        // —— 标题 ——
        const title = makeLabel(root, '本局结算', 46, '#FFD700', 400, 70);
        title.node.setPosition(0, H * 0.34, 0);

        // —— 统计行（名称居左 / 数值居右） ——
        const ROW_Y_START = H * 0.24;
        const ROW_GAP = 52;
        const ROWS: [string, string][] = [
            ['存活时间', '00:00'],
            ['击杀数', '0'],
            ['最高等级', '1'],
            ['道心获取', '0'],
            ['本局灵石', '0'],
            ['问心次数', '0'],
            ['功成次数', '0'],
        ];
        ROWS.forEach(([name, value], i) => {
            const y = ROW_Y_START - i * ROW_GAP;
            const nameLabel = makeLabel(root, name, 24, '#B0B0B0', 220, 36);
            nameLabel.node.setPosition(-110, y, 0);
            nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            const valueLabel = makeLabel(root, value, 26, '#FFFFFF', 220, 36);
            valueLabel.node.setPosition(110, y, 0);
            valueLabel.horizontalAlign = Label.HorizontalAlign.RIGHT;
            this.statRows.push({ name: nameLabel, value: valueLabel });
        });

        // —— 按钮区 ——
        const BTN_Y_1 = -H * 0.30;
        this.restartBtn = makeButton(root, 420, 78, '再来一局', 28, '#2E7D32', () => this.onRestart());
        this.restartBtn.setPosition(0, BTN_Y_1, 0);

        this.backBtn = makeButton(root, 420, 64, '返回主界面', 24, '#3A3A3A', () => this.onBackToMenu(), '#9E9E9E');
        this.backBtn.setPosition(0, BTN_Y_1 - 92, 0);

        this.reviveBtn = makeButton(root, 420, 64, '死亡复活 · 续命30秒', 24, '#C62828',
            () => this.onRevive(), '#FFCDD2');
        this.reviveBtn.setPosition(0, BTN_Y_1 - 184, 0);
        this.reviveBtnLabel = this.reviveBtn.getComponentInChildren(Label);

        this.doubleBtn = makeButton(root, 420, 64, '结算翻倍 · 道心+50%', 24, '#B8860B',
            () => this.onDoubleReward(), '#FFF3D6');
        this.doubleBtn.setPosition(0, BTN_Y_1 - 276, 0);
        this.doubleBtnLabel = this.doubleBtn.getComponentInChildren(Label);

        // —— 提示（默认隐藏） ——
        this.toastLabel = makeLabel(root, '', 22, '#FF8A80', 480, 36);
        this.toastLabel.node.setPosition(0, H * 0.36, 0);
        this.toastLabel.node.active = false;
    }
}
