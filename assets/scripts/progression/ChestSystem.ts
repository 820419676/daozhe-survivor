// ============================================================
// ChestSystem —— 宝箱（精英妖王掉落的主动奖励）
// ------------------------------------------------------------
// 规则（数值收敛在 core/GameConfig.chest）：
//   监听 DROP_CHEST（妖王/天劫之主 100% 掉落）在掉落点生成宝箱；
//   玩家走近即开启，三选一：武器升级 / 被动升级 / 灵脉奖励翻倍；
//   30 秒未开启则消失（错过不惩罚，只是少一次收益）。
//
// 作用：让"击败精英"这件事的回报有明确的选择权，
//   并与灵脉形成组合（把灵脉奖励翻倍 → 下一次抢灵脉更值）。
// 事件：CHEST_SPAWNED / CHEST_OPENED
// ============================================================

import { _decorator, Component, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GAME_CONFIG } from '../core/GameConfig';
import { GameManager, GameState } from '../core/GameManager';
import { hexColor } from '../core/UIUtils';
import { RewardPanel } from './RewardPanel';
import { Rewards } from './Rewards';

const { ccclass } = _decorator;

@ccclass('ChestSystem')
export class ChestSystem extends Component {
    private chestNode: Node | null = null;
    private chestGfx: Graphics | null = null;
    private countdownLabel: Label | null = null;
    private remain: number = 0;
    private quality: string = 'normal';

    onLoad(): void {
        EventBus.on(GameEvent.DROP_CHEST, this.onDropChest, this);
        EventBus.on(GameEvent.GAME_START, this.onGameStart, this);
    }

    onDestroy(): void {
        EventBus.off(GameEvent.DROP_CHEST, this.onDropChest, this);
        EventBus.off(GameEvent.GAME_START, this.onGameStart, this);
    }

    /** 状态文案（供 DebugPanel / 后续扩展） */
    public isActive(): boolean {
        return !!this.chestNode;
    }

    update(dt: number): void {
        const gm = GameManager.getInstance();
        if (!gm || gm.state !== GameState.PLAYING) return;
        if (!this.chestNode) return;

        const cfg = GAME_CONFIG.chest;
        this.remain -= dt;
        if (this.remain <= 0) {
            this.clearChest();
            return;
        }

        const player = gm.getPlayer();
        if (player && player.isValid) {
            const dist = Vec3.distance(this.chestNode.worldPosition, player.worldPosition);
            if (dist <= cfg.radius) {
                this.open();
                return;
            }
        }
        this.redraw();
    }

    // ==================== 掉落 / 开启 ====================

    private onDropChest(payload: { position: Vec3; quality?: string }): void {
        if (!payload?.position) return;
        // 同一时刻只保留一个宝箱（新掉落的顶掉旧的）
        this.clearChest();

        const node = new Node('Chest');
        node.setParent(this.node);
        node.addComponent(UITransform).setContentSize(72, 72);
        this.chestGfx = node.addComponent(Graphics);
        node.setPosition(payload.position.x, payload.position.y, 0);

        const labelNode = new Node('ChestLabel');
        labelNode.setParent(node);
        labelNode.addComponent(UITransform).setContentSize(160, 26);
        this.countdownLabel = labelNode.addComponent(Label);
        this.countdownLabel.fontSize = 18;
        this.countdownLabel.lineHeight = 22;
        this.countdownLabel.isBold = true;
        this.countdownLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.countdownLabel.verticalAlign = Label.VerticalAlign.CENTER;
        labelNode.setPosition(0, 52, 0);

        this.quality = payload.quality ?? 'normal';
        this.chestNode = node;
        this.remain = GAME_CONFIG.chest.lifetime;
        this.redraw();

        EventBus.emit(GameEvent.CHEST_SPAWNED, {
            position: new Vec3(payload.position.x, payload.position.y, 0),
            quality: this.quality,
        });
    }

    /** 走近开启：三选一（面板打不开时自动发放武器升级兜底） */
    private open(): void {
        if (!this.chestNode) return;
        this.clearChest();
        EventBus.emit(GameEvent.CHEST_OPENED, { reward: 'choose' });

        const opened = RewardPanel.open(
            this.quality === 'legendary' ? '传说宝箱' : '宝箱',
            '击败妖王的战利品 · 选择一项',
            [
                { id: 'chest_weapon', name: '武器升级', desc: '等级最高且未满级的武器 +1 级' },
                { id: 'chest_passive', name: '被动升级', desc: '未满级被动 +1 级；已满则获得一个新被动' },
                { id: 'chest_lingmai_double', name: '灵脉奖励翻倍', desc: '本局灵脉奖励翻倍（可叠加，上限 ×4）' },
            ],
            (id) => Rewards.applyChest(id),
        );
        if (!opened) Rewards.applyChest('chest_weapon');
    }

    private clearChest(): void {
        if (this.chestNode && this.chestNode.isValid) this.chestNode.destroy();
        this.chestNode = null;
        this.chestGfx = null;
        this.countdownLabel = null;
        this.remain = 0;
    }

    private onGameStart(): void {
        this.clearChest();
    }

    // ==================== 视觉 ====================

    /** 金色宝箱（带脉动光晕与倒计时） */
    private redraw(): void {
        const g = this.chestGfx;
        if (!g) return;
        const legendary = this.quality === 'legendary';
        const pulse = 1 + 0.06 * Math.sin(Date.now() / 200);

        g.clear();
        // 光晕
        g.fillColor = hexColor(legendary ? '#F59E0B' : '#FBBF24', 45);
        g.circle(0, 0, 34 * pulse + 8);
        g.fill();
        // 箱体
        g.fillColor = hexColor('#B45309', 245);
        g.roundRect(-26, -20, 52, 40, 6);
        g.fill();
        // 箱盖
        g.fillColor = hexColor('#F59E0B', 250);
        g.roundRect(-26, 4, 52, 18, 6);
        g.fill();
        // 锁扣
        g.fillColor = hexColor('#FEF3C7', 255);
        g.rect(-5, -4, 10, 12);
        g.fill();
        // 描边
        g.lineWidth = 3;
        g.strokeColor = hexColor('#78350F', 255);
        g.roundRect(-26, -20, 52, 40, 6);
        g.stroke();

        if (this.countdownLabel) {
            this.countdownLabel.string = `${this.remain.toFixed(0)}s`;
            this.countdownLabel.color = this.remain < 8 ? hexColor('#F87171') : hexColor('#FDE68A');
        }
    }
}
