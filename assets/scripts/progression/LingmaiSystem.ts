// ============================================================
// LingmaiSystem —— 灵脉资源点（地图上的主动取舍点）
// ------------------------------------------------------------
// 规则（数值收敛在 core/GameConfig.lingmai）：
//   每 35 秒在距玩家 350–500px 处生成一座灵脉法阵（限制在地图内，必然可达）；
//   玩家进入法阵并连续停留 3 秒完成采集（离开则进度清零，采集期间敌人照常靠近）；
//   20 秒未采集则消失；采集完成后三选一奖励（经验灵珠 / 武器伤害 +15% / 御风步刷新）。
//
// 设计目的：把移动从"单纯逃跑"变成"主动决定是否冒险抢资源"。
//   不采集也能继续玩（无任何负面），但采集收益明显高于同期普通刷怪。
//
// 视觉：蓝金色圆形法阵 + 采集进度环 + 头顶倒计时 + 屏幕边缘方向箭头。
// 事件：LINGMAI_SPAWNED / LINGMAI_COLLECTED / LINGMAI_EXPIRED
// ============================================================

import {
    _decorator, Component, Graphics, Label, Node, UITransform, Vec3, view,
} from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GAME_CONFIG } from '../core/GameConfig';
import { GameManager, GameState } from '../core/GameManager';
import { hexColor } from '../core/UIUtils';
import { RewardPanel } from './RewardPanel';
import { Rewards } from './Rewards';

const { ccclass } = _decorator;

/** 地图可用半宽（法阵必须落在玩家能走到的范围内） */
const MAP_LIMIT = 880;
/** 方向箭头贴合屏幕边缘的内缩距离 */
const ARROW_INSET = 52;

@ccclass('LingmaiSystem')
export class LingmaiSystem extends Component {
    private static _instance: LingmaiSystem | null = null;

    static getInstance(): LingmaiSystem | null {
        return LingmaiSystem._instance;
    }

    /** 距下次生成的时间（秒）：按"每 35 秒一座"的节奏，首座在第 35 秒 */
    private spawnTimer: number = GAME_CONFIG.lingmai.interval;
    /** 当前法阵节点（null = 场上没有灵脉） */
    private lingmaiNode: Node | null = null;
    private lingmaiGfx: Graphics | null = null;
    private countdownLabel: Label | null = null;
    /** 剩余存在时间（秒） */
    private remain: number = 0;
    /** 已停留采集时间（秒） */
    private holdTimer: number = 0;

    // —— 屏幕边缘方向箭头 ——
    private arrowNode: Node | null = null;
    private arrowGfx: Graphics | null = null;
    private arrowLabel: Label | null = null;

    /** 状态文案（DebugPanel） */
    private status: string = '—';

    onLoad(): void {
        LingmaiSystem._instance = this;
        this.buildArrow();
        EventBus.on(GameEvent.GAME_START, this.onGameStart, this);
    }

    onDestroy(): void {
        EventBus.off(GameEvent.GAME_START, this.onGameStart, this);
        if (LingmaiSystem._instance === this) LingmaiSystem._instance = null;
    }

    /** DebugPanel 读取的状态文案 */
    public getStatusText(): string {
        return this.status;
    }

    // ==================== 帧更新 ====================

    update(dt: number): void {
        const gm = GameManager.getInstance();
        if (!gm || gm.state !== GameState.PLAYING) return;

        const cfg = GAME_CONFIG.lingmai;
        const player = gm.getPlayer();

        if (!this.lingmaiNode) {
            this.status = '—';
            this.spawnTimer -= dt;
            if (this.spawnTimer <= 0) this.spawn();
            this.hideArrow();
            return;
        }

        // —— 存在中的法阵：倒计时 / 采集判定 / 超时消失 ——
        this.remain -= dt;
        if (this.remain <= 0) {
            this.expire();
            return;
        }

        if (player && player.isValid) {
            const dist = Vec3.distance(this.lingmaiNode.worldPosition, player.worldPosition);
            if (dist <= cfg.radius) {
                this.holdTimer += dt;
                if (this.holdTimer >= cfg.holdSeconds) {
                    this.collect();
                    return;
                }
            } else if (this.holdTimer > 0) {
                this.holdTimer = 0; // 离开法阵：进度清零
            }
        }

        this.redraw();
        this.updateArrow(player);
        this.status = this.holdTimer > 0
            ? `采集中 ${this.holdTimer.toFixed(1)}/${cfg.holdSeconds}`
            : `${this.remain.toFixed(0)}s`;
    }

    // ==================== 生成 / 采集 / 消失 ====================

    /** 在距玩家 350–500px 的可达位置生成一座灵脉 */
    private spawn(): void {
        const gm = GameManager.getInstance();
        const player = gm ? gm.getPlayer() : null;
        const cfg = GAME_CONFIG.lingmai;

        let x = 0;
        let y = 0;
        if (player && player.isValid) {
            const angle = Math.random() * Math.PI * 2;
            const dist = cfg.minDistance + Math.random() * (cfg.maxDistance - cfg.minDistance);
            x = player.position.x + Math.cos(angle) * dist;
            y = player.position.y + Math.sin(angle) * dist;
        }
        // 限制在地图内 —— 保证"必须生成在可到达区域"
        x = Math.min(Math.max(x, -MAP_LIMIT), MAP_LIMIT);
        y = Math.min(Math.max(y, -MAP_LIMIT), MAP_LIMIT);

        const node = new Node('Lingmai');
        node.setParent(this.node);
        node.addComponent(UITransform).setContentSize(cfg.radius * 2, cfg.radius * 2);
        this.lingmaiGfx = node.addComponent(Graphics);
        node.setPosition(x, y, 0);

        // 头顶倒计时
        const labelNode = new Node('Countdown');
        labelNode.setParent(node);
        labelNode.addComponent(UITransform).setContentSize(160, 26);
        this.countdownLabel = labelNode.addComponent(Label);
        this.countdownLabel.fontSize = 18;
        this.countdownLabel.lineHeight = 22;
        this.countdownLabel.isBold = true;
        this.countdownLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.countdownLabel.verticalAlign = Label.VerticalAlign.CENTER;
        labelNode.setPosition(0, cfg.radius + 26, 0);

        this.lingmaiNode = node;
        this.remain = cfg.lifetime;
        this.holdTimer = 0;
        this.spawnTimer = cfg.interval;
        this.redraw();

        EventBus.emit(GameEvent.LINGMAI_SPAWNED, {
            position: new Vec3(x, y, 0),
            duration: cfg.lifetime,
        });
    }

    /** 采集完成：三选一奖励（面板打不开时自动发放默认奖励，避免奖励丢失） */
    private collect(): void {
        const node = this.lingmaiNode;
        if (!node) return;
        const pos = node.worldPosition.clone();
        this.clearLingmai();
        this.spawnTimer = GAME_CONFIG.lingmai.interval;
        this.status = '—';

        EventBus.emit(GameEvent.LINGMAI_COLLECTED, { reward: 'choose' });

        const cfg = GAME_CONFIG.lingmai;
        const mult = Rewards.getLingmaiMultiplier();
        const opened = RewardPanel.open(
            '灵脉现世',
            '采集完成 · 选择一项奖励',
            [
                {
                    id: 'lingmai_xp',
                    name: '大量经验灵珠',
                    desc: `立即散落 ${Math.round(cfg.xpOrbs * mult)} 颗灵珠（合计约 ${Math.round(cfg.xpOrbs * mult) * cfg.xpPerOrb} 点经验）`,
                },
                {
                    id: 'lingmai_damage',
                    name: '武器伤害 +15%',
                    desc: `本局所有武器伤害提升 ${Math.round(cfg.damageBonus * mult * 100)}%`,
                },
                {
                    id: 'lingmai_dash',
                    name: '御风步·刷新',
                    desc: '冷却立即归零，且下一次冲刺伤害翻倍',
                },
            ],
            (id) => Rewards.applyLingmai(id, pos),
        );
        if (!opened) {
            // 另有奖励面板开着：直接发放经验奖励兜底
            Rewards.applyLingmai('lingmai_xp', pos);
        }
    }

    /** 超时消失（不采集没有任何惩罚，只是错过收益） */
    private expire(): void {
        this.clearLingmai();
        this.spawnTimer = GAME_CONFIG.lingmai.interval;
        this.status = '—';
        EventBus.emit(GameEvent.LINGMAI_EXPIRED);
    }

    private clearLingmai(): void {
        if (this.lingmaiNode && this.lingmaiNode.isValid) this.lingmaiNode.destroy();
        this.lingmaiNode = null;
        this.lingmaiGfx = null;
        this.countdownLabel = null;
        this.holdTimer = 0;
        this.remain = 0;
        this.hideArrow();
    }

    private onGameStart(): void {
        this.clearLingmai();
        this.spawnTimer = GAME_CONFIG.lingmai.interval;
        this.status = '—';
        Rewards.resetRun(); // 灵脉奖励倍率等本局状态复位
    }

    // ==================== 视觉 ====================

    /** 蓝金色圆形法阵 + 采集进度环 */
    private redraw(): void {
        const g = this.lingmaiGfx;
        const cfg = GAME_CONFIG.lingmai;
        if (!g) return;
        const r = cfg.radius;
        const pulse = 1 + 0.04 * Math.sin(Date.now() / 220);
        const ratio = Math.max(0, Math.min(1, this.remain / cfg.lifetime));

        g.clear();
        // 外圈柔光（蓝）
        g.fillColor = hexColor('#3B82F6', 40);
        g.circle(0, 0, r * pulse + 10);
        g.fill();
        // 内层底色
        g.fillColor = hexColor('#1E3A8A', 90);
        g.circle(0, 0, r * pulse);
        g.fill();
        // 金色外环
        g.lineWidth = 4;
        g.strokeColor = hexColor('#FBBF24', 235);
        g.circle(0, 0, r * pulse);
        g.stroke();
        // 蓝色内环
        g.lineWidth = 2;
        g.strokeColor = hexColor('#60A5FA', 220);
        g.circle(0, 0, r * pulse * 0.62);
        g.stroke();
        // 六道法阵刻痕（缓慢旋转）
        const rot = (Date.now() / 1400) % (Math.PI * 2);
        g.lineWidth = 3;
        g.strokeColor = hexColor('#FDE68A', 210);
        for (let i = 0; i < 6; i++) {
            const a = rot + (Math.PI * 2 * i) / 6;
            g.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
            g.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
        }
        g.stroke();
        // 中心灵核
        g.fillColor = hexColor('#93C5FD', 220);
        g.circle(0, 0, r * 0.18);
        g.fill();

        // 采集进度环（从 12 点方向顺时针，仅采集时显示）
        if (this.holdTimer > 0) {
            const progress = Math.min(1, this.holdTimer / cfg.holdSeconds);
            const steps = 40;
            const filled = Math.round(steps * progress);
            g.lineWidth = 6;
            g.strokeColor = hexColor('#22D3EE', 255);
            for (let i = 0; i < filled; i++) {
                const a0 = Math.PI / 2 - (Math.PI * 2 * i) / steps;
                const a1 = Math.PI / 2 - (Math.PI * 2 * (i + 1)) / steps;
                const rr = r + 12;
                g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
                g.lineTo(Math.cos(a1) * rr, Math.sin(a1) * rr);
            }
            g.stroke();
        }

        // 倒计时文字
        if (this.countdownLabel) {
            if (this.holdTimer > 0) {
                this.countdownLabel.string = `采集 ${this.holdTimer.toFixed(1)} / ${cfg.holdSeconds}s`;
                this.countdownLabel.color = hexColor('#22D3EE');
            } else {
                this.countdownLabel.string = `灵脉 ${this.remain.toFixed(0)}s`;
                this.countdownLabel.color = ratio < 0.3 ? hexColor('#F87171') : hexColor('#FDE68A');
            }
        }
    }

    // ==================== 屏幕边缘方向箭头 ====================

    private buildArrow(): void {
        const node = new Node('LingmaiArrow');
        node.setParent(this.node);
        node.addComponent(UITransform).setContentSize(56, 56);
        this.arrowGfx = node.addComponent(Graphics);

        const labelNode = new Node('ArrowLabel');
        labelNode.setParent(node);
        labelNode.addComponent(UITransform).setContentSize(120, 24);
        this.arrowLabel = labelNode.addComponent(Label);
        this.arrowLabel.fontSize = 16;
        this.arrowLabel.lineHeight = 20;
        this.arrowLabel.isBold = true;
        this.arrowLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.arrowLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this.arrowLabel.color = hexColor('#FDE68A');
        labelNode.setPosition(0, -34, 0);

        node.active = false;
        this.arrowNode = node;
    }

    /** 法阵在屏幕外时，在屏幕边缘显示指向箭头 + 距离 */
    private updateArrow(player: Node | null): void {
        const arrow = this.arrowNode;
        const lm = this.lingmaiNode;
        if (!arrow || !lm || !player || !player.isValid) {
            this.hideArrow();
            return;
        }
        const size = view.getVisibleSize();
        const halfW = size.width / 2 - ARROW_INSET;
        const halfH = size.height / 2 - ARROW_INSET;

        // 法阵已在屏幕内 → 不需要箭头
        if (Math.abs(lm.position.x) <= halfW + ARROW_INSET && Math.abs(lm.position.y) <= halfH + ARROW_INSET) {
            this.hideArrow();
            return;
        }

        // 从玩家位置沿方向射线，与屏幕矩形求交，箭头贴在边缘
        const dx = lm.position.x - player.position.x;
        const dy = lm.position.y - player.position.y;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const sx = dx / len;
        const sy = dy / len;
        const scaleX = Math.abs(sx) > 1e-4 ? halfW / Math.abs(sx) : Number.POSITIVE_INFINITY;
        const scaleY = Math.abs(sy) > 1e-4 ? halfH / Math.abs(sy) : Number.POSITIVE_INFINITY;
        const scale = Math.min(scaleX, scaleY);

        arrow.setPosition(player.position.x + sx * scale, player.position.y + sy * scale, 0);
        arrow.angle = (Math.atan2(sy, sx) * 180) / Math.PI - 90; // 三角默认朝 +y

        const g = this.arrowGfx;
        if (g) {
            g.clear();
            g.fillColor = hexColor('#FBBF24', 235);
            g.moveTo(0, 20);
            g.lineTo(-14, -12);
            g.lineTo(14, -12);
            g.close();
            g.fill();
            g.lineWidth = 2;
            g.strokeColor = hexColor('#FFFFFF', 220);
            g.moveTo(0, 20);
            g.lineTo(-14, -12);
            g.lineTo(14, -12);
            g.close();
            g.stroke();
        }
        if (this.arrowLabel) {
            const dist = Math.round(Vec3.distance(lm.position, player.position));
            this.arrowLabel.string = `灵脉 ${dist}`;
        }
        arrow.active = true;
    }

    private hideArrow(): void {
        if (this.arrowNode && this.arrowNode.isValid && this.arrowNode.active) {
            this.arrowNode.active = false;
        }
    }
}
