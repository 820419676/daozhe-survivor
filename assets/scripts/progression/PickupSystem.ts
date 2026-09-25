/**
 * PickupSystem —— MVP 掉落物系统
 *
 * 负责把敌人的 DROP_XP / DROP_GOLD 事件转成画面中可见的灵珠与灵石。
 * 经验灵珠注册到 PlayerController 的磁吸列表，进入玩家范围后会自动飞向玩家并升级。
 */
import { _decorator, Color, Component, Graphics, Label, Node, UIOpacity, UITransform, Vec3, tween } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { PlayerController } from '../player/PlayerController';

const { ccclass } = _decorator;

@ccclass('PickupSystem')
export class PickupSystem extends Component {
    onLoad(): void {
        EventBus.on(GameEvent.DROP_XP, this.onDropXp, this);
        EventBus.on(GameEvent.DROP_GOLD, this.onDropGold, this);
        EventBus.on(GameEvent.XP_PICKED, this.onXpPicked, this);
        EventBus.on(GameEvent.GAME_START, this.clear, this);
    }

    onDestroy(): void {
        EventBus.off(GameEvent.DROP_XP, this.onDropXp, this);
        EventBus.off(GameEvent.DROP_GOLD, this.onDropGold, this);
        EventBus.off(GameEvent.XP_PICKED, this.onXpPicked, this);
        EventBus.off(GameEvent.GAME_START, this.clear, this);
    }

    private onDropXp(payload: { position: Vec3; amount: number }): void {
        if (!payload?.position) return;
        const node = this.createDrop(new Color(82, 187, 255, 255), 14);
        node.name = 'XpOrb';
        // 轻微随机散落，避免多颗灵珠完全重叠
        node.setWorldPosition(
            payload.position.x + (Math.random() - 0.5) * 16,
            payload.position.y + (Math.random() - 0.5) * 16,
            0,
        );
        node['xpAmount'] = payload.amount || 1;
        PlayerController.registerXpGem(node);
    }

    private onDropGold(payload: { position: Vec3; amount: number }): void {
        if (!payload?.position) return;
        const node = this.createDrop(new Color(255, 211, 78, 255), 12);
        node.name = 'SpiritStone';
        node.setWorldPosition(payload.position);
        // 金币暂作为可见战利品；经验灵珠是 MVP 的主成长路径。
        node['goldAmount'] = payload.amount || 1;
        this.scheduleOnce(() => { if (node.isValid) node.destroy(); }, 5);
    }

    /** 灵珠被拾取 → 短暂显示 "+N 灵气" 飘字（验收：拾取可见反馈） */
    private onXpPicked(payload: { node: Node; amount: number }): void {
        if (!payload?.node || !payload.node.isValid) return;
        const worldPos = payload.node.worldPosition.clone();
        const amount = payload.amount ?? 1;

        const labelNode = new Node('XpPickedText');
        labelNode.setParent(this.node);
        labelNode.addComponent(UITransform).setContentSize(160, 30);
        const label = labelNode.addComponent(Label);
        label.string = `+${amount} 灵气`;
        label.fontSize = 18;
        label.lineHeight = 24;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.isBold = true;
        label.color = new Color(130, 210, 255, 255);
        labelNode.setWorldPosition(worldPos.x, worldPos.y + 12, 0);

        const op = labelNode.addComponent(UIOpacity);
        tween(labelNode)
            .by(0.6, { position: new Vec3(0, 44, 0) }, { easing: 'quadOut' })
            .call(() => labelNode.destroy())
            .start();
        tween(op)
            .delay(0.15)
            .to(0.45, { opacity: 0 })
            .start();
    }

    /** 蓝色灵珠（光晕 + 主体 + 高光描边 + 亮点） */
    private createDrop(color: Color, radius: number): Node {
        const node = new Node('Drop');
        node.setParent(this.node);
        node.addComponent(UITransform).setContentSize(radius * 2, radius * 2);
        const g = node.addComponent(Graphics);
        // 外圈光晕
        g.fillColor = new Color(color.r, color.g, color.b, 40);
        g.circle(0, 0, radius + 5);
        g.fill();
        // 主体
        g.fillColor = new Color(color.r, color.g, color.b, 210);
        g.circle(0, 0, radius);
        g.fill();
        // 高光描边
        g.lineWidth = 2;
        g.strokeColor = new Color(
            Math.min(255, color.r + 60),
            Math.min(255, color.g + 60),
            Math.min(255, color.b + 60),
            255,
        );
        g.circle(0, 0, radius);
        g.stroke();
        // 中心高光点
        g.fillColor = new Color(255, 255, 255, 170);
        g.circle(-radius * 0.25, radius * 0.25, Math.max(2, radius * 0.28));
        g.fill();
        return node;
    }

    private clear(): void {
        for (const child of this.node.children.slice()) child.destroy();
    }
}
