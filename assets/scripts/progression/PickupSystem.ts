/**
 * PickupSystem —— MVP 掉落物系统
 *
 * 负责把敌人的 DROP_XP / DROP_GOLD 事件转成画面中可见的灵珠与灵石。
 * 经验灵珠注册到 PlayerController 的磁吸列表，进入玩家范围后会自动飞向玩家并升级。
 */
import { _decorator, Color, Component, Graphics, Node, UITransform, Vec3 } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { PlayerController } from '../player/PlayerController';

const { ccclass } = _decorator;

@ccclass('PickupSystem')
export class PickupSystem extends Component {
    onLoad(): void {
        EventBus.on(GameEvent.DROP_XP, this.onDropXp, this);
        EventBus.on(GameEvent.DROP_GOLD, this.onDropGold, this);
        EventBus.on(GameEvent.GAME_START, this.clear, this);
    }

    onDestroy(): void {
        EventBus.off(GameEvent.DROP_XP, this.onDropXp, this);
        EventBus.off(GameEvent.DROP_GOLD, this.onDropGold, this);
        EventBus.off(GameEvent.GAME_START, this.clear, this);
    }

    private onDropXp(payload: { position: Vec3; amount: number }): void {
        if (!payload?.position) return;
        const node = this.createDrop('灵', new Color(82, 187, 255, 255), 14);
        node.name = 'XpOrb';
        node.setWorldPosition(payload.position);
        node['xpAmount'] = payload.amount || 1;
        PlayerController.registerXpGem(node);
    }

    private onDropGold(payload: { position: Vec3; amount: number }): void {
        if (!payload?.position) return;
        const node = this.createDrop('石', new Color(255, 211, 78, 255), 12);
        node.name = 'SpiritStone';
        node.setWorldPosition(payload.position);
        // 金币暂作为可见战利品；经验灵珠是 MVP 的主成长路径。
        node['goldAmount'] = payload.amount || 1;
        this.scheduleOnce(() => { if (node.isValid) node.destroy(); }, 5);
    }

    private createDrop(mark: string, color: Color, radius: number): Node {
        const node = new Node('Drop');
        node.setParent(this.node);
        node.addComponent(UITransform).setContentSize(radius * 2, radius * 2);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(color.r, color.g, color.b, 80);
        g.circle(0, 0, radius);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = color;
        g.circle(0, 0, radius);
        g.stroke();
        return node;
    }

    private clear(): void {
        for (const child of this.node.children.slice()) child.destroy();
    }
}
