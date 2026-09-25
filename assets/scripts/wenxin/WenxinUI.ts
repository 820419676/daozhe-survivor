// ============================================================
// WenxinUI —— 问心界面（签筒抽签 · 揭晓演出，核心交互）
// ------------------------------------------------------------
// 完整交互序列（GDD 4.3.2）：
//   1. 收到 WENXIN_TRIGGER → 弹出（暂停由 core/GameManager 负责，
//      本组件不重复 requestPause/requestResume，防止暂停栈双压卡死）
//   2. 展示三档按钮：稳问 ★★★★★ / 搏问 ★★★ / 天问 ★ + 签文文案
//      （界面零数字：不显示成功率、倍率等任何数字）
//   3. 签筒摇签动画 + 倒计时（GAME_CONFIG.wenxin.decisionWindow = 3 秒），
//      超时默认稳问
//   4. 选择 → WenxinManager.resolveWenxin → 签文飞出揭晓演出：
//      功成 = 金光 + 道心飘字 + 震动（档位越高震得越狠）
//      未竟 = 签条碎裂 + 道心飘字 + 暗红闪光
//   5. 1.5 秒后关闭界面（游戏已在结算瞬间由框架恢复）
//
// 使用：挂在 Canvas 下任意节点即可。UI 全部由代码生成，
// 无需任何美术资源；@property 可选择性绑定外部节点/音效。
// ============================================================

import { _decorator, Component, Node, Label, Graphics, Color, UITransform,
         tween, Tween, UIOpacity, Vec3, view, sys, AudioClip, AudioSource } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GameManager, GameState, PauseReason } from '../core/GameManager';
import { floatText, flashOverlay, hexColor, makeButton, makeLabel, makePanel, shakeNode } from '../core/UIUtils';
import { TIER_NAMES, WENXIN_DECISION_WINDOW, WENXIN_FRONTEND, WenxinResult, WenxinTier } from './WenxinData';
import { WenxinManager } from './WenxinManager';

const { ccclass, property } = _decorator;

/** 揭晓演出时长（秒），结束后关闭界面 */
const REVEAL_DURATION = 1.5;
/** 三档按钮布局：档位 → 纵向位置 */
const TIER_BUTTON_Y: Record<WenxinTier, number> = {
    [WenxinTier.STABLE]: -20,
    [WenxinTier.VENTURE]: -160,
    [WenxinTier.HEAVEN]: -300,
};

@ccclass('WenxinUI')
export class WenxinUI extends Component {
    // —— 可选绑定（未绑定时组件自动创建） ——
    @property(Node) divinationTube: Node | null = null;  // 签筒节点
    @property(Node) resultPanel: Node | null = null;     // 结果面板
    @property(Label) timerLabel: Label | null = null;    // 决策倒计时
    @property(AudioClip) shakeClip: AudioClip | null = null;   // 摇签音效
    @property(AudioClip) successClip: AudioClip | null = null; // 功成音效
    @property(AudioClip) failClip: AudioClip | null = null;    // 未竟音效

    private root: Node | null = null;          // 全屏遮罩层
    private optionButtons: Node[] = [];        // 三个档位按钮
    private skipButton: Node | null = null;    // "此局不问"
    private slipLabel: Label | null = null;    // 飞出的签文
    private bannerLabel: Label | null = null;  // 揭晓横幅
    private audioSource: AudioSource | null = null;

    private selectedTier: WenxinTier | null = null;
    private decisionTimer: number = WENXIN_DECISION_WINDOW;
    private isShown = false;

    // ============================================================
    // 生命周期
    // ============================================================

    // —— 事件回调（框架 EventBus 不绑定 this，必须用箭头函数保持引用稳定） ——
    private handleWenxinTrigger = () => { this.onWenxinTrigger(); };

    onLoad() {
        EventBus.getInstance().on(GameEvent.WENXIN_TRIGGER, this.handleWenxinTrigger);
        this.buildUI();
        this.node.active = false;
    }

    onDestroy() {
        EventBus.getInstance().off(GameEvent.WENXIN_TRIGGER, this.handleWenxinTrigger);
        Tween.stopAllByTarget(this.node);
    }

    update(dt: number) {
        // 决策倒计时（update 拿的是实时 dt，不受暂停影响）
        if (!this.isShown || this.selectedTier !== null) return;
        this.decisionTimer -= dt;
        if (this.timerLabel) {
            this.timerLabel.string = `${Math.ceil(Math.max(0, this.decisionTimer))}`;
        }
        if (this.decisionTimer <= 0) {
            this.onTimeout();
        }
    }

    // ============================================================
    // 弹出 / 关闭（暂停与恢复由 core/GameManager 统一管理）
    // ============================================================

    private onWenxinTrigger() {
        const gm = GameManager.getInstance();
        if (!gm) return;
        if (gm.state === GameState.GAME_OVER) return;
        if (this.isShown) return; // 防重入

        // 错峰防御：升级三选一进行中无法弹出 → 中止本次问心（恢复游戏）
        if (gm.getTopPauseReason() === PauseReason.LEVEL_UP) {
            WenxinManager.getInstance().abortWenxin();
            return;
        }

        this.show();
    }


    show() {
        this.isShown = true;
        this.selectedTier = null;
        this.decisionTimer = WENXIN_DECISION_WINDOW;

        // 展示三个签文选项（星级 + 文案，零数字）
        this.renderDivinationOptions();

        // 签筒摇签动画 + 音效
        this.playShakeAnimation();

        // 重置演出节点状态
        if (this.resultPanel) {
            this.resultPanel.active = false;
            const op = this.resultPanel.getComponent(UIOpacity);
            if (op) op.opacity = 255;
        }
        this.node.active = true;

        if (this.timerLabel) {
            this.timerLabel.node.active = true;
            this.timerLabel.string = `${WENXIN_DECISION_WINDOW}`;
        }
        if (this.skipButton) this.skipButton.active = true;
    }

    hide() {
        if (!this.isShown) return;
        this.isShown = false;

        // 清理所有进行中的动画
        Tween.stopAllByTarget(this.node);
        if (this.divinationTube) Tween.stopAllByTarget(this.divinationTube);

        this.node.active = false;
        // 注意：不调用 requestResume —— core/GameManager 在收到
        // WENXIN_RESULT 时已自动弹出问心暂停，这里只负责界面收尾
    }

    // ============================================================
    // 三个档位按钮渲染（零数字：只有星级 + 签文文案 + 颜色）
    // ============================================================

    private renderDivinationOptions() {
        const wm = WenxinManager.getInstance();
        const tiers: WenxinTier[] = [WenxinTier.STABLE, WenxinTier.VENTURE, WenxinTier.HEAVEN];

        tiers.forEach((tier, i) => {
            const btn = this.optionButtons[i];
            if (!btn) return;
            const display = WENXIN_FRONTEND[tier];

            const title = btn.getChildByName('Title')?.getComponent(Label);
            const stars = btn.getChildByName('Stars')?.getComponent(Label);
            const slogan = btn.getChildByName('Slogan')?.getComponent(Label);
            const blessTag = btn.getChildByName('BlessTag');

            if (title) title.string = TIER_NAMES[tier];
            if (stars) stars.string = '★'.repeat(display.starCount);
            if (slogan) slogan.string = display.slogan;
            const color = hexColor(display.color);
            if (title) title.color = color;
            if (stars) stars.color = color;
            if (slogan) slogan.color = hexColor('#FFFFFF', 220);

            // "天将眷顾"预兆：连败 3 次起天问档浮现金光征兆（半公开保底，GDD 4.3.9）
            if (blessTag) {
                blessTag.active = tier === WenxinTier.HEAVEN && wm.hasDivineBlessing();
            }
        });
    }

    // ============================================================
    // 选择与结算
    // ============================================================

    onSelectTier(tier: WenxinTier) {
        if (this.selectedTier !== null) return; // 已选择，防重复点击
        this.selectedTier = tier;

        // 停止摇签动画与倒计时
        if (this.divinationTube) Tween.stopAllByTarget(this.divinationTube);
        if (this.timerLabel) this.timerLabel.node.active = false;
        for (const btn of this.optionButtons) btn.active = false;
        if (this.skipButton) this.skipButton.active = false;

        // 结算（核心逻辑在 WenxinManager；广播 WENXIN_RESULT 后
        // core/GameManager 自动恢复游戏）
        const result = WenxinManager.getInstance().resolveWenxin(tier);

        // 签文飞出揭晓动画
        this.playRevealAnimation(tier, result);
    }

    /** 超时：默认选择稳问 */
    private onTimeout() {
        this.onSelectTier(WenxinTier.STABLE);
    }

    /** 放弃问心（GDD 4.3.6：无加成不扣分，只是错过道心） */
    private onSkip() {
        if (this.selectedTier !== null) return;
        this.selectedTier = WenxinTier.STABLE; // 占位防重入
        WenxinManager.getInstance().skipWenxin();
        this.hide();
    }

    // ============================================================
    // 动画演出
    // ============================================================

    /** 签筒摇签动画（左右摇晃 + 摇签音效，覆盖整个决策窗口） */
    private playShakeAnimation() {
        if (!this.divinationTube) return;
        const tube = this.divinationTube;
        tube.angle = 0;

        tween(tube)
            .repeat(WENXIN_DECISION_WINDOW, tween(tube)
                .by(0.25, { angle: 9 })
                .by(0.25, { angle: -18 })
                .by(0.25, { angle: 9 })
                .by(0.25, { angle: 0 }))
            .start();

        this.playSfx(this.shakeClip);
    }

    /**
     * 揭晓演出（GDD 4.3.2 步骤 7，主爽点）：
     * 签文从签筒飞出 → 功成金光 / 未竟暗红 → 道心飘字 → 震动
     */
    private playRevealAnimation(tier: WenxinTier, result: WenxinResult) {
        const display = WENXIN_FRONTEND[tier];
        if (!this.resultPanel || !this.slipLabel || !this.bannerLabel) return;

        // 1. 签条从签筒位置飞出、展开
        this.resultPanel.active = true;
        const slip = this.slipLabel.node;
        slip.active = true;
        this.slipLabel.string = `${'★'.repeat(display.starCount)}  ${display.slogan}`;
        // 颜色属于 Label 组件（Node 上没有 color 属性，赋给节点不会生效）
        this.slipLabel.color = hexColor(display.color);

        const startPos = this.divinationTube
            ? this.divinationTube.position.clone()
            : new Vec3(0, 150, 0);
        slip.setPosition(startPos.x, startPos.y + 50, 0);
        slip.setScale(0.2, 0.2, 1);
        tween(slip)
            .to(0.45, { position: new Vec3(0, 80, 0), scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();

        // 2. 揭晓结果演出
        let bannerText: string;
        if (result.success) {
            bannerText = result.softCapped ? '天道回馈！修为已达上限' : '问道功成！回馈生效';
            this.bannerLabel.color = hexColor('#FFD700');
            // 功成：金光全屏 + 震动（档位越高震得越狠，GDD 3.1.1）+ 道心飘字
            flashOverlay(this.node, '#FFD700', 90, 0.7);
            const intensity = 6 + tier * 5; // 稳问 6 / 搏问 11 / 天问 16
            shakeNode(this.node, intensity);
            this.vibrate(40 + tier * 25);
            floatText(this.node, `道心 +${result.courageGain}`, '#FFD700', 32);
            this.playSfx(this.successClip);
        } else {
            bannerText = '问道未竟，加成减半';
            this.bannerLabel.color = hexColor('#C62828');
            // 未竟：暗红闪光 + 小震动 + 道心飘字（较小）
            flashOverlay(this.node, '#8E0000', 80, 0.5);
            shakeNode(this.node, 4);
            this.vibrate(20);
            floatText(this.node, `道心 ${result.courageGain}`, '#EF9A9A', 24);
            this.playSfx(this.failClip);
        }

        this.bannerLabel.string = bannerText;
        const bannerNode = this.bannerLabel.node;
        bannerNode.active = true;
        bannerNode.setScale(0.6, 0.6, 1);
        tween(bannerNode).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

        // 3. 演出结束后关闭界面
        this.scheduleOnce(() => this.hide(), REVEAL_DURATION);
    }

    /** 手机震动（不支持时静默忽略） */
    private vibrate(ms: number) {
        try {
            sys.vibrate(ms);
        } catch (e) {
            // 部分平台不支持震动，忽略
        }
    }

    /** 播放音效（未绑定音效资源时静默） */
    private playSfx(clip: AudioClip | null, volume = 0.8) {
        if (!clip || !this.audioSource) return;
        this.audioSource.playOneShot(clip, volume);
    }

    // ============================================================
    // UI 搭建（全部代码生成，无需美术资源）
    // ============================================================

    private buildUI() {
        const size = view.getVisibleSize();
        const W = size.width;
        const H = size.height;

        // —— 全屏暗角遮罩 ——
        if (!this.root) {
            this.root = makePanel(this.node, W, H, new Color(0, 0, 0, 170), 0);
            this.root.name = 'WenxinRoot';
        }

        // —— 签筒（可外部绑定，未绑定时自动创建） ——
        if (!this.divinationTube) {
            const tube = makePanel(this.root, 160, 240, hexColor('#6D4C41'), 18);
            tube.name = 'DivinationTube';
            tube.setPosition(0, 150, 0);
            // 签筒内的"卦"字
            const gua = makeLabel(tube, '卦', 84, '#FFE0B2', 140, 140);
            gua.node.setPosition(0, 10, 0);
            this.divinationTube = tube;
        }

        // —— 决策倒计时 ——
        if (!this.timerLabel) {
            const label = makeLabel(this.root, `${WENXIN_DECISION_WINDOW}`, 64, '#FFD700', 120, 80);
            label.node.name = 'TimerLabel';
            label.node.setPosition(0, 320, 0);
            this.timerLabel = label;
        }

        // —— 三个档位按钮（稳问 / 搏问 / 天问） ——
        this.optionButtons = [];
        const tiers: WenxinTier[] = [WenxinTier.STABLE, WenxinTier.VENTURE, WenxinTier.HEAVEN];
        tiers.forEach(tier => {
            const display = WENXIN_FRONTEND[tier];
            const btn = makeButton(this.root!, 560, 118, '', 0, '#3A3A3A',
                () => this.onSelectTier(tier));
            btn.name = `Option_${TIER_NAMES[tier]}`;
            btn.setPosition(0, TIER_BUTTON_Y[tier], 0);

            // 底色按档位色微染（颜色双编码，色弱模式友好）
            const g = btn.getComponent(Graphics);
            if (g) {
                g.fillColor = hexColor(display.color, 60);
                g.fill();
            }

            const title = makeLabel(btn, TIER_NAMES[tier], 34, display.color, 140, 44);
            title.node.name = 'Title';
            title.node.setPosition(-190, 26, 0);
            title.horizontalAlign = Label.HorizontalAlign.LEFT;

            const stars = makeLabel(btn, '★'.repeat(display.starCount), 30, display.color, 180, 40);
            stars.node.name = 'Stars';
            stars.node.setPosition(140, 26, 0);

            const slogan = makeLabel(btn, display.slogan, 22, '#FFFFFF', 460, 34);
            slogan.node.name = 'Slogan';
            slogan.node.setPosition(0, -24, 0);

            // "天将眷顾"预兆标签（默认隐藏）
            const tag = makeLabel(btn, '⚡ 天将眷顾', 20, '#FFD700', 200, 36);
            tag.node.name = 'BlessTag';
            tag.node.setPosition(0, -52, 0);
            tag.node.active = false;

            this.optionButtons.push(btn);
        });

        // —— 此局不问（放弃选项，GDD 4.3.6） ——
        if (!this.skipButton) {
            this.skipButton = makeButton(this.root, 300, 72, '此局不问', 24, '#2C2C2C',
                () => this.onSkip(), '#9E9E9E');
            this.skipButton.name = 'SkipButton';
            this.skipButton.setPosition(0, -430, 0);
        }

        // —— 结果面板（签文 + 横幅，默认隐藏） ——
        if (!this.resultPanel) {
            const panel = new Node('ResultPanel');
            panel.setParent(this.root);
            panel.addComponent(UITransform).setContentSize(W, H);
            panel.addComponent(UIOpacity);
            panel.setPosition(0, 0, 0);

            const slip = makeLabel(panel, '', 30, '#FFFFFF', 520, 60);
            slip.node.name = 'Slip';
            this.slipLabel = slip;

            const banner = makeLabel(panel, '', 44, '#FFD700', 600, 70);
            banner.node.name = 'Banner';
            banner.node.setPosition(0, -160, 0);
            this.bannerLabel = banner;

            this.resultPanel = panel;
            panel.active = false;
        }

        // —— 音频源（可选，无资源时静默） ——
        if (!this.audioSource) {
            const audioNode = new Node('WenxinAudio');
            audioNode.setParent(this.node);
            this.audioSource = audioNode.addComponent(AudioSource);
            this.audioSource.playOnAwake = false;
        }
    }
}
