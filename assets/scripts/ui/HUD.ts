// ============================================================
// HUD —— 主界面常驻 HUD（顶栏信息 / 武器被动图标 / 道心连渡 / 暂停）
// ------------------------------------------------------------
// 挂载：Canvas 下常驻节点，全场景唯一。
// UI 全部由代码生成（纯色矩形 + 文字），无需任何美术资源。
//
// 事件订阅（统一走 core/EventBus，与问心/升级/战斗系统同一总线）：
//   SECOND_TICK / PLAYER_LEVEL_UP / XP_COLLECTED / ENEMY_KILLED
//   WENXIN_RESULT / WEAPON_ADDED / WEAPON_UPGRADED / WEAPON_EVOLVED
//   GAME_START（新一局重置显示）
//
// 兼容说明：
//   - 计时以 GameManager.elapsedTime 为准（update 自驱动，任何环境都可靠），
//     SECOND_TICK 事件作为冗余通道同步监听
//   - 经验以 GameManager.playerData（XPSystem 维护）为准，
//     同时监听 PlayerController 广播的 PLAYER_XP（当前运行时经验主路径）
//   - 灵石（金币）运行时由 PlayerController.getData().gold 维护，
//     通过 GOLD_PICKED 事件刷新
// ============================================================

import { _decorator, Component, Node, Label, Graphics, UITransform, Color, Vec3, view, Button } from 'cc';
import { find } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GameManager, GameState } from '../core/GameManager';
import { PauseReason } from '../core/PauseReason';
import { hexColor, makeButton, makeLabel, makePanel } from '../core/UIUtils';
import { PlayerData } from '../player/PlayerData';
import { WEAPON_CONFIGS } from '../combat/WeaponData';
import { WenxinManager } from '../wenxin/WenxinManager';
import { WenxinResult } from '../wenxin/WenxinData';
import { PlayerController } from '../player/PlayerController';

const { ccclass } = _decorator;

// 事件名统一走 core/GameEvent 枚举：
//   GameEvent.SECOND_TICK  —— 整秒计时（GameManager 广播）
//   GameEvent.PLAYER_XP    —— 玩家经验变化（PlayerController 广播，当前运行时经验主路径）
//   GameEvent.GOLD_PICKED  —— 灵石拾取（PlayerController 广播，金币刷新）

/** 武器图标配色（combat/WeaponData 武器 id；超武统一金色，见刷新逻辑） */
const WEAPON_ICON_COLORS: Record<string, string> = {
    sword_array: '#5C9EFF',       // 太极剑阵 · 蓝
    thunder_talisman: '#8E7CFF',  // 雷霆符 · 紫
    ice_palm: '#4FC3F7',          // 寒冰掌 · 天蓝
    flame_ring: '#FFB74D',        // 烈焰环 · 橙
    flying_sword: '#81C784',      // 飞剑术 · 绿
    sword_storm: '#F06292',       // 万剑诀 · 粉
};
/** 超武（进化武器）统一金色 */
const COLOR_EVOLVED = '#FFD700';
/** 未知武器兜底色 */
const COLOR_UNKNOWN = '#BDBDBD';

/** 被动图标配色 */
const PASSIVE_ICON_COLORS: Record<string, string> = {
    cishi: '#4FC3F7',     // 磁铁 · 天蓝
    jixie_xie: '#AED581', // 疾风鞋 · 草绿
    xingyun_fu: '#FFD54F',// 幸运符 · 金黄
    yandou: '#A1887F',    // 烟斗 · 棕
};

/** 武器 / 被动图标槽位上限 */
const MAX_WEAPON_SLOTS = 6;
const MAX_PASSIVE_SLOTS = 4;

/** 单个图标槽位视图（方块 + 等级文字） */
interface SlotView {
    root: Node;
    gfx: Graphics;
    level: Label;
}

/** 秒数 → MM:SS */
function formatMMSS(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

/** 生成左锚点进度条前景（Graphics 填充，scaleX 即进度） */
function makeBar(parent: Node, w: number, h: number, colorHex: string, radius = 4): Node {
    const node = new Node('Bar');
    node.setParent(parent);
    const ui = node.addComponent(UITransform);
    ui.setContentSize(w, h);
    ui.setAnchorPoint(0, 0.5);
    const g = node.addComponent(Graphics);
    g.fillColor = hexColor(colorHex);
    g.roundRect(0, -h / 2, w, h, radius);
    g.fill();
    return node;
}

@ccclass('HUD')
export class HUD extends Component {
    // —— 顶栏 ——
    private levelLabel: Label | null = null;   // 等级
    private xpBar: Node | null = null;         // 经验条前景（scaleX 即进度）
    private timerLabel: Label | null = null;   // 计时 MM:SS
    private goldLabel: Label | null = null;    // 灵石
    // —— 图标区 ——
    private weaponSlots: SlotView[] = [];
    private passiveSlots: SlotView[] = [];
    // —— 底部状态 ——
    private courageLabel: Label | null = null; // 道心
    private streakLabel: Label | null = null;  // 连渡
    private killsLabel: Label | null = null;   // 击杀
    // —— 暂停 ——
    private pauseBtnLabel: Label | null = null;
    private pauseOverlay: Node | null = null;

    /** 上一个已显示的整秒（计时去重） */
    private lastSecond: number = -1;
    /** 本局击杀数（本地计数，GAME_START 清零） */
    private kills: number = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    onLoad() {
        this.buildUI();
        this.subscribe();
    }

    start() {
        // 场景内所有 onLoad 之后做一次全量同步（覆盖组件后挂载/晚开局的情况）
        this.syncAll();
    }

    onDestroy() {
        this.unsubscribe();
    }

    /** 帧驱动计时（权威来源 = GameManager.elapsedTime，暂停期间不推进） */
    update() {
        const gm = GameManager.getInstance();
        if (!gm) return;
        const second = Math.floor(gm.elapsedTime);
        if (second !== this.lastSecond) {
            this.lastSecond = second;
            if (this.timerLabel) this.timerLabel.string = formatMMSS(second);
        }
    }

    // ============================================================
    // 事件订阅
    // ============================================================

    private subscribe() {
        const bus = EventBus.getInstance();
        bus.on(GameEvent.SECOND_TICK, this.onSecondTick, this);
        bus.on(GameEvent.PLAYER_LEVEL_UP, this.onLevelUp, this);
        bus.on(GameEvent.XP_COLLECTED, this.onXpCollected, this);
        // 迁移期双拼：PlayerController / Enemy 目前仍发大写字符串（'PLAYER_XP' 等），
        // 统一为枚举小写值后下方兼容订阅可删除（同一事件只会由其中一个写法发出）
        bus.on(GameEvent.PLAYER_XP, this.onPlayerXp, this);
        bus.on('PLAYER_XP', this.onPlayerXp, this);
        bus.on(GameEvent.WENXIN_RESULT, this.onWenxinResult, this);
        bus.on(GameEvent.ENEMY_KILLED, this.onEnemyKilled, this);
        bus.on('ENEMY_KILLED', this.onEnemyKilled, this);
        bus.on(GameEvent.GOLD_PICKED, this.onGoldPicked, this);
        bus.on('GOLD_PICKED', this.onGoldPicked, this);
        bus.on(GameEvent.WEAPON_ADDED, this.onWeaponChanged, this);
        bus.on(GameEvent.WEAPON_UPGRADED, this.onWeaponChanged, this);
        bus.on(GameEvent.WEAPON_EVOLVED, this.onWeaponChanged, this);
        bus.on(GameEvent.GAME_START, this.onGameStart, this);
    }

    private unsubscribe() {
        const bus = EventBus.getInstance();
        bus.off(GameEvent.SECOND_TICK, this.onSecondTick, this);
        bus.off(GameEvent.PLAYER_LEVEL_UP, this.onLevelUp, this);
        bus.off(GameEvent.XP_COLLECTED, this.onXpCollected, this);
        bus.off(GameEvent.PLAYER_XP, this.onPlayerXp, this);
        bus.off('PLAYER_XP', this.onPlayerXp, this);
        bus.off(GameEvent.WENXIN_RESULT, this.onWenxinResult, this);
        bus.off(GameEvent.ENEMY_KILLED, this.onEnemyKilled, this);
        bus.off('ENEMY_KILLED', this.onEnemyKilled, this);
        bus.off(GameEvent.GOLD_PICKED, this.onGoldPicked, this);
        bus.off('GOLD_PICKED', this.onGoldPicked, this);
        bus.off(GameEvent.WEAPON_ADDED, this.onWeaponChanged, this);
        bus.off(GameEvent.WEAPON_UPGRADED, this.onWeaponChanged, this);
        bus.off(GameEvent.WEAPON_EVOLVED, this.onWeaponChanged, this);
        bus.off(GameEvent.GAME_START, this.onGameStart, this);
    }

    // ============================================================
    // 事件回调
    // ============================================================

    private onSecondTick(payload: { elapsed: number }) {
        if (payload && payload.elapsed !== this.lastSecond) {
            this.lastSecond = payload.elapsed;
            if (this.timerLabel) this.timerLabel.string = formatMMSS(payload.elapsed);
        }
    }

    /** 升级：刷新等级 + 经验条 */
    private onLevelUp(payload: { level: number }) {
        const pd = this.getPlayerData();
        const level = payload && payload.level ? payload.level : (pd ? pd.level : 1);
        if (this.levelLabel) this.levelLabel.string = `Lv ${level}`;
        this.syncXp();
        this.refreshIcons(); // 升级可能带来新武器/被动
    }

    /** XPSystem 广播：经验入账 */
    private onXpCollected() {
        this.syncXp();
    }

    /** PlayerController 广播：经验入账（携带权威数值） */
    private onPlayerXp(payload: { gained: number; total: number; xpToNext: number }) {
        if (payload) {
            this.syncXp(payload.total, payload.xpToNext);
            if (this.levelLabel) this.levelLabel.string = `Lv ${this.getPlayerData()?.level ?? 1}`;
        } else {
            this.syncXp();
        }
    }

    /** 问心结算：刷新道心 + 连渡 */
    private onWenxinResult(result: WenxinResult) {
        const pd = this.getPlayerData();
        const courage = pd ? pd.bravery : 0;
        if (this.courageLabel) this.courageLabel.string = `道心 ${Math.max(0, Math.round(courage))}`;

        // 连渡：优先用事件负载（WenxinManager 广播完整结果），兜底查询管理器
        let streak = 0;
        if (result && result.consecutive !== undefined) {
            streak = result.consecutive;
        } else {
            const wm = WenxinManager.getInstance();
            if (wm) streak = wm.getStreak().wins;
        }
        if (this.streakLabel) this.streakLabel.string = `连渡 ${streak}`;
    }

    /** 击杀计数 */
    private onEnemyKilled() {
        this.kills++;
        if (this.killsLabel) this.killsLabel.string = `击杀 ${this.kills}`;
    }

    /** 灵石拾取：刷新金币 */
    private onGoldPicked() {
        if (this.goldLabel) this.goldLabel.string = `灵石 ${this.getPlayerGold()}`;
    }

    /** 武器获得/升级/进化：刷新图标栏 */
    private onWeaponChanged() {
        this.refreshIcons();
    }

    /** 新一局：重置全部显示 */
    private onGameStart() {
        this.kills = 0;
        this.lastSecond = -1;
        if (this.levelLabel) this.levelLabel.string = 'Lv 1';
        if (this.timerLabel) this.timerLabel.string = '00:00';
        if (this.goldLabel) this.goldLabel.string = '灵石 0';
        if (this.courageLabel) this.courageLabel.string = '道心 0';
        if (this.streakLabel) this.streakLabel.string = '连渡 0';
        if (this.killsLabel) this.killsLabel.string = '击杀 0';
        this.setXpProgress(0);
        this.refreshIcons();
    }

    // ============================================================
    // 数据同步
    // ============================================================

    /** 全量同步（start / 事件异常兜底时调用） */
    private syncAll() {
        const gm = GameManager.getInstance();
        const pd = this.getPlayerData();

        if (gm && this.timerLabel) this.timerLabel.string = formatMMSS(gm.elapsedTime);
        if (this.levelLabel) this.levelLabel.string = `Lv ${pd ? pd.level : 1}`;
        this.syncXp();
        if (this.courageLabel) this.courageLabel.string = `道心 ${pd ? Math.max(0, Math.round(pd.bravery)) : 0}`;
        const wm = WenxinManager.getInstance();
        if (this.streakLabel) this.streakLabel.string = `连渡 ${wm ? wm.getStreak().wins : 0}`;
        if (this.killsLabel) this.killsLabel.string = `击杀 ${this.kills}`;
        if (this.goldLabel) this.goldLabel.string = `灵石 ${this.getPlayerGold()}`;
        this.refreshIcons();
    }

    /** 经验条同步（xp/xpToNext 可覆盖，默认读 playerData） */
    private syncXp(xp?: number, xpToNext?: number) {
        const pd = this.getPlayerData();
        const cur = xp !== undefined ? xp : (pd ? pd.xp : 0);
        const need = xpToNext !== undefined && xpToNext > 0 ? xpToNext : (pd && pd.xpToNext > 0 ? pd.xpToNext : 1);
        this.setXpProgress(cur / need);
    }

    private setXpProgress(progress: number) {
        const bar = this.xpBar;
        if (!bar) return;
        const p = Math.max(0, Math.min(1, progress));
        bar.setScale(p, 1, 1);
    }

    private getPlayerData(): PlayerData | null {
        const gm = GameManager.getInstance();
        return gm ? gm.playerData : null;
    }

    /** 读取玩家当前灵石（PlayerController 持有运行时金币） */
    private getPlayerGold(): number {
        const player = find('Canvas/Player');
        if (!player) return 0;
        const ctrl = player.getComponent(PlayerController);
        return ctrl ? ctrl.getData().gold : 0;
    }

    // ============================================================
    // 图标栏刷新（武器最多 6 格 / 被动最多 4 格）
    // ============================================================

    private refreshIcons() {
        const pd = this.getPlayerData();
        const weapons = pd ? pd.weapons : [];
        const passives = pd ? pd.passives : [];

        for (let i = 0; i < MAX_WEAPON_SLOTS; i++) {
            const slot = this.weaponSlots[i];
            if (!slot) continue;
            if (i < weapons.length) {
                const w = weapons[i];
                // 超武判定：combat/WeaponData 中 evolutionId 为空串 = 最终形态（已进化）
                const cfg = WEAPON_CONFIGS[w.id];
                const isEvolved = !!cfg && cfg.evolutionId === '';
                const color = isEvolved ? COLOR_EVOLVED : (WEAPON_ICON_COLORS[w.id] ?? COLOR_UNKNOWN);
                this.paintSlot(slot, color, true, String(w.level));
            } else {
                this.paintSlot(slot, '#333333', false, '');
            }
        }

        for (let i = 0; i < MAX_PASSIVE_SLOTS; i++) {
            const slot = this.passiveSlots[i];
            if (!slot) continue;
            if (i < passives.length) {
                const p = passives[i];
                this.paintSlot(slot, PASSIVE_ICON_COLORS[p.id] ?? COLOR_UNKNOWN, true, String(p.level));
            } else {
                this.paintSlot(slot, '#333333', false, '');
            }
        }
    }

    private paintSlot(slot: SlotView, colorHex: string, active: boolean, levelText: string) {
        slot.root.active = active;
        if (!active) return;
        const g = slot.gfx;
        g.clear();
        g.fillColor = hexColor(colorHex);
        g.roundRect(-17, -17, 34, 34, 6);
        g.fill();
        slot.level.string = levelText;
    }

    // ============================================================
    // 暂停
    // ============================================================

    private togglePause() {
        const gm = GameManager.getInstance();
        if (!gm || gm.state === GameState.GAME_OVER) return; // 结算中不响应暂停
        if (gm.isPaused(PauseReason.SETTINGS)) {
            gm.requestResume(PauseReason.SETTINGS);
            if (this.pauseBtnLabel) this.pauseBtnLabel.string = '暂停';
            if (this.pauseOverlay) this.pauseOverlay.active = false;
        } else {
            gm.requestPause(PauseReason.SETTINGS);
            if (this.pauseBtnLabel) this.pauseBtnLabel.string = '继续';
            if (this.pauseOverlay) {
                this.pauseOverlay.active = true;
                // 置顶（盖住其它弹层/飘字）
                if (this.pauseOverlay.parent) {
                    this.pauseOverlay.setSiblingIndex(this.pauseOverlay.parent.children.length - 1);
                }
            }
        }
    }

    // ============================================================
    // UI 搭建（全部代码生成）
    // ============================================================

    private buildUI() {
        const size = view.getVisibleSize();
        const W = size.width;
        const H = size.height;

        // ── 顶部信息栏：等级 + 经验条 + 计时器 + 灵石 ──
        this.levelLabel = makeLabel(this.node, 'Lv 1', 26, '#FFD700', 90, 36);
        this.levelLabel.node.setPosition(-W / 2 + 60, H / 2 - 45, 0);

        // 经验条背景
        const barBg = new Node('XpBarBg');
        barBg.setParent(this.node);
        barBg.addComponent(UITransform).setContentSize(260, 18);
        const bgG = barBg.addComponent(Graphics);
        bgG.fillColor = hexColor('#101018', 230);
        bgG.roundRect(-130, -9, 260, 18, 8);
        bgG.fill();
        barBg.setPosition(-W / 2 + 225, H / 2 - 45, 0);

        // 经验条前景（锚点居左，scaleX 即进度）
        this.xpBar = makeBar(barBg, 254, 14, '#4CAF50', 6);
        this.xpBar.setPosition(-128, 0, 0);

        this.timerLabel = makeLabel(this.node, '00:00', 26, '#FFFFFF', 110, 36);
        this.timerLabel.node.setPosition(-W / 2 + 405, H / 2 - 45, 0);

        this.goldLabel = makeLabel(this.node, '灵石 0', 24, '#FFD54F', 140, 36);
        this.goldLabel.node.setPosition(-W / 2 + 545, H / 2 - 45, 0);

        // ── 右上角：暂停按钮 ──
        const pauseBtn = makeButton(this.node, 88, 64, '暂停', 24, '#3A3A3A', () => this.togglePause());
        pauseBtn.name = 'PauseButton';
        pauseBtn.setPosition(W / 2 - 100, H / 2 - 60, 0);
        this.pauseBtnLabel = pauseBtn.getComponentInChildren(Label);

        // ── 左上角：武器图标（最多 6 个，不同颜色方块） ──
        const WEAPON_ICON_Y = H / 2 - 130;
        for (let i = 0; i < MAX_WEAPON_SLOTS; i++) {
            const slot = this.createSlot(this.node, '#333333');
            slot.root.name = `WeaponSlot_${i}`;
            slot.root.setPosition(-W / 2 + 48 + i * 46, WEAPON_ICON_Y, 0);
            this.weaponSlots.push(slot);
        }

        // ── 武器图标下方：被动图标（最多 4 个） ──
        const PASSIVE_ICON_Y = H / 2 - 195;
        for (let i = 0; i < MAX_PASSIVE_SLOTS; i++) {
            const slot = this.createSlot(this.node, '#333333');
            slot.root.name = `PassiveSlot_${i}`;
            slot.root.setPosition(-W / 2 + 48 + i * 46, PASSIVE_ICON_Y, 0);
            this.passiveSlots.push(slot);
        }

        // ── 底部中央：道心 + 连渡 + 击杀 ──
        this.courageLabel = makeLabel(this.node, '道心 0', 24, '#FFD700', 260, 36);
        this.courageLabel.node.setPosition(0, -H / 2 + 70, 0);
        this.streakLabel = makeLabel(this.node, '连渡 0', 24, '#81C784', 260, 36);
        this.streakLabel.node.setPosition(0, -H / 2 + 28, 0);
        this.killsLabel = makeLabel(this.node, '击杀 0', 20, '#E0E0E0', 200, 30);
        this.killsLabel.node.setPosition(0, -H / 2 - 8, 0);

        // ── 暂停遮罩（默认隐藏） ──
        this.pauseOverlay = makePanel(this.node, W, H, new Color(0, 0, 0, 150), 0);
        this.pauseOverlay.name = 'PauseOverlay';
        makeLabel(this.pauseOverlay, '已暂停', 56, '#FFFFFF', 400, 80).node.setPosition(0, 60, 0);
        makeLabel(this.pauseOverlay, '点击右上角按钮继续', 22, '#9E9E9E', 400, 40).node.setPosition(0, -20, 0);
        this.pauseOverlay.active = false;
    }

    /** 创建一个图标槽位（方块 + 右下角等级文字） */
    private createSlot(parent: Node, colorHex: string): SlotView {
        const root = makePanel(parent, 34, 34, hexColor(colorHex), 6);
        const gfx = root.getComponent(Graphics)!;
        const level = makeLabel(root, '', 12, '#FFFFFF', 22, 18);
        level.node.setPosition(9, -9, 0);
        level.horizontalAlign = Label.HorizontalAlign.RIGHT;
        level.verticalAlign = Label.VerticalAlign.BOTTOM;
        return { root, gfx, level };
    }
}
