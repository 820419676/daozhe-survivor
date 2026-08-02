// ============================================================
// DamageNumber —— 伤害数字飘字（对象池 + 上飘渐隐）
// ------------------------------------------------------------
// 挂载：Canvas 下专用 UI 悬浮层节点（建议置于其它 UI 之上）。
// UI 由代码生成（Label + 描边），无需美术资源。
//
// 用法：
//   - 自动：订阅 COMBAT_DAMAGE（{ target, damage, isCrit, position }），
//     战斗系统发出伤害事件即自动生成飘字
//   - 手动：DamageNumber.show(worldPos, value, isCrit, isHeal)
//     （治疗量请传 isHeal = true，显示为绿色 +N）
//
// 特性：
//   - 上飘 + 渐隐（cc.tween），普通=白 / 暴击=橙 / 治疗=绿
//   - 伤害越大字号越大（22 ~ 60）
//   - 对象池复用节点（上限 40），动画结束自动回收
// ============================================================

import { _decorator, Component, Node, Label, UITransform, Vec3, UIOpacity, LabelOutline, tween, Tween } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { hexColor, makeLabel } from '../core/UIUtils';

const { ccclass } = _decorator;

/** 颜色：普通伤害=白 / 暴击=橙 / 治疗=绿 */
const COLOR_NORMAL = '#FFFFFF';
const COLOR_CRIT = '#FF9800';
const COLOR_HEAL = '#4CAF50';

/** 上飘距离与时长 */
const FLOAT_DISTANCE = 70;
const FLOAT_DURATION = 0.7;
/** 先上飘再渐隐（延迟开始淡出） */
const FADE_DELAY = 0.25;
const FADE_DURATION = 0.45;
/** 同位置飘字随机横向散布（±14px） */
const SPREAD_RANGE = 28;
/** 对象池容量上限（超出直接销毁，防无限膨胀） */
const POOL_CAPACITY = 40;
/** 字号下限 / 上限 */
const FONT_MIN = 22;
const FONT_MAX = 60;

@ccclass('DamageNumber')
export class DamageNumber extends Component {
    private static _instance: DamageNumber | null = null;

    /** 对象池（空闲节点） */
    private pool: Node[] = [];

    static getInstance(): DamageNumber {
        return DamageNumber._instance!;
    }

    onLoad() {
        DamageNumber._instance = this;
        this.pool.length = 0;
        EventBus.getInstance().on(GameEvent.COMBAT_DAMAGE, this.onCombatDamage, this);
    }

    onDestroy() {
        EventBus.getInstance().off(GameEvent.COMBAT_DAMAGE, this.onCombatDamage, this);
        if (DamageNumber._instance === this) {
            DamageNumber._instance = null;
        }
    }

    // ============================================================
    // 工厂方法
    // ============================================================

    /**
     * 生成一个伤害飘字（世界坐标）
     * @param position 敌人世界坐标（自动换算到本悬浮层本地坐标）
     * @param value    数值（伤害 / 治疗量）
     * @param isCrit   是否暴击（橙色 + 放大回弹）
     * @param isHeal   是否治疗（绿色 +N）
     */
    static show(position: Vec3, value: number, isCrit: boolean = false, isHeal: boolean = false) {
        const inst = DamageNumber._instance;
        if (!inst || !inst.isValid) {
            console.warn('[DamageNumber] 未挂载 DamageNumber 组件，飘字忽略');
            return;
        }
        inst.spawn(position, value, isCrit, isHeal);
    }

    /** COMBAT_DAMAGE 事件入口（战斗系统发出后自动生成飘字） */
    private onCombatDamage(payload: { target: string; damage: number; isCrit: boolean; position: { x: number; y: number } }) {
        if (!payload || payload.damage <= 0) return;
        DamageNumber.show(
            new Vec3(payload.position.x, payload.position.y, 0),
            payload.damage,
            !!payload.isCrit,
        );
    }

    // ============================================================
    // 飘字生成与回收
    // ============================================================

    private spawn(worldPos: Vec3, value: number, isCrit: boolean, isHeal: boolean) {
        // 1. 取节点（池中优先；停掉残留动画，保证状态干净）
        const node = this.pool.pop() ?? this.createNode();
        const label = node.getComponent(Label)!;
        const op = node.getComponent(UIOpacity)!;
        Tween.stopAllByTarget(node);
        Tween.stopAllByTarget(op);

        // 2. 世界坐标 → 本悬浮层本地坐标（+随机横向散布，避免叠字）
        const local = this.worldToLocal(worldPos);
        node.setPosition(
            local.x + (Math.random() - 0.5) * SPREAD_RANGE,
            local.y,
            local.z,
        );
        node.setScale(1, 1, 1);
        node.active = true;

        // 3. 文案 / 颜色 / 字号（伤害越大字越大）
        label.string = isHeal ? `+${Math.round(value)}` : `${Math.round(value)}`;
        label.fontSize = this.calcFontSize(value);
        label.color = hexColor(isHeal ? COLOR_HEAL : isCrit ? COLOR_CRIT : COLOR_NORMAL);
        op.opacity = 255;

        // 4. 暴击：放大回弹（更有打击感）
        if (isCrit) {
            node.setScale(1.35, 1.35, 1);
            tween(node)
                .to(0.12, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' })
                .start();
        }

        // 5. 上飘 + 渐隐，结束后回池
        tween(node)
            .by(FLOAT_DURATION, { position: new Vec3(0, FLOAT_DISTANCE, 0) }, { easing: 'quadOut' })
            .call(() => this.recycle(node))
            .start();
        tween(op)
            .delay(FADE_DELAY)
            .to(FADE_DURATION, { opacity: 0 })
            .start();
    }

    /** 创建一个飘字节点（Label + 描边 + 透明度） */
    private createNode(): Node {
        const label = makeLabel(this.node, '', FONT_MIN, COLOR_NORMAL, 240, 56);
        label.node.name = 'DamageNumber';
        label.isBold = true;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.node.addComponent(UIOpacity);
        const outline = label.node.addComponent(LabelOutline);
        outline.color = hexColor('#1B1B1B', 200);
        outline.width = 3;
        label.node.active = false;
        return label.node;
    }

    /** 动画结束：停掉动画并归还对象池 */
    private recycle(node: Node) {
        Tween.stopAllByTarget(node);
        const op = node.getComponent(UIOpacity);
        if (op) Tween.stopAllByTarget(op);
        node.active = false;
        if (this.pool.length < POOL_CAPACITY) {
            this.pool.push(node);
        } else {
            node.destroy();
        }
    }

    // ============================================================
    // 工具
    // ============================================================

    /** 世界坐标 → 本组件节点（悬浮层）本地坐标；无父节点 UITransform 时原样返回 */
    private worldToLocal(worldPos: Vec3): Vec3 {
        const host = this.node.parent;
        if (host) {
            const ui = host.getComponent(UITransform);
            if (ui) return ui.convertToNodeSpaceAR(worldPos);
        }
        return worldPos.clone();
    }

    /** 字号曲线：22 + log2(值) × 5，封顶 60（1 ~ 10 万伤害跨度都清晰） */
    private calcFontSize(value: number): number {
        const size = FONT_MIN + Math.floor(Math.log2(Math.max(1, value)) * 5);
        return Math.min(FONT_MAX, size);
    }
}
