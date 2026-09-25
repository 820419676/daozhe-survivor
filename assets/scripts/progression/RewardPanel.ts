// ============================================================
// RewardPanel —— 通用三选一奖励面板（灵脉 / 宝箱共用）
// ------------------------------------------------------------
// 与升级三选一的区别：
//   - 升级面板由 PLAYER_LEVEL_UP 驱动；本面板由奖励系统主动调用
//   - 使用独立的暂停原因 PauseReason.REWARD（完全冻结），
//     因此与升级面板的暂停互不干扰（各自弹出各自恢复）
//   - 同一时刻只允许一个奖励面板，重复请求返回 false，
//     调用方可据此走"自动发放默认奖励"的兜底，避免奖励丢失
// UI 全部代码生成；显示时置顶，避免被其它弹层遮挡。
// ============================================================

import { _decorator, Color, Component, Graphics, Label, Node, UITransform, view, Button } from 'cc';
import { GameManager, GameState, PauseReason } from '../core/GameManager';
import { hexColor, makeLabel, makePanel } from '../core/UIUtils';

const { ccclass } = _decorator;

/** 单个奖励选项 */
export interface RewardOption {
    id: string;
    name: string;
    desc: string;
}

const OPTION_COUNT = 3;
const CARD_W = 560;
const CARD_H = 128;

@ccclass('RewardPanel')
export class RewardPanel extends Component {
    private static _instance: RewardPanel | null = null;

    static getInstance(): RewardPanel | null {
        return RewardPanel._instance;
    }

    /**
     * 打开三选一奖励面板。
     * @returns 是否成功打开（已有面板打开 / 组件未挂载 → false）
     */
    static open(
        title: string,
        subtitle: string,
        options: RewardOption[],
        onPick: (id: string) => void,
    ): boolean {
        const inst = RewardPanel._instance;
        if (!inst || !inst.isValid) return false;
        return inst.show(title, subtitle, options, onPick);
    }

    private root: Node | null = null;
    private titleLabel: Label | null = null;
    private subtitleLabel: Label | null = null;
    private cards: { node: Node; name: Label; desc: Label }[] = [];
    private currentOptions: RewardOption[] = [];
    private onPickCb: ((id: string) => void) | null = null;
    private shown: boolean = false;

    onLoad(): void {
        RewardPanel._instance = this;
        this.buildUI();
        this.node.active = false;
    }

    onDestroy(): void {
        if (RewardPanel._instance === this) RewardPanel._instance = null;
    }

    // ==================== 展示 / 关闭 ====================

    private show(title: string, subtitle: string, options: RewardOption[], onPick: (id: string) => void): boolean {
        if (this.shown) return false;
        this.shown = true;
        this.currentOptions = options.slice(0, OPTION_COUNT);
        this.onPickCb = onPick;

        if (this.titleLabel) this.titleLabel.string = title;
        if (this.subtitleLabel) this.subtitleLabel.string = subtitle;

        this.cards.forEach((card, i) => {
            const opt = this.currentOptions[i];
            if (!opt) {
                card.node.active = false;
                return;
            }
            card.node.active = true;
            card.name.string = opt.name;
            card.desc.string = opt.desc;
        });

        this.node.active = true;
        if (this.node.parent) {
            this.node.setSiblingIndex(this.node.parent.children.length - 1); // 置顶
        }
        const gm = GameManager.getInstance();
        if (gm && (gm.state === GameState.PLAYING || gm.state === GameState.PAUSED)) {
            gm.requestPause(PauseReason.REWARD);
        }
        return true;
    }

    private pick(index: number): void {
        if (!this.shown) return;
        const opt = this.currentOptions[index];
        if (!opt) return;
        const cb = this.onPickCb;
        this.hide();
        if (cb) cb(opt.id);
    }

    private hide(): void {
        if (!this.shown) return;
        this.shown = false;
        this.node.active = false;
        const gm = GameManager.getInstance();
        if (gm && gm.isPaused(PauseReason.REWARD)) {
            gm.requestResume(PauseReason.REWARD);
        }
    }

    // ==================== UI ====================

    private buildUI(): void {
        const size = view.getVisibleSize();
        const W = size.width;
        const H = size.height;

        // 全屏遮罩
        this.root = makePanel(this.node, W, H, new Color(0, 0, 0, 155), 0);
        this.root.name = 'RewardRoot';

        this.titleLabel = makeLabel(this.root, '灵脉', 42, '#FFD700', 420, 64);
        this.titleLabel.node.setPosition(0, H * 0.35, 0);
        this.subtitleLabel = makeLabel(this.root, '', 20, '#CBD5E1', 520, 34);
        this.subtitleLabel.node.setPosition(0, H * 0.35 - 52, 0);

        this.cards = [];
        const cardY = [H * 0.15, -H * 0.02, -H * 0.19];
        for (let i = 0; i < OPTION_COUNT; i++) {
            const card = makePanel(this.root, CARD_W, CARD_H, hexColor('#1E293B', 235), 14);
            card.name = `RewardCard_${i}`;
            card.setPosition(0, cardY[i], 0);

            // 左侧色条（区分三档奖励）
            const accentColors = ['#38BDF8', '#F59E0B', '#A855F7'];
            const accent = new Node('Accent');
            accent.setParent(card);
            accent.addComponent(UITransform).setContentSize(12, CARD_H - 28);
            const accentGfx = accent.addComponent(Graphics);
            accentGfx.fillColor = hexColor(accentColors[i % accentColors.length], 235);
            accentGfx.roundRect(-CARD_W / 2 + 8, -CARD_H / 2 + 14, 8, CARD_H - 28, 4);
            accentGfx.fill();

            const nameLabel = makeLabel(card, '', 28, '#FFFFFF', CARD_W - 60, 40);
            nameLabel.node.setPosition(12, 28, 0);
            nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;

            const descLabel = makeLabel(card, '', 19, '#CBD5E1', CARD_W - 60, 52);
            descLabel.node.setPosition(12, -24, 0);
            descLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            descLabel.enableWrapText = true;

            const btn = card.addComponent(Button);
            btn.transition = Button.Transition.SCALE;
            btn.zoomScale = 0.96;
            card.on(Button.EventType.CLICK, () => this.pick(i));

            this.cards.push({ node: card, name: nameLabel, desc: descLabel });
        }
    }
}
