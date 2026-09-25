// ============================================================
// Banner —— 事件短横幅（屏幕中间上方，仅在事件发生时短暂显示）
// ------------------------------------------------------------
// 用途：妖王来袭 / 灵脉现世 / 流派天赋：X / 问心功成 / 身法绝妙
// 纪律：同一时刻只显示一条，新横幅顶掉旧的；显示后自行隐藏，
//       绝不常驻，避免遮挡战斗区域（验收要求）。
// 使用：Banner.show('妖王来袭', '#FF6B6B');
// ============================================================

import { _decorator, Component, Graphics, Label, Node, UIOpacity, UITransform, Vec3, view, tween, Tween } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { hexColor, makeLabel } from '../core/UIUtils';

const { ccclass } = _decorator;

/** 横幅尺寸与位置 */
const BANNER_W = 380;
const BANNER_H = 54;
/** 距屏幕顶部（HUD 下方）的垂直位置 */
const TOP_OFFSET = 168;

@ccclass('Banner')
export class Banner extends Component {
    private static _instance: Banner | null = null;

    private panel: Node | null = null;
    private accent: Graphics | null = null;
    private label: Label | null = null;
    private opacity: UIOpacity | null = null;

    static getInstance(): Banner | null {
        return Banner._instance;
    }

    /** 显示一条短横幅（duration 秒后淡出） */
    static show(text: string, colorHex = '#FFD700', duration = 1.6): void {
        const inst = Banner._instance;
        if (!inst || !inst.isValid) return;
        inst.play(text, colorHex, duration);
    }

    onLoad(): void {
        Banner._instance = this;
        this.buildUI();
        // 统一订阅"事件 → 横幅文案"的映射，避免各系统各自拼 UI
        const bus = EventBus.getInstance();
        bus.on(GameEvent.ELITE_WARNING, this.onEliteWarning);
        bus.on(GameEvent.LINGMAI_SPAWNED, this.onLingmaiSpawned);
        bus.on(GameEvent.TALENT_GAINED, this.onTalentGained);
        bus.on(GameEvent.WENXIN_OUTCOME, this.onWenxinOutcome);
    }

    onDestroy(): void {
        const bus = EventBus.getInstance();
        bus.off(GameEvent.ELITE_WARNING, this.onEliteWarning);
        bus.off(GameEvent.LINGMAI_SPAWNED, this.onLingmaiSpawned);
        bus.off(GameEvent.TALENT_GAINED, this.onTalentGained);
        bus.off(GameEvent.WENXIN_OUTCOME, this.onWenxinOutcome);
        if (Banner._instance === this) Banner._instance = null;
    }

    // —— 事件 → 横幅（箭头函数保证引用稳定，可安全退订） ——

    private onEliteWarning = (): void => {
        this.play('妖王来袭', '#FF6B6B', 1.8);
    };

    private onLingmaiSpawned = (): void => {
        this.play('灵脉现世', '#60A5FA', 1.6);
    };

    private onTalentGained = (payload: { name?: string }): void => {
        this.play(`流派天赋：${payload?.name ?? ''}`, '#FFD700', 2.0);
    };

    private onWenxinOutcome = (payload: { success?: boolean; text?: string }): void => {
        const success = !!payload?.success;
        this.play(payload?.text ?? (success ? '问心功成' : '问心未竟'), success ? '#FFD700' : '#F87171', 1.8);
    };

    private play(text: string, colorHex: string, duration: number): void {
        const node = this.panel;
        const op = this.opacity;
        const label = this.label;
        const accent = this.accent;
        if (!node || !op || !label || !accent) return;

        // 顶掉上一条
        Tween.stopAllByTarget(node);
        Tween.stopAllByTarget(op);

        label.string = text;
        label.color = hexColor(colorHex);
        // 两侧色条与文字同色，强化事件辨识度
        accent.clear();
        accent.fillColor = hexColor(colorHex, 235);
        accent.rect(-BANNER_W / 2, -3, 46, 6);
        accent.fill();
        accent.rect(BANNER_W / 2 - 46, -3, 46, 6);
        accent.fill();

        node.active = true;
        node.setScale(0.92, 0.92, 1);
        op.opacity = 255;
        tween(node)
            .to(0.12, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' })
            .start();
        tween(op)
            .delay(duration)
            .to(0.35, { opacity: 0 })
            .call(() => {
                if (node.isValid) node.active = false;
            })
            .start();
    }

    private buildUI(): void {
        const size = view.getVisibleSize();

        const node = new Node('BannerPanel');
        node.setParent(this.node);
        node.addComponent(UITransform).setContentSize(BANNER_W, BANNER_H);
        const bg = node.addComponent(Graphics);
        bg.fillColor = hexColor('#0A0E14', 205);
        bg.roundRect(-BANNER_W / 2, -BANNER_H / 2, BANNER_W, BANNER_H, 10);
        bg.fill();
        bg.lineWidth = 2;
        bg.strokeColor = hexColor('#94A3B8', 90);
        bg.roundRect(-BANNER_W / 2, -BANNER_H / 2, BANNER_W, BANNER_H, 10);
        bg.stroke();

        // 两侧色条（随事件着色）
        const accentNode = new Node('BannerAccent');
        accentNode.setParent(node);
        accentNode.addComponent(UITransform).setContentSize(BANNER_W, 10);
        this.accent = accentNode.addComponent(Graphics);

        this.label = makeLabel(node, '', 26, '#FFD700', BANNER_W - 40, BANNER_H - 8);
        this.label.isBold = true;

        this.opacity = node.addComponent(UIOpacity);
        this.opacity.opacity = 0;
        node.setPosition(0, size.height / 2 - TOP_OFFSET, 0);
        node.active = false;
        this.panel = node;
    }
}
