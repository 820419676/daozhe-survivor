// ============================================================
// DashAbility —— 御风步（唯一主动技能）
// ------------------------------------------------------------
// 规则（数值收敛在 core/GameConfig.dash）：
//   冷却 6s；向当前移动方向冲刺 180px，历时 0.18s；
//   冲刺期间无敌；穿过敌人时施加轻微击退；
//   一次穿过 ≥3 个敌人显示"身法绝妙"横幅。
//
// 设计目的：保持操作极简（移动 + 一个主动按钮），
//   让被包围时有逃生与反杀空间，并给玩家"我操作得好"的归因。
//
// UI：右下角圆形按钮。就绪 = 青色 + 呼吸发光；冷却中 = 灰暗 +
//   环形进度 + 剩余秒数；冷却完毕播放一次弹出动画（明显发光提示）。
// 事件：DASH_STARTED / DASH_ENDED / DASH_READY
// ============================================================

import {
    _decorator, Component, EventTouch, Graphics, Label, Node, Tween,
    UITransform, Vec3, view, tween, Button,
} from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GAME_CONFIG } from '../core/GameConfig';
import { GameManager, GameState } from '../core/GameManager';
import { PlayerController } from '../player/PlayerController';
import { Enemy } from '../enemy/Enemy';
import { hexColor } from '../core/UIUtils';
import { Banner } from '../ui/Banner';

const { ccclass } = _decorator;

/** 按钮尺寸与右下角边距 */
const BUTTON_RADIUS = 44;
const BUTTON_MARGIN = 30;

@ccclass('DashAbility')
export class DashAbility extends Component {
    private static _instance: DashAbility | null = null;

    static getInstance(): DashAbility | null {
        return DashAbility._instance;
    }

    private player: PlayerController | null = null;

    /** 冷却剩余（秒） */
    private cooldown: number = 0;
    /** 冲刺剩余时间（秒） */
    private dashTimer: number = 0;
    private dashDir: Vec3 = new Vec3(1, 0, 0);
    private dashSpeed: number = 0;
    /** 本次冲刺已穿过的敌人（去重统计） */
    private hitEnemies: Set<Enemy> = new Set();
    private passedCount: number = 0;

    // —— UI ——
    private btnNode: Node | null = null;
    private btnGfx: Graphics | null = null;
    private btnLabel: Label | null = null;
    /** 上一次绘制时是否就绪（用于检测冷却完毕的瞬间） */
    private lastReady: boolean = true;

    onLoad(): void {
        DashAbility._instance = this;
        this.buildButton();
    }

    onDestroy(): void {
        if (DashAbility._instance === this) DashAbility._instance = null;
    }

    // ==================== 查询接口（DebugPanel 用） ====================

    /** 冷却剩余秒数（冲刺中返回 0） */
    public getCooldownRemaining(): number {
        return this.dashTimer > 0 ? 0 : this.cooldown;
    }

    /** 是否正在冲刺 */
    public isDashing(): boolean {
        return this.dashTimer > 0;
    }

    // ==================== 帧更新 ====================

    update(dt: number): void {
        const gm = GameManager.getInstance();
        const playing = !!gm && gm.state === GameState.PLAYING;

        if (this.dashTimer > 0) {
            this.stepDash(dt);
        } else if (playing && this.cooldown > 0) {
            // 冷却只在游戏进行中推进（升级/暂停时不走表）
            this.cooldown -= dt;
            if (this.cooldown <= 0) {
                this.cooldown = 0;
                this.playReadyFlash();
                EventBus.emit(GameEvent.DASH_READY);
            }
        }
        this.redrawButton();
    }

    // ==================== 冲刺 ====================

    /** 触发御风步（按钮点击 / 外部调用） */
    public activate(): void {
        if (this.dashTimer > 0) return;   // 冲刺中
        if (this.cooldown > 0) return;    // 冷却中（不允许连续无限冲刺）

        const gm = GameManager.getInstance();
        if (gm && gm.state !== GameState.PLAYING) return;

        const player = this.resolvePlayer();
        if (!player || !player.isAlive()) return;

        // 方向 = 当前移动方向（未移动过时默认向右）
        this.dashDir = player.getFacing();
        if (this.dashDir.lengthSqr() < 0.0001) this.dashDir.set(1, 0, 0);
        this.dashDir.normalize();

        this.dashSpeed = GAME_CONFIG.dash.distance / GAME_CONFIG.dash.duration;
        this.dashTimer = GAME_CONFIG.dash.duration;
        this.hitEnemies.clear();
        this.passedCount = 0;

        player.setDashInvincible(true); // 冲刺期间无敌
        player.setDashing(true);        // 暂停拖拽，位移由本组件接管

        EventBus.emit(GameEvent.DASH_STARTED, { direction: this.dashDir.clone() });
    }

    /** 冲刺位移：每帧推进 + 路径击退判定 */
    private stepDash(dt: number): void {
        const player = this.resolvePlayer();
        if (!player) {
            this.endDash(false);
            return;
        }
        const step = this.dashSpeed * dt;
        const pos = player.node.position;
        player.moveTo(pos.x + this.dashDir.x * step, pos.y + this.dashDir.y * step);

        this.knockbackNearby();

        this.dashTimer -= dt;
        if (this.dashTimer <= 0) this.endDash(true);
    }

    /** 冲刺路径上的敌人：轻微击退 + 统计穿过数量 */
    private knockbackNearby(): void {
        const player = this.resolvePlayer();
        if (!player) return;
        const r = GAME_CONFIG.dash.hitRadius;
        const myPos = player.node.worldPosition;
        for (const e of Enemy.alive) {
            if (this.hitEnemies.has(e)) continue;
            if (!e.node.isValid || !e.node.activeInHierarchy) continue;
            const d = Vec3.subtract(new Vec3(), e.node.worldPosition, myPos);
            if (d.lengthSqr() > r * r) continue;
            this.hitEnemies.add(e);
            this.passedCount++;
            e.applyKnockback(d, GAME_CONFIG.dash.knockback);
        }
    }

    /** 冲刺结束：解除无敌与位移接管，进入冷却；穿过 ≥3 敌人给"身法绝妙" */
    private endDash(completed: boolean): void {
        this.dashTimer = 0;
        const player = this.resolvePlayer();
        if (player) {
            player.setDashInvincible(false);
            player.setDashing(false);
        }
        if (completed) {
            this.cooldown = GAME_CONFIG.dash.cooldown;
            EventBus.emit(GameEvent.DASH_ENDED, { passed: this.passedCount });
            if (this.passedCount >= GAME_CONFIG.dash.perfectCount) {
                Banner.show('身法绝妙', '#5EEAD4', 1.2);
            }
        }
    }

    /** 解析玩家组件（懒查找 + 失效重查） */
    private resolvePlayer(): PlayerController | null {
        if (this.player && this.player.isValid) return this.player;
        const gm = GameManager.getInstance();
        const node = (gm ? gm.getPlayer() : null) ?? null;
        this.player = node ? node.getComponent(PlayerController) : null;
        return this.player;
    }

    // ==================== 按钮 UI ====================

    private buildButton(): void {
        const size = view.getVisibleSize();
        const node = new Node('DashButton');
        node.setParent(this.node);
        node.addComponent(UITransform).setContentSize(BUTTON_RADIUS * 2, BUTTON_RADIUS * 2);
        node.setPosition(
            size.width / 2 - BUTTON_RADIUS - BUTTON_MARGIN,
            -size.height / 2 + BUTTON_RADIUS + BUTTON_MARGIN,
            0,
        );
        this.btnGfx = node.addComponent(Graphics);

        const btn = node.addComponent(Button);
        btn.transition = Button.Transition.SCALE;
        btn.zoomScale = 0.92;

        // 阻止冒泡：否则点按钮会同时被 Canvas 上的拖拽移动监听吃掉
        node.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; });
        node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            this.activate();
        });
        node.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => { e.propagationStopped = true; });

        const labelNode = new Node('DashLabel');
        labelNode.setParent(node);
        labelNode.addComponent(UITransform).setContentSize(BUTTON_RADIUS * 2, BUTTON_RADIUS);
        this.btnLabel = labelNode.addComponent(Label);
        this.btnLabel.fontSize = 19;
        this.btnLabel.lineHeight = 24;
        this.btnLabel.isBold = true;
        this.btnLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.btnLabel.verticalAlign = Label.VerticalAlign.CENTER;

        this.btnNode = node;
        this.redrawButton();
    }

    /** 每帧重绘按钮（就绪：青色发光；冷却：灰暗 + 环形进度 + 剩余秒数） */
    private redrawButton(): void {
        const g = this.btnGfx;
        if (!g) return;
        const r = BUTTON_RADIUS;
        const ready = this.dashTimer <= 0 && this.cooldown <= 0;

        g.clear();
        if (ready) {
            // 呼吸发光外环（明显提示"可以用了"）
            const pulse = 1 + 0.05 * Math.sin(Date.now() / 160);
            g.fillColor = hexColor('#22D3EE', 45);
            g.circle(0, 0, r * pulse + 8);
            g.fill();
            g.fillColor = hexColor('#0E7490', 240);
            g.circle(0, 0, r);
            g.fill();
            g.lineWidth = 4;
            g.strokeColor = hexColor('#67E8F9', 255);
            g.circle(0, 0, r);
            g.stroke();
            if (this.btnLabel) {
                this.btnLabel.string = '御风';
                this.btnLabel.color = hexColor('#ECFEFF');
            }
        } else {
            // 冷却：灰暗底盘
            g.fillColor = hexColor('#1F2937', 215);
            g.circle(0, 0, r);
            g.fill();
            g.lineWidth = 3;
            g.strokeColor = hexColor('#4B5563', 255);
            g.circle(0, 0, r);
            g.stroke();

            // 环形进度：从 12 点方向顺时针长满（剩余比例）
            const ratio = Math.max(0, Math.min(1, this.cooldown / GAME_CONFIG.dash.cooldown));
            const steps = 28;
            const filled = Math.round(steps * (1 - ratio));
            g.lineWidth = 5;
            g.strokeColor = hexColor('#38BDF8', 225);
            for (let i = 0; i < filled; i++) {
                const a0 = Math.PI / 2 - (Math.PI * 2 * i) / steps;
                const a1 = Math.PI / 2 - (Math.PI * 2 * (i + 1)) / steps;
                g.moveTo(Math.cos(a0) * (r - 4), Math.sin(a0) * (r - 4));
                g.lineTo(Math.cos(a1) * (r - 4), Math.sin(a1) * (r - 4));
            }
            g.stroke();

            if (this.btnLabel) {
                this.btnLabel.string = this.dashTimer > 0 ? '冲刺' : this.cooldown.toFixed(1);
                this.btnLabel.color = hexColor('#94A3B8');
            }
        }

        // 冷却完毕的那一帧：弹出动画（明显发光提示）
        if (ready && !this.lastReady) this.playReadyFlash();
        this.lastReady = ready;
    }

    /** 冷却完毕的弹出动画 */
    private playReadyFlash(): void {
        const n = this.btnNode;
        if (!n || !n.isValid) return;
        Tween.stopAllByTarget(n);
        n.setScale(1, 1, 1);
        tween(n)
            .to(0.12, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'quadOut' })
            .to(0.12, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' })
            .start();
    }
}
