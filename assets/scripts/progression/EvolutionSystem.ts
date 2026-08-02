// ============================================================
// EvolutionSystem —— 武器进化配方系统（GDD 4.2.5 表 4-2）
// ------------------------------------------------------------
// 规则（与 combat/WeaponData 头注释一致）：武器升满级（8 级）且
// 持有对应被动（evolutionPair）→ 自动进化超武（机制级质变）。
// 判定条件：
//   - 武器满级：MAX_WEAPON_LEVEL = 8
//   - 持有对应被动：PlayerData.hasPassive(evolutionPair)
// 超武配置 evolutionPair === ''，天然不会再次进化。
//
// 使用：LevelUpUI 在"武器升级"选项生效后调用 checkEvolution，
// 满足条件时调用 evolve —— 进化瞬间全屏金光（配方发现是局内
// 最高级的"揭晓"，GDD 4.2.5）。
// ============================================================

import { WEAPON_CONFIGS, WeaponConfig } from '../combat/WeaponData';
import { PlayerData } from '../player/PlayerData';

/** 武器满级（GDD 4.2.5：武器升满 8 级；combat/WeaponData 亦以此为准） */
export const MAX_WEAPON_LEVEL = 8;
/** 被动满级（GDD 4.2.5：被动满 5 级；被动表未设上限字段，统一在此定义） */
export const MAX_PASSIVE_LEVEL = 5;

export class EvolutionSystem {
    /**
     * 检查指定武器是否可以进化，返回进化后的超武 id（不可进化返回 null）。
     */
    static checkEvolution(weaponId: string, playerData: PlayerData): string | null {
        const weapon = WEAPON_CONFIGS[weaponId];
        if (!weapon || !weapon.evolutionPair) return null;

        // 武器满级
        const weaponSlot = playerData.weapons.find(w => w.id === weaponId);
        if (!weaponSlot || weaponSlot.level < MAX_WEAPON_LEVEL) return null;

        // 已持有对应被动
        if (!playerData.hasPassive(weapon.evolutionPair)) return null;

        return weapon.evolutionId;
    }

    /**
     * 执行进化：武器槽位替换为超武（等级保留）。
     * @returns 进化后的超武配置（不满足条件返回 null）
     */
    static evolve(weaponId: string, playerData: PlayerData): WeaponConfig | null {
        const evoId = EvolutionSystem.checkEvolution(weaponId, playerData);
        if (!evoId) return null;

        const evolvedCfg = WEAPON_CONFIGS[evoId];
        if (!evolvedCfg) return null;

        const slot = playerData.weapons.find(w => w.id === weaponId);
        if (!slot) return null;

        // 槽位替换为超武（超武 id 即最终形态，不会再进化）
        slot.id = evoId;
        return evolvedCfg;
    }
}
