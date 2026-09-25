// ============================================================
// LevelUpUI —— 升级三选一界面（VS M5 暂停式决策脉冲）
// ------------------------------------------------------------
// 集成说明（依赖 core/GameManager 的暂停栈与事件流）：
//   - 弹出：监听 PLAYER_LEVEL_UP（GameManager 收到该事件会自动进入升级暂停），
//     本组件只负责展示，不重复 requestPause。
//   - 关闭：hide() 时弹出暂停栈中全部 LEVEL_UP 条目（应对连续升级），
//     恢复由 GameManager 完成。
//   - 玩家数据：通过 core/PlayerRegistry 获取（PlayerController.onLoad 自动绑定）。
//
// 选项池与权重（GDD 4.2.3）：
//   新武器（未持有 ×3 权重） / 已有武器升级（至 8 级）
//   被动升级（至 5 级） / 属性大礼包（Might/Speed/Area/Luck 四选一）
// 稀有度：普通 60% / 稀有 25% / 史诗 10% / 传说 5%（Luck 修正），
// 传说 = 双效果 + 金色演出。
// 选择 → 应用升级 → 检查进化（武器满级+被动已持 → 超武金光）。
// 洗牌（每级 1 次免费）/ 跳过（经验不返还）。
//
// 使用：挂在 Canvas 下任意节点即可。UI 全部由代码生成。
// ============================================================

import { _decorator, Component, Node, Label, Graphics, Color, UITransform, Button, view } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GameManager, GameState, PauseReason } from '../core/GameManager';
import { floatText, flashOverlay, hexColor, makeButton, makeLabel, makePanel, shakeNode } from '../core/UIUtils';
import { PlayerRegistry } from '../core/PlayerRegistry';
import { PlayerData } from '../player/PlayerData';
import { PASSIVE_CONFIGS } from '../combat/PassiveData';
import { WEAPON_CONFIGS } from '../combat/WeaponData';
import { EvolutionSystem, MAX_PASSIVE_LEVEL, MAX_WEAPON_LEVEL } from './EvolutionSystem';
import {
    BuildSystem, BuildTag, TAG_COLORS, TAG_NAMES, TALENTS,
} from './BuildSystem';
import { RewardPanel } from './RewardPanel';

const { ccclass } = _decorator;

/** 三选一卡牌数量 */
const OPTION_COUNT = 3;
/** 每级免费洗牌次数 */
const REROLL_COUNT_PER_LEVEL = 1;

/** 稀有度（升级选项演出分级：普通 60% / 稀有 25% / 史诗 10% / 传说 5%） */
enum Rarity {
    NORMAL = 0,
    RARE = 1,
    EPIC = 2,
    LEGEND = 3,
}

/** 属性大礼包类型 */
type StatKind = 'might' | 'speed' | 'area' | 'luck';

/** 单个升级选项 */
interface LevelUpOption {
    type: 'new_weapon' | 'weapon_up' | 'new_passive' | 'passive_up' | 'stat_pack';
    weaponId?: string;
    passiveId?: string;
    statKind?: StatKind;
    name: string;
    desc: string;
    rarity: Rarity;
    /** 流派标签（连续 3 次同标签 → 触发该流派天赋） */
    tag: BuildTag;
    evolutionHint?: string; // 进化提示（"就差一件！"近失效应，GDD 4.2.5）
}

interface WeightedOption {
    opt: LevelUpOption;
    weight: number;
}

/** 稀有度颜色 */
const RARITY_COLORS: Record<Rarity, string> = {
    [Rarity.NORMAL]: '#9E9E9E',
    [Rarity.RARE]: '#2196F3',
    [Rarity.EPIC]: '#9C27B0',
    [Rarity.LEGEND]: '#FFD700',
};
const RARITY_NAMES: Record<Rarity, string> = {
    [Rarity.NORMAL]: '',
    [Rarity.RARE]: '稀有',
    [Rarity.EPIC]: '史诗',
    [Rarity.LEGEND]: '传说',
};

/** 属性大礼包内容（GDD 4.2.3；PlayerData 属性为倍率制，起点 1） */
const STAT_PACKS: { kind: StatKind; name: string; desc: string; tag: BuildTag }[] = [
    { kind: 'might', name: '力量', desc: '伤害 +20%', tag: BuildTag.BURST },
    { kind: 'speed', name: '身法', desc: '移速 +15%', tag: BuildTag.SURVIVAL },
    { kind: 'area', name: '范围', desc: '攻击范围 +15%', tag: BuildTag.SUSTAIN },
    { kind: 'luck', name: '运气', desc: '幸运 +1', tag: BuildTag.SUSTAIN },
];

/** 前 N 次升级必须出现"新武器"（保证首局尽快形成构筑方向） */
const EARLY_GUARANTEE_LEVELS = 3;

@ccclass('LevelUpUI')
export class LevelUpUI extends Component {
    private root: Node | null = null;
    private cardNodes: Node[] = [];        // 三张选项卡
    private rerollButton: Node | null = null;
    private skipButton: Node | null = null;

    private currentOptions: LevelUpOption[] = [];
    private rerollCount = 0;
    private shown = false;
    /** 本局已完成的升级次数（前 3 次保证出现新武器；GAME_START 清零） */
    private levelUpCount = 0;
    /** 问心进行中时收到的升级（问心结束后补弹） */
    private pendingLevelUp = false;

    // ============================================================
    // 生命周期
    // ============================================================

    // —— 事件回调（框架 EventBus 不绑定 this，必须用箭头函数保持引用稳定） ——
    private handlePlayerLevelUp = () => { this.onPlayerLevelUp(); };
    private handleWenxinResult = () => { this.onWenxinResult(); };
    private handleGameStart = () => {
        this.levelUpCount = 0;
        BuildSystem.resetRun(); // 流派标签/天赋为本局作用域
    };

    onLoad() {
        const bus = EventBus.getInstance();
        bus.on(GameEvent.PLAYER_LEVEL_UP, this.handlePlayerLevelUp);
        bus.on(GameEvent.WENXIN_RESULT, this.handleWenxinResult);
        bus.on(GameEvent.GAME_START, this.handleGameStart);
        this.buildUI();
        this.node.active = false;
    }

    onDestroy() {
        const bus = EventBus.getInstance();
        bus.off(GameEvent.PLAYER_LEVEL_UP, this.handlePlayerLevelUp);
        bus.off(GameEvent.WENXIN_RESULT, this.handleWenxinResult);
        bus.off(GameEvent.GAME_START, this.handleGameStart);
    }

    /** 玩家升级：框架已自动进入升级暂停，这里负责弹面板 */
    private onPlayerLevelUp() {
        if (this.shown) return; // 连续升级：面板已开，忽略（hide 时统一恢复）
        if (this.pendingLevelUp) return;

        const gm = GameManager.getInstance();
        if (gm && gm.state === GameState.GAME_OVER) return;

        // 问心进行中：排队，等 WENXIN_RESULT 后再弹（演出错峰）
        if (gm && gm.getTopPauseReason() === PauseReason.WENXIN) {
            this.pendingLevelUp = true;
            return;
        }
        this.show();
    }

    /** 问心结束：补弹排队中的升级 */
    private onWenxinResult() {
        if (this.pendingLevelUp) {
            this.pendingLevelUp = false;
            this.show();
        }
    }

    // ============================================================
    // 弹出 / 关闭（暂停与恢复由 core/GameManager 统一管理）
    // ============================================================

    show() {
        if (this.shown) return;
        const pd = PlayerRegistry.getPlayer();
        if (!pd) return; // 玩家数据未绑定（PlayerController 未调用 PlayerRegistry.bind）

        this.shown = true;

        // 每级 1 次免费洗牌
        this.rerollCount = REROLL_COUNT_PER_LEVEL;

        this.generateAndRender();
        this.node.active = true;
    }

    hide() {
        if (!this.shown) return;
        this.shown = false;
        this.node.active = false;

        // 弹出暂停栈中全部 LEVEL_UP 条目（连续升级可能压了多条），
        // 栈空后框架自动恢复 PLAYING
        const gm = GameManager.getInstance();
        while (gm && gm.getTopPauseReason() === PauseReason.LEVEL_UP) {
            gm.requestResume(PauseReason.LEVEL_UP);
        }
    }

    // ============================================================
    // 选项生成（权重：新武器×3 / 已有升级×1 / 属性包兜底）
    // ============================================================

    private generateAndRender() {
        this.currentOptions = this.pickOptions();
        this.renderCards();

        if (this.rerollButton) {
            const label = this.rerollButton.getComponentInChildren(Label);
            if (label) label.string = this.rerollCount > 0 ? `洗牌（剩${this.rerollCount}次）` : '洗牌（已用完）';
        }
    }

    private pickOptions(): LevelUpOption[] {
        const pd = PlayerRegistry.getPlayer()!;
        const weighted: WeightedOption[] = [];

        // 1) 新武器：未持有 ×3 权重（防止重复卡池，GDD 4.2.3）
        //    基础武器 evolutionPair 非空；超武 evolutionPair === '' 不入卡池
        for (const id of Object.keys(WEAPON_CONFIGS)) {
            const cfg = WEAPON_CONFIGS[id];
            if (!cfg.evolutionPair) continue;
            if (!pd.hasWeapon(id)) {
                weighted.push({
                    opt: {
                        type: 'new_weapon', weaponId: id,
                        name: cfg.name, desc: cfg.description, rarity: Rarity.NORMAL,
                        tag: cfg.buildTag,
                    },
                    weight: 3,
                });
            }
        }

        // 2) 已有武器升级（未满级；附进化提示）
        for (const slot of pd.weapons) {
            const cfg = WEAPON_CONFIGS[slot.id];
            if (!cfg || !cfg.evolutionPair) continue; // 超武不参与升级
            if (slot.level >= MAX_WEAPON_LEVEL) continue;
            const opt: LevelUpOption = {
                type: 'weapon_up', weaponId: slot.id,
                name: `${cfg.name} Lv.${slot.level}`,
                desc: cfg.description,
                rarity: Rarity.NORMAL,
                tag: cfg.buildTag,
                evolutionHint: this.getEvolutionHint(cfg.id, slot.level, pd) ?? undefined,
            };
            weighted.push({ opt, weight: 1 });
        }

        // 3) 已有被动升级（未满级）
        for (const slot of pd.passives) {
            const cfg = PASSIVE_CONFIGS[slot.id];
            if (!cfg || slot.level >= MAX_PASSIVE_LEVEL) continue;
            weighted.push({
                opt: {
                    type: 'passive_up', passiveId: slot.id,
                    name: `${cfg.name} Lv.${slot.level}`,
                    desc: cfg.description, rarity: Rarity.NORMAL,
                    tag: cfg.buildTag,
                },
                weight: 1,
            });
        }

        // 3b) 新被动（未持有）——保证三选一始终包含"获得被动"类目（验收）
        for (const id of Object.keys(PASSIVE_CONFIGS)) {
            const cfg = PASSIVE_CONFIGS[id];
            if (pd.hasPassive(id)) continue;
            weighted.push({
                opt: {
                    type: 'new_passive', passiveId: id,
                    name: cfg.name, desc: cfg.description, rarity: Rarity.NORMAL,
                    tag: cfg.buildTag,
                },
                weight: 1.5,
            });
        }

        // 4) 属性大礼包（始终提供，保证卡池不为空）
        for (const pack of STAT_PACKS) {
            weighted.push({
                opt: {
                    type: 'stat_pack', statKind: pack.kind,
                    name: pack.name, desc: pack.desc, rarity: Rarity.NORMAL,
                    tag: pack.tag,
                },
                weight: 1.2,
            });
        }

        // 兜底：卡池为空时补满属性包
        if (weighted.length === 0) {
            for (const pack of STAT_PACKS) {
                weighted.push({
                    opt: {
                        type: 'stat_pack', statKind: pack.kind,
                        name: pack.name, desc: pack.desc, rarity: Rarity.NORMAL,
                        tag: pack.tag,
                    },
                    weight: 1,
                });
            }
        }

        // 按权重抽 3 个不重复的选项
        const picked: LevelUpOption[] = [];
        const pool = weighted.slice();

        // 前 3 次升级：必定出现一个"新武器"（形成构筑方向的硬保障）
        if (this.levelUpCount < EARLY_GUARANTEE_LEVELS) {
            const idx = pool.findIndex((w) => w.opt.type === 'new_weapon');
            if (idx >= 0) {
                const chosen = pool.splice(idx, 1)[0];
                chosen.opt.rarity = this.rollRarity();
                picked.push(chosen.opt);
            }
        }

        while (picked.length < OPTION_COUNT && pool.length > 0) {
            let total = 0;
            for (const w of pool) total += w.weight;
            let r = Math.random() * total;
            let idx = pool.length - 1;
            for (let i = 0; i < pool.length; i++) {
                r -= pool[i].weight;
                if (r <= 0) { idx = i; break; }
            }
            const chosen = pool.splice(idx, 1)[0];
            // 稀有度掷定（Luck 修正：每点幸运约 +0.5% 概率上移）
            chosen.opt.rarity = this.rollRarity();
            picked.push(chosen.opt);
        }
        return picked;
    }

    /** 稀有度掷定：普通 60% / 稀有 25% / 史诗 10% / 传说 5%（Luck 修正） */
    private rollRarity(): Rarity {
        const pd = PlayerRegistry.getPlayer();
        const luck = pd ? pd.luck : 1;
        const r = Math.random() + (luck - 1) * 0.005;
        if (r >= 0.95) return Rarity.LEGEND;
        if (r >= 0.85) return Rarity.EPIC;
        if (r >= 0.60) return Rarity.RARE;
        return Rarity.NORMAL;
    }

    /** 进化提示（"就差一件！"近失效应，GDD 4.2.5） */
    private getEvolutionHint(weaponId: string, slotLevel: number, pd: PlayerData): string | null {
        const cfg = WEAPON_CONFIGS[weaponId];
        if (!cfg || !cfg.evolutionPair) return null;
        const passiveCfg = PASSIVE_CONFIGS[cfg.evolutionPair];
        if (!passiveCfg) return null;

        const passiveHeld = pd.hasPassive(cfg.evolutionPair);
        if (slotLevel + 1 >= MAX_WEAPON_LEVEL && passiveHeld) {
            return '满级·可进化！';
        }
        if (slotLevel + 1 >= MAX_WEAPON_LEVEL) {
            return `就差被动「${passiveCfg.name}」！`;
        }
        return null;
    }

    // ============================================================
    // 渲染三张卡
    // ============================================================

    private renderCards() {
        this.currentOptions.forEach((opt, i) => {
            const card = this.cardNodes[i];
            if (!card) return;

            // 底色按稀有度微染
            const g = card.getComponent(Graphics);
            if (g) {
                g.fillColor = hexColor(RARITY_COLORS[opt.rarity], 40);
                g.fill();
            }

            const nameLabel = card.getChildByName('Name')?.getComponent(Label);
            if (nameLabel) {
                const rarityTag = RARITY_NAMES[opt.rarity];
                nameLabel.string = rarityTag ? `【${rarityTag}】${opt.name}` : opt.name;
                nameLabel.color = hexColor(RARITY_COLORS[opt.rarity]);
            }

            // 流派标签（颜色区分：爆发橙 / 持续蓝 / 生存绿）
            const tagLabel = card.getChildByName('Tag')?.getComponent(Label);
            if (tagLabel) {
                tagLabel.string = TAG_NAMES[opt.tag];
                tagLabel.color = hexColor(TAG_COLORS[opt.tag]);
            }

            const descLabel = card.getChildByName('Desc')?.getComponent(Label);
            if (descLabel) {
                descLabel.string = opt.desc;
            }

            // 提示行：优先显示"可形成流派"（本次选择会凑满 3 连标签）
            const willFormTalent = BuildSystem.wouldCompleteTalent(opt.tag);
            const hintText = willFormTalent ? '可形成流派' : (opt.evolutionHint ?? '');
            const hintLabel = card.getChildByName('Hint')?.getComponent(Label);
            if (hintLabel) {
                hintLabel.string = hintText;
                hintLabel.node.active = hintText.length > 0;
                hintLabel.color = hexColor(willFormTalent ? '#FFD700' : '#FFB74D');
            }
        });
    }

    // ============================================================
    // 交互
    // ============================================================

    onSelect(index: number) {
        const opt = this.currentOptions[index];
        if (!opt || !this.shown) return;
        this.applyOption(opt);
        // 记录流派标签：连续 3 次同标签 → 触发该流派的流派天赋
        BuildSystem.recordPick(opt.tag);
        this.levelUpCount++;
        this.hide();
        // 面板关闭（恢复游戏）后再弹天赋，避免两个弹层叠加
        this.scheduleOnce(() => this.tryTriggerTalent(), 0);
    }

    /**
     * 连续 3 次选择同一标签 → 弹出该流派的"流派天赋"选择。
     * 复用通用三选一面板（RewardPanel），天赋必须改变玩法表现（见 BuildSystem.TALENTS）。
     */
    private tryTriggerTalent(): void {
        const candidates = BuildSystem.consumeTalentTrigger();
        if (candidates.length === 0) return;

        const options = candidates.map((t) => ({ id: t.id, name: t.name, desc: t.desc }));
        const tagName = TAG_NAMES[candidates[0].tag];
        const opened = RewardPanel.open(
            '流派天赋',
            `「${tagName}」流派成型 · 选择一项天赋`,
            options,
            (id) => this.grantTalent(id),
        );
        if (!opened) this.grantTalent(options[0].id); // 面板占线时不丢天赋
    }

    /** 授予流派天赋并广播（Banner 显示"流派天赋：X"） */
    private grantTalent(id: string): void {
        BuildSystem.grantTalent(id);
        const def = TALENTS[id];
        if (def) EventBus.getInstance().emit(GameEvent.TALENT_GAINED, { talentId: id, name: def.name });
    }

    /** 洗牌：消耗一次洗牌次数重新生成 */
    onReroll() {
        if (!this.shown) return;
        if (this.rerollCount <= 0) return;
        this.rerollCount--;
        this.generateAndRender();
    }

    /** 跳过：不选，XP 不返还 */
    onSkip() {
        if (!this.shown) return;
        this.hide();
    }

    // ============================================================
    // 应用升级
    // ============================================================

    private applyOption(opt: LevelUpOption) {
        const pd = PlayerRegistry.getPlayer();
        if (!pd) return;

        switch (opt.type) {
            case 'new_weapon': {
                // 使用 PlayerData 封装（含槽位上限判定）
                pd.addWeapon(opt.weaponId!);
                break;
            }
            case 'weapon_up': {
                const nextLevel = pd.upgradeWeapon(opt.weaponId!);
                if (nextLevel < 0) break;

                // 进化判定：武器满级 + 已持对应被动 → 自动进化超武
                const evoId = EvolutionSystem.checkEvolution(opt.weaponId!, pd);
                if (evoId) {
                    const evolved = EvolutionSystem.evolve(opt.weaponId!, pd);
                    if (evolved) {
                        // 进化是局内最高级的"揭晓"：全屏金光
                        this.playEvolutionCelebration(evolved.name);
                    }
                }
                break;
            }
            case 'passive_up': {
                pd.upgradePassive(opt.passiveId!);
                break;
            }
            case 'new_passive': {
                pd.addPassive(opt.passiveId!);
                break;
            }
            case 'stat_pack': {
                // 传说 = 双效果（GDD 4.2.3）
                const times = opt.rarity === Rarity.LEGEND ? 2 : 1;
                for (let i = 0; i < times; i++) {
                    this.applyStat(opt.statKind!);
                }
                break;
            }
        }
    }

    private applyStat(kind: StatKind) {
        const pd = PlayerRegistry.getPlayer();
        if (!pd) return;
        switch (kind) {
            case 'might': pd.might = Math.round(pd.might * 1.2 * 100) / 100; break;
            case 'speed': pd.speed = Math.round(pd.speed * 1.15 * 100) / 100; break;
            case 'area': pd.area = Math.round(pd.area * 1.15 * 100) / 100; break;
            case 'luck': pd.luck += 1; break;
        }
    }

    /** 超武进化庆祝演出（全屏金光 + 飘字 + 震动） */
    private playEvolutionCelebration(evolvedName: string) {
        flashOverlay(this.node, '#FFD700', 120, 1.0);
        floatText(this.node, `超武进化！${evolvedName}`, '#FFD700', 36);
        shakeNode(this.node, 12);
    }

    // ============================================================
    // UI 搭建（全部代码生成）
    // ============================================================

    private buildUI() {
        const size = view.getVisibleSize();
        const W = size.width;
        const H = size.height;

        // —— 全屏遮罩 + 标题 ——
        this.root = makePanel(this.node, W, H, new Color(0, 0, 0, 140), 0);
        this.root.name = 'LevelUpRoot';

        const title = makeLabel(this.root, '升级！', 44, '#FFD700', 300, 70);
        title.node.setPosition(0, H * 0.36, 0);

        // —— 三张选项卡 ——
        this.cardNodes = [];
        const CARD_W = 560;
        const CARD_H = 150;
        const cardY = [H * 0.17, H * 0.01, -H * 0.15];
        for (let i = 0; i < OPTION_COUNT; i++) {
            const card = makePanel(this.root, CARD_W, CARD_H, hexColor('#3A3A3A', 220), 14);
            card.name = `Card_${i}`;
            card.setPosition(0, cardY[i], 0);

            const nameLabel = makeLabel(card, '', 28, '#FFFFFF', CARD_W - 40, 40);
            nameLabel.node.name = 'Name';
            nameLabel.node.setPosition(0, 44, 0);

            // 流派标签（右上角，颜色区分）
            const tagLabel = makeLabel(card, '', 20, '#F97316', 100, 30);
            tagLabel.node.name = 'Tag';
            tagLabel.node.setPosition(CARD_W / 2 - 62, 44, 0);

            const descLabel = makeLabel(card, '', 20, '#E0E0E0', CARD_W - 60, 40);
            descLabel.node.name = 'Desc';
            descLabel.node.setPosition(0, 2, 0);

            const hintLabel = makeLabel(card, '', 18, '#FFD700', CARD_W - 40, 32);
            hintLabel.node.name = 'Hint';
            hintLabel.node.setPosition(0, -48, 0);

            // 点击选择
            const btn = card.addComponent(Button);
            btn.transition = Button.Transition.SCALE;
            btn.zoomScale = 0.95;
            card.on(Button.EventType.CLICK, () => this.onSelect(i));

            this.cardNodes.push(card);
        }

        // —— 洗牌 / 跳过 ——
        this.rerollButton = makeButton(this.root, 260, 70, `洗牌（剩${REROLL_COUNT_PER_LEVEL}次）`, 22,
            '#2C2C2C', () => this.onReroll());
        this.rerollButton.name = 'RerollButton';
        this.rerollButton.setPosition(-160, -H * 0.32, 0);

        this.skipButton = makeButton(this.root, 260, 70, '跳过（经验不返还）', 22,
            '#2C2C2C', () => this.onSkip(), '#9E9E9E');
        this.skipButton.name = 'SkipButton';
        this.skipButton.setPosition(160, -H * 0.32, 0);
    }
}
