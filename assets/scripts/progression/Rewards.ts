// ============================================================
// Rewards —— 奖励结算中心（灵脉 / 宝箱共用）
// ------------------------------------------------------------
// 灵脉三选一：大量经验灵珠 / 本局武器伤害 +15% / 御风步刷新 + 下次冲刺伤害翻倍
// 宝箱三选一：武器升级 / 被动升级 / 灵脉奖励翻倍
//
// 设计原则：奖励必须"明显高于普通刷怪"，且只能通过主动选择获得。
// 所有效果直接落到既有系统（PlayerData / WeaponSystem / DashAbility），
// 不新增平行属性体系。
// ============================================================

import { Vec3, find } from 'cc';
import { PlayerRegistry } from '../core/PlayerRegistry';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GAME_CONFIG } from '../core/GameConfig';
import { WeaponSystem } from '../combat/WeaponSystem';
import { PASSIVE_CONFIGS } from '../combat/PassiveData';
import { MAX_PASSIVE_LEVEL, MAX_WEAPON_LEVEL } from '../progression/EvolutionSystem';
import { DashAbility } from '../player/DashAbility';

/** 本局"灵脉奖励翻倍"倍率（宝箱选项；1 = 未翻倍，上限 ×4） */
let lingmaiMultiplier: number = 1;

/** 灵脉奖励三选一的选项 id */
export type LingmaiRewardId = 'lingmai_xp' | 'lingmai_damage' | 'lingmai_dash';
/** 宝箱三选一的选项 id */
export type ChestRewardId = 'chest_weapon' | 'chest_passive' | 'chest_lingmai_double';

export class Rewards {
    // ==================== 灵脉报告倍率 ====================

    /** 当前灵脉奖励倍率（DebugPanel / 选项文案用） */
    static getLingmaiMultiplier(): number {
        return lingmaiMultiplier;
    }

    /** 宝箱选项：本局灵脉奖励翻倍 */
    static doubleLingmaiRewards(): void {
        lingmaiMultiplier = Math.min(4, lingmaiMultiplier * 2);
    }

    /** 新一局重置 */
    static resetRun(): void {
        lingmaiMultiplier = 1;
    }

    // ==================== 灵脉奖励 ====================

    /** 灵脉三选一入口 */
    static applyLingmai(id: string, position: Vec3): void {
        switch (id) {
            case 'lingmai_xp': this.grantXpOrbs(position); break;
            case 'lingmai_damage': this.grantWeaponDamage(); break;
            case 'lingmai_dash': this.grantDashRefresh(); break;
            default: this.grantXpOrbs(position); break;
        }
    }

    /** 宝箱三选一入口 */
    static applyChest(id: string): void {
        switch (id) {
            case 'chest_weapon': this.grantWeaponUpgrade(); break;
            case 'chest_passive': this.grantPassiveUpgrade(); break;
            case 'chest_lingmai_double': this.doubleLingmaiRewards(); break;
            default: this.grantWeaponDamage(); break;
        }
    }

    // ==================== 具体效果 ====================

    /**
     * 大量经验灵珠：在法阵位置散落一批灵珠（每颗 2 点经验）。
     * 合计经验远高于同期普通刷怪，且需要玩家走过去吸引（磁吸范围 150）。
     */
    static grantXpOrbs(position: Vec3): void {
        const cfg = GAME_CONFIG.lingmai;
        const orbs = Math.round(cfg.xpOrbs * lingmaiMultiplier);
        for (let i = 0; i < orbs; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * 74;
            EventBus.emit(GameEvent.DROP_XP, {
                position: new Vec3(position.x + Math.cos(angle) * r, position.y + Math.sin(angle) * r, 0),
                amount: cfg.xpPerOrb,
            });
        }
    }

    /** 本局武器伤害提升（基础 +15%，灵脉奖励翻倍时按倍率叠加） */
    static grantWeaponDamage(): void {
        const pd = PlayerRegistry.getPlayer();
        if (!pd) return;
        const bonus = GAME_CONFIG.lingmai.damageBonus * lingmaiMultiplier;
        pd.might = Math.round(pd.might * (1 + bonus) * 1000) / 1000;
    }

    /** 御风步：立刻刷新冷却，且下一次冲刺伤害翻倍 */
    static grantDashRefresh(): void {
        const dash = DashAbility.getInstance();
        if (!dash) return;
        dash.refreshNow();
        dash.grantDoubleDamageNextDash();
    }

    /** 宝箱：武器升级（优先升级等级最高且未满级的武器） */
    static grantWeaponUpgrade(): boolean {
        const pd = PlayerRegistry.getPlayer();
        const player = find('Canvas/Player');
        const weapons = player ? player.getComponent(WeaponSystem) : null;
        if (!pd || !weapons || pd.weapons.length === 0) {
            this.grantWeaponDamage(); // 兜底：还没有武器时改为伤害提升
            return false;
        }
        let best: { id: string; level: number } | null = null;
        for (const w of pd.weapons) {
            if (w.level >= MAX_WEAPON_LEVEL) continue;
            if (!best || w.level > best.level) best = { id: w.id, level: w.level };
        }
        if (!best) {
            this.grantWeaponDamage(); // 全部满级
            return false;
        }
        weapons.upgradeWeapon(best.id, 1);
        return true;
    }

    /** 宝箱：被动升级（无可升级被动时改为获得一个新被动） */
    static grantPassiveUpgrade(): boolean {
        const pd = PlayerRegistry.getPlayer();
        if (!pd) return false;

        // 1) 优先升级已持有且未满级的被动
        let target: { id: string; level: number } | null = null;
        for (const p of pd.passives) {
            if (p.level >= MAX_PASSIVE_LEVEL) continue;
            if (!target || p.level < target.level) target = { id: p.id, level: p.level };
        }
        if (target) {
            pd.upgradePassive(target.id);
            return true;
        }

        // 2) 否则获得一个未持有的被动
        const owned = new Set(pd.passives.map((p) => p.id));
        const candidates = Object.keys(PASSIVE_CONFIGS).filter((id) => !owned.has(id));
        if (candidates.length > 0) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            pd.addPassive(pick);
            return true;
        }

        // 3) 全满兜底
        this.grantWeaponDamage();
        return false;
    }
}
