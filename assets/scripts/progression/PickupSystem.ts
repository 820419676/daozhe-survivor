/**
 * PickupSystem —— MVP 掉落物系统
 *
 * 负责把敌人的 DROP_XP / DROP_GOLD 事件转成画面中可见的灵珠与灵石：
 *   - 经验灵珠（蓝色圆珠）：registerXpGem → 磁吸 → 经验入账 + "+N 灵气"
 *   - 灵石（金色菱形晶体）：registerGold → 磁吸 → 灵石入账 + "+N 灵石"
 * 两者外形刻意区分（圆珠 / 菱形），避免与金色飞剑、红色菱形敌人混淆。
 * 未被拾取的灵石 12 秒后自行消失，避免满地残留。
 */
import { _decorator, Color, Component, Graphics, Label, Node, UIOpacity, UITransform, Vec3, tween } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { PlayerController } from '../player/PlayerController';

const { ccclass } = _decorator;

/** 灵石未被拾取时的存活时长（秒） */
const GOLD_LIFETIME = 12;

/** 掉落物外形 */
type DropShape = 'orb' | 'crystal';

@ccclass('PickupSystem')
export class PickupSystem extends Component {
    onLoad(): void {
        EventBus.on(GameEvent.DROP_XP, this.onDropXp, this);
        EventBus.on(GameEvent.DROP_GOLD, this.onDropGold, this);
        EventBus.on(GameEvent.XP_PICKED, this.onXpPicked, this);
        EventBus.on(GameEvent.GOLD_PICKED, this.onGoldPicked, this);
        EventBus.on(GameEvent.GAME_START, this.clear, this);
    }

    onDestroy(): void {
        EventBus.off(GameEvent.DROP_XP, this.onDropXp, this);
        EventBus.off(GameEvent.DROP_GOLD, this.onDropGold, this);
        EventBus.off(GameEvent.XP_PICKED, this.onXpPicked, this);
        EventBus.off(GameEvent.GOLD_PICKED, this.onGoldPicked, this);
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
        const node = this.createDrop(new Color(255, 203, 71, 255), 13, 'crystal');
        node.name = 'SpiritStone';
        node.setWorldPosition(
            payload.position.x + (Math.random() - 0.5) * 16,
            payload.position.y + (Math.random() - 0.5) * 16,
            0,
        );
        node['goldAmount'] = payload.amount || 1;
        // 纳入磁吸列表：靠近玩家后自动飞向玩家并入账（HUD 灵石）
        PlayerController.registerGold(node);
        // 未被拾取的灵石到期自动消失，避免满地残留
        this.scheduleOnce(() => {
            if (node.isValid) node.destroy();
        }, GOLD_LIFETIME);
    }

    /** 经验灵珠被拾取 → "+N 灵气" 飘字 */
    private onXpPicked(payload: { node: Node; amount: number }): void {
        this.floatPickupText(payload, `+${payload?.amount ?? 1} 灵气`, new Color(130, 210, 255, 255));
    }

    /** 灵石被拾取 → "+N 灵石" 飘字 */
    private onGoldPicked(payload: { node: Node; amount: number }): void {
        this.floatPickupText(payload, `+${payload?.amount ?? 1} 灵石`, new Color(255, 216, 120, 255));
    }

    /** 拾取反馈飘字（在掉落物世界坐标上方向上飘并淡出） */
    private floatPickupText(payload: { node: Node; amount: number } | undefined, text: string, color: Color): void {
        if (!payload?.node || !payload.node.isValid) return;
        const worldPos = payload.node.worldPosition.clone();

        const labelNode = new Node('PickupText');
        labelNode.setParent(this.node);
        labelNode.addComponent(UITransform).setContentSize(180, 30);
        const label = labelNode.addComponent(Label);
        label.string = text;
        label.fontSize = 18;
        label.lineHeight = 24;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.isBold = true;
        label.color = color;
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

    /**
     * 生成掉落物：
     *   orb     —— 圆形灵珠（蓝色经验珠）
     *   crystal —— 菱形灵石晶体（与飞剑金色叶片、圆形灵珠明确区分）
     */
    private createDrop(color: Color, radius: number, shape: DropShape = 'orb'): Node {
        const node = new Node('Drop');
        node.setParent(this.node);
        node.addComponent(UITransform).setContentSize(radius * 3, radius * 3);
        const g = node.addComponent(Graphics);

        const bright = new Color(
            Math.min(255, color.r + 60),
            Math.min(255, color.g + 60),
            Math.min(255, color.b + 60),
            255,
        );

        if (shape === 'crystal') {
            // 外圈柔光
            g.fillColor = new Color(color.r, color.g, color.b, 45);
            g.moveTo(0, radius + 5);
            g.lineTo(radius + 5, 0);
            g.lineTo(0, -(radius + 5));
            g.lineTo(-(radius + 5), 0);
            g.close();
            g.fill();
            // 晶体主体
            g.fillColor = new Color(color.r, color.g, color.b, 235);
            g.moveTo(0, radius);
            g.lineTo(radius, 0);
            g.lineTo(0, -radius);
            g.lineTo(-radius, 0);
            g.close();
            g.fill();
            // 白色棱线
            g.lineWidth = 2;
            g.strokeColor = new Color(255, 255, 255, 210);
            g.moveTo(0, radius);
            g.lineTo(radius, 0);
            g.lineTo(0, -radius);
            g.lineTo(-radius, 0);
            g.close();
            g.stroke();
            // 内层高光（晶体通透感）
            g.fillColor = new Color(255, 255, 255, 165);
            g.moveTo(0, radius * 0.5);
            g.lineTo(radius * 0.34, 0);
            g.lineTo(0, -radius * 0.5);
            g.lineTo(-radius * 0.34, 0);
            g.close();
            g.fill();
        } else {
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
            g.strokeColor = bright;
            g.circle(0, 0, radius);
            g.stroke();
            // 中心高光点
            g.fillColor = new Color(255, 255, 255, 170);
            g.circle(-radius * 0.25, radius * 0.25, Math.max(2, radius * 0.28));
            g.fill();
        }
        return node;
    }

    private clear(): void {
        for (const child of this.node.children.slice()) child.destroy();
    }
}
