// ============================================================
// DebugPanel —— 可玩状态调试面板（仅开发环境，右下角）
// ------------------------------------------------------------
// 显示内容：
//   Enemies / Kills / XP（当前 / 升级所需）
//   每把武器一行：名称 Lv.N ×开火次数（配合 WEAPON_FIRED 事件，
//   可直接排查"技能只释放一次 / 从未释放"类问题）
//   Stats：力 / 范 / 速 / 持 / 冷 / 幸 / 贪（PlayerData 全属性）
//   HP / 暴击 / 磁吸 / 道心
//   State：GameManager 状态 + 对局时间
// 关闭：core/GameConfig.DEBUG_UI 常量置 false（GameEntry 依
//       GAME_CONFIG.debug.debugUi 决定是否挂载本组件）。
// ============================================================

import { _decorator, Component, Label, Node, view } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GameManager, GameState } from '../core/GameManager';
import { PlayerRegistry } from '../core/PlayerRegistry';
import { PlayerData } from '../player/PlayerData';
import { Enemy } from '../enemy/Enemy';
import { EnemyType } from '../enemy/EnemyTypes';
import { DashAbility } from '../player/DashAbility';
import { LingmaiSystem } from '../progression/LingmaiSystem';
import { BuildSystem } from '../progression/BuildSystem';
import { WEAPON_CONFIGS, WeaponType } from '../combat/WeaponData';
import { hexColor, makeLabel, makePanel } from '../core/UIUtils';
import { PASSIVE_CONFIGS } from '../combat/PassiveData';

const { ccclass } = _decorator;

/** 刷新间隔（秒）：面板低频轮询，开销可忽略 */
const REFRESH_INTERVAL = 0.2;
/** 武器行数上限（与武器槽位一致） */
const MAX_WEAPON_ROWS = 6;
/** 面板尺寸与行距（底部需给右下角御风步按钮让位，故整体上移） */
const PANEL_W = 408;
const PANEL_H = 272;
const LINE_GAP = 17;
/** 面板底边距屏幕底部的距离（= 御风按钮高度 + 间隙） */
const BOTTOM_OFFSET = 96;

/** 武器类型中文名（排查"哪个技能没效果"时快速定位释放形态） */
const WEAPON_TYPE_NAMES: Record<number, string> = {
    [WeaponType.ORBITAL]: '环绕',
    [WeaponType.LIGHTNING]: '天雷',
    [WeaponType.PROJECTILE]: '扇形',
    [WeaponType.AURA]: '光环',
    [WeaponType.PIERCING]: '贯穿',
    [WeaponType.STORM]: '剑雨',
};

/** 数值格式化：倍率保留 2 位小数 */
function fmt(v: number): string {
    return v.toFixed(2);
}

/** 秒数 → MM:SS */
function formatMMSS(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

@ccclass('DebugPanel')
export class DebugPanel extends Component {
    private info0: Label | null = null;
    private info1: Label | null = null;
    private weaponLabels: Label[] = [];
    private passiveLabel: Label | null = null;
    private statsLabel: Label | null = null;
    private hpLabel: Label | null = null;
    /** 系统状态行：御风步冷却 / 在场精英数 / 灵脉状态 */
    private statusLabel: Label | null = null;
    /** 流派行：标签累计次数 + 已获天赋 */
    private buildLabel: Label | null = null;
    private stateLabel: Label | null = null;

    private kills: number = 0;
    /** 本局累计承受伤害（验证敌人攻击是否真的生效） */
    private damageTaken: number = 0;
    /** 武器 id → 开火次数（WEAPON_FIRED 累计，GAME_START 清零） */
    private fireCounts: Map<string, number> = new Map();
    private refreshTimer: number = 0;

    private onEnemyKilled = (): void => {
        this.kills++;
    };

    private onPlayerDamaged = (payload: { amount?: number }): void => {
        this.damageTaken += payload?.amount ?? 0;
    };

    private onGameStart = (): void => {
        this.kills = 0;
        this.damageTaken = 0;
        this.fireCounts.clear();
    };

    private onWeaponFired = (payload: { id?: string }): void => {
        if (!payload?.id) return;
        this.fireCounts.set(payload.id, (this.fireCounts.get(payload.id) ?? 0) + 1);
    };

    onLoad(): void {
        const bus = EventBus.getInstance();
        bus.on(GameEvent.ENEMY_KILLED, this.onEnemyKilled);
        bus.on(GameEvent.PLAYER_DAMAGED, this.onPlayerDamaged);
        bus.on(GameEvent.GAME_START, this.onGameStart);
        bus.on(GameEvent.WEAPON_FIRED, this.onWeaponFired);
        this.buildUI();
    }

    onDestroy(): void {
        const bus = EventBus.getInstance();
        bus.off(GameEvent.ENEMY_KILLED, this.onEnemyKilled);
        bus.off(GameEvent.PLAYER_DAMAGED, this.onPlayerDamaged);
        bus.off(GameEvent.GAME_START, this.onGameStart);
        bus.off(GameEvent.WEAPON_FIRED, this.onWeaponFired);
    }

    update(dt: number): void {
        this.refreshTimer += dt;
        if (this.refreshTimer < REFRESH_INTERVAL) return;
        this.refreshTimer = 0;
        this.refresh();
    }

    /** 每 0.2s 刷新一次面板数据 */
    private refresh(): void {
        const gm = GameManager.getInstance();
        const pd: PlayerData | null = PlayerRegistry.getPlayer();

        if (this.info0) {
            this.info0.string = `Enemies: ${Enemy.alive.length}   Kills: ${this.kills}`;
        }
        if (this.info1) {
            this.info1.string = pd
                ? `XP: ${Math.floor(pd.xp)} / ${pd.xpToNext}  (Lv ${pd.level})`
                : 'XP: — / —';
        }

        // —— 武器：名称 Lv.N [类型] ×开火次数 ——
        const weapons = pd ? pd.weapons : [];
        for (let i = 0; i < MAX_WEAPON_ROWS; i++) {
            const label = this.weaponLabels[i];
            if (!label) continue;
            if (i < weapons.length) {
                const w = weapons[i];
                const cfg = WEAPON_CONFIGS[w.id];
                const fires = this.fireCounts.get(w.id) ?? 0;
                const typeName = cfg ? (WEAPON_TYPE_NAMES[cfg.type] ?? '?') : '?';
                label.string = `${cfg ? cfg.name : w.id} Lv.${w.level} [${typeName}] ×${fires}`;
                label.node.active = true;
            } else {
                label.node.active = false;
            }
        }

        // —— 被动 ——
        if (this.passiveLabel) {
            const passives = pd ? pd.passives : [];
            this.passiveLabel.string = passives.length > 0
                ? `被动: ${passives.map((p) => `${PASSIVE_CONFIGS[p.id]?.name ?? p.id} Lv.${p.level}`).join('  ')}`
                : '被动: —';
        }

        // —— 全属性 ——
        if (this.statsLabel) {
            this.statsLabel.string = pd
                ? `力${fmt(pd.might)} 范${fmt(pd.area)} 速${fmt(pd.speed)} 持${fmt(pd.duration)} 冷${fmt(pd.cooldown)} 幸${fmt(pd.luck)} 贪${fmt(pd.greed)}`
                : 'Stats: —';
        }
        if (this.hpLabel) {
            this.hpLabel.string = pd
                ? `HP ${Math.ceil(pd.hp)}/${pd.maxHp}  受伤${this.damageTaken}  暴击${Math.round(pd.critChance * 100)}%  磁吸${Math.round(pd.pickupRange)}  道心${Math.round(pd.bravery)}`
                : 'HP —';
        }
        if (this.statusLabel) {
            const dash = DashAbility.getInstance();
            const dashText = dash
                ? (dash.isDashing() ? '冲刺中' : dash.getCooldownRemaining() > 0 ? `${dash.getCooldownRemaining().toFixed(1)}s` : 'READY')
                : '—';
            let eliteCount = 0;
            for (const e of Enemy.alive) {
                if (e.node.isValid && e.getType() === EnemyType.ELITE) eliteCount++;
            }
            this.statusLabel.string = `Dash ${dashText}   Elite ${eliteCount}   Lingmai ${this.lingmaiText()}`;
        }
        if (this.buildLabel) {
            this.buildLabel.string = `Tags: ${BuildSystem.getTagSummary()}  |  天赋: ${BuildSystem.getTalentSummary()}`;
        }
        if (this.stateLabel) {
            this.stateLabel.string = `State: ${gm ? GameState[gm.state] : '?'}  ${gm ? formatMMSS(gm.elapsedTime) : '00:00'}`;
        }
    }

    /** 灵脉状态文案（灵脉系统未挂载时显示 —） */
    private lingmaiText(): string {
        const sys = LingmaiSystem.getInstance();
        return sys ? sys.getStatusText() : '—';
    }

    private buildUI(): void {
        const size = view.getVisibleSize();
        const panel = makePanel(this.node, PANEL_W, PANEL_H, hexColor('#0A0E14', 205), 10);
        panel.name = 'DebugRoot';
        // 右下角，但整体上移给御风步按钮让位
        panel.setPosition(
            size.width / 2 - PANEL_W / 2 - 14,
            -size.height / 2 + BOTTOM_OFFSET + PANEL_H / 2,
            0,
        );

        const title = makeLabel(panel, 'DEBUG', 13, '#7DD3FC', PANEL_W - 20, 18);
        title.node.setPosition(0, PANEL_H / 2 - 15, 0);

        // 行 y 坐标（自上而下）：信息 2 行 → 武器 6 行 → 属性 3 行
        let y = PANEL_H / 2 - 32;
        this.info0 = this.addLine(panel, '', y); y -= LINE_GAP;
        this.info1 = this.addLine(panel, '', y); y -= LINE_GAP;
        for (let i = 0; i < MAX_WEAPON_ROWS; i++) {
            this.weaponLabels.push(this.addLine(panel, '', y, '#FFE08A'));
            y -= LINE_GAP;
        }
        this.passiveLabel = this.addLine(panel, '', y, '#B9A6FF'); y -= LINE_GAP;
        this.statsLabel = this.addLine(panel, '', y, '#9BD7A0'); y -= LINE_GAP;
        this.hpLabel = this.addLine(panel, '', y, '#C8D6E0'); y -= LINE_GAP;
        this.statusLabel = this.addLine(panel, '', y, '#F0ABFC'); y -= LINE_GAP;
        this.buildLabel = this.addLine(panel, '', y, '#FDBA74'); y -= LINE_GAP;
        this.stateLabel = this.addLine(panel, '', y, '#7DD3FC');

        this.refresh();
    }

    /** 在面板左侧添加一行等宽文本 */
    private addLine(parent: Node, text: string, y: number, colorHex = '#C8D6E0'): Label {
        const label = makeLabel(parent, text, 13, colorHex, PANEL_W - 24, 18);
        label.node.setPosition(-4, y, 0);
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        return label;
    }
}
