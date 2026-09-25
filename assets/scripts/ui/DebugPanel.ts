// ============================================================
// DebugPanel —— 可玩状态调试面板（仅开发环境，右下角）
// ------------------------------------------------------------
// 字段：Enemies / Kills / XP / Weapon / State
// 用途：确认战斗、掉落、经验与升级事件是否真的在运行。
// 关闭：core/GameConfig.DEBUG_UI 常量置 false（GameEntry 依
//       GAME_CONFIG.debug.debugUi 决定是否挂载本组件）。
// ============================================================

import { _decorator, Component, Label, view } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GameManager, GameState } from '../core/GameManager';
import { PlayerRegistry } from '../core/PlayerRegistry';
import { Enemy } from '../enemy/Enemy';
import { WEAPON_CONFIGS } from '../combat/WeaponData';
import { hexColor, makeLabel, makePanel } from '../core/UIUtils';

const { ccclass } = _decorator;

/** 刷新间隔（秒）：面板低频轮询，开销可忽略 */
const REFRESH_INTERVAL = 0.2;

@ccclass('DebugPanel')
export class DebugPanel extends Component {
    private lines: Label[] = [];
    private kills: number = 0;
    private refreshTimer: number = 0;

    private onEnemyKilled = (): void => {
        this.kills++;
    };

    private onGameStart = (): void => {
        this.kills = 0;
    };

    onLoad(): void {
        const bus = EventBus.getInstance();
        bus.on(GameEvent.ENEMY_KILLED, this.onEnemyKilled);
        bus.on(GameEvent.GAME_START, this.onGameStart);
        this.buildUI();
    }

    onDestroy(): void {
        const bus = EventBus.getInstance();
        bus.off(GameEvent.ENEMY_KILLED, this.onEnemyKilled);
        bus.off(GameEvent.GAME_START, this.onGameStart);
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
        const pd = PlayerRegistry.getPlayer();
        const weapons = pd ? pd.weapons : [];
        const weaponText = weapons
            .map((w) => `${WEAPON_CONFIGS[w.id]?.name ?? w.id} Lv.${w.level}`)
            .join(' + ') || '—';

        const values = [
            `Enemies: ${Enemy.alive.length}`,
            `Kills: ${this.kills}`,
            `XP: ${pd ? Math.floor(pd.xp) : 0} / ${pd ? pd.xpToNext : 0} (Lv ${pd ? pd.level : 1})`,
            `Weapon: ${weaponText}`,
            `State: ${gm ? GameState[gm.state] : '?'}`,
        ];
        this.lines.forEach((label, i) => {
            if (label && values[i] !== undefined) label.string = values[i];
        });
    }

    private buildUI(): void {
        const size = view.getVisibleSize();
        const W = 380;
        const H = 132;
        const panel = makePanel(this.node, W, H, hexColor('#0A0E14', 200), 10);
        panel.name = 'DebugRoot';
        panel.setPosition(size.width / 2 - W / 2 - 14, -size.height / 2 + H / 2 + 14, 0);

        const title = makeLabel(panel, 'DEBUG', 13, '#7DD3FC', W - 20, 18);
        title.node.setPosition(0, H / 2 - 15, 0);

        for (let i = 0; i < 5; i++) {
            const label = makeLabel(panel, '', 14, '#C8D6E0', W - 26, 19);
            label.node.setPosition(-6, H / 2 - 34 - i * 19, 0);
            label.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.lines.push(label);
        }
        this.refresh();
    }
}
