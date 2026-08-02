// ============================================================
// UIUtils —— 程序化 UI 工具（无需任何美术资源即可搭出可用界面）
// ------------------------------------------------------------
// 说明：项目尚无美术/预制体资源，问心面板与升级面板均用本工具
// 以代码生成（Graphics 画底 + Label 文字 + Button 交互）。
// 之后接入正式美术时，替换为预制体绑定即可，不影响业务逻辑。
// ============================================================

import { Node, Label, Graphics, Color, UITransform, Button, tween, UIOpacity, Vec3, view } from 'cc';

/** 十六进制颜色转 Color（可带透明度） */
export function hexColor(hex: string, alpha = 255): Color {
    const c = new Color();
    Color.fromHEX(c, hex);
    c.a = alpha;
    return c;
}

/** 生成圆角面板节点（Graphics 填充） */
export function makePanel(parent: Node, w: number, h: number, color: Color, radius = 14): Node {
    const node = new Node('Panel');
    node.setParent(parent);
    const ui = node.addComponent(UITransform);
    ui.setContentSize(w, h);
    const g = node.addComponent(Graphics);
    g.fillColor = color;
    g.roundRect(-w / 2, -h / 2, w, h, radius);
    g.fill();
    return node;
}

/** 生成居中文案 Label */
export function makeLabel(parent: Node, text: string, fontSize: number, colorHex?: string, w = 300, h = 40): Label {
    const node = new Node('Label');
    node.setParent(parent);
    const ui = node.addComponent(UITransform);
    ui.setContentSize(w, h);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.round(fontSize * 1.2);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    label.isBold = true;
    if (colorHex) label.color = hexColor(colorHex);
    return label;
}

/** 生成按钮（Graphics 底 + Label + Button 缩放反馈） */
export function makeButton(parent: Node, w: number, h: number, text: string, fontSize: number,
                           bgHex: string, onClick?: () => void, textHex = '#FFFFFF'): Node {
    const node = makePanel(parent, w, h, hexColor(bgHex), 12);
    const btn = node.addComponent(Button);
    btn.transition = Button.Transition.SCALE;
    btn.zoomScale = 0.94;
    makeLabel(node, text, fontSize, textHex, w, h);
    if (onClick) {
        node.on(Button.EventType.CLICK, () => onClick());
    }
    return node;
}

/** 飘字（道心变化等，上浮 + 渐隐后自动销毁） */
export function floatText(parent: Node, text: string, colorHex: string, fontSize = 30): void {
    const label = makeLabel(parent, text, fontSize, colorHex, 420, 50);
    label.node.setPosition(0, 60, 0);
    const op = label.node.addComponent(UIOpacity);
    tween(label.node)
        .by(1.0, { position: new Vec3(0, 90, 0) }, { easing: 'quadOut' })
        .call(() => label.node.destroy())
        .start();
    tween(op)
        .delay(0.3)
        .to(0.7, { opacity: 0 })
        .start();
}

/** 全屏闪光（功成金光 / 未竟暗红），置顶后自动销毁 */
export function flashOverlay(parent: Node, colorHex: string, alpha: number, duration = 0.6): void {
    const size = view.getVisibleSize();
    const node = makePanel(parent, size.width, size.height, hexColor(colorHex, alpha), 0);
    // 置顶（盖住其他 UI）
    const siblings = node.parent ? node.parent.children : [];
    node.setSiblingIndex(siblings.length - 1);
    const op = node.addComponent(UIOpacity);
    tween(op)
        .to(duration, { opacity: 0 })
        .call(() => node.destroy())
        .start();
}

/** 节点抖动（揭晓震动演出） */
export function shakeNode(node: Node, intensity = 10): void {
    const orig = node.position.clone();
    tween(node)
        .by(0.05, { position: new Vec3(intensity, 0, 0) })
        .by(0.05, { position: new Vec3(-intensity * 2, 0, 0) })
        .by(0.05, { position: new Vec3(intensity * 2, 0, 0) })
        .by(0.05, { position: new Vec3(-intensity, 0, 0) })
        .call(() => node.setPosition(orig))
        .start();
}
