/**
 * DamageSystem.ts — 伤害计算与结算工具（纯静态，无状态）
 *
 * 《问道幸存者》战斗伤害的唯一出口：
 *   - roll       ：战斗管线主入口（WeaponSystem 每次开火调用），
 *                  baseDamage × 等级成长(每级+20%) × 力量倍率(might) → 暴击 ×2 → 取整（至少 1）
 *   - calculate  ：一次性取数接口（无等级成长、含 ±10% 浮动；数值预览/工具类使用）
 *   - applyDamage：对敌人结算伤害 + 击退 + 广播 COMBAT_DAMAGE 事件（飘字/HUD/统计监听）
 *
 * 结算链路：
 *   applyDamage → Enemy.takeDamage(amount, knockDir)（扣血/受击闪白/击退/死亡掉落）
 *              → core/EventBus 广播 COMBAT_DAMAGE（ui/DamageNumber 飘字、HUD 订阅）
 *
 * 依赖契约：
 *   - PlayerData ：player/PlayerData（might 力量倍率 / critChance 暴击率 getter）
 *   - WeaponConfig：combat/WeaponData（baseDamage 基础伤害）
 *   - Enemy      ：enemy/Enemy（takeDamage(amount, knockDir?)，
 *                  knockDir 为携带力度系数的方向向量，Enemy 内部按
 *                  260 × (1 - 击退抗性) 应用力度）
 *   - EventBus   ：core/EventBus + core/GameEvent（COMBAT_DAMAGE，负载与 DamageNumber 对齐）
 */
import { Vec3, find } from 'cc';
import { PlayerData } from '../player/PlayerData';
import { WeaponConfig } from './WeaponData';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { Enemy } from '../enemy/Enemy';

/** 单次伤害结算结果（roll / calculate 统一返回形状） */
export interface DamageResult {
    amount: number;  // 最终伤害（已含等级成长/力量倍率/暴击/浮动，取整且至少 1）
    isCrit: boolean; // 是否暴击（飘字/演出用）
}

export class DamageSystem {
    /** 每级伤害成长系数（武器升级 +20%/级） */
    public static readonly LEVEL_GROWTH = 0.2;
    /** 暴击伤害倍率（规格：暴击 2 倍） */
    public static readonly CRIT_MULTIPLIER = 2;

    /**
     * 伤害结算（战斗管线主入口，WeaponSystem 各武器开火时调用）：
     *   baseDamage × (1 + 0.2 × (等级-1)) × 力量倍率 → 暴击判定（×2）→ 取整（至少 1）
     *
     * @param playerData 玩家数据（might / critChance）
     * @param weaponCfg  武器配置（baseDamage）
     * @param level      武器当前等级（每级 +20% 伤害成长）
     */
    static roll(playerData: PlayerData, weaponCfg: WeaponConfig, level: number = 1): DamageResult {
        let damage =
            weaponCfg.baseDamage *
            (1 + (level - 1) * DamageSystem.LEVEL_GROWTH) *
            playerData.might;
        const isCrit = Math.random() < playerData.critChance;
        if (isCrit) {
            damage *= DamageSystem.CRIT_MULTIPLIER;
        }
        return { amount: Math.max(1, Math.round(damage)), isCrit };
    }

    /**
     * 计算单次伤害（一次取数接口，无等级成长）：
     *   基础伤害 × 力量倍率(might) → 暴击判定（critChance，暴击 ×2）→ 随机浮动 ±10% → 取整（至少 1）
     *
     * @param playerData 玩家数据（might / critChance）
     * @param weaponCfg  武器配置（baseDamage）
     */
    static calculate(playerData: PlayerData, weaponCfg: WeaponConfig): DamageResult {
        let damage = weaponCfg.baseDamage * playerData.might;
        let isCrit = false;

        // 暴击判定（暴击伤害 2 倍）
        if (Math.random() < playerData.critChance) {
            damage *= DamageSystem.CRIT_MULTIPLIER;
            isCrit = true;
        }

        // 随机浮动 ±10%
        damage *= 0.9 + Math.random() * 0.2;

        return { amount: Math.max(1, Math.round(damage)), isCrit };
    }

    /**
     * 对敌人结算伤害并广播 COMBAT_DAMAGE 事件。
     *
     * @param enemy               目标敌人
     * @param amount              伤害数值（由 roll/calculate 得出）
     * @param isCrit              是否暴击
     * @param knockDirOrKnockback 击退参数，两种调用约定（见下）：
     *   - Vec3   ：完整击退方向向量（方向 × 力度系数，弹幕命中时由弹幕指向敌人传入）
     *   - number ：击退力度系数（0 = 不击退；自动取「玩家指向敌人的方向 × 系数」，
     *              供按玩家位置结算的范围伤害/武器直接调用）
     */
    static applyDamage(enemy: Enemy, amount: number, isCrit: boolean, knockDirOrKnockback: Vec3 | number = 0): void {
        if (!enemy || !enemy.isValid || amount <= 0) return;

        // 击退方向解析
        let knockDir: Vec3 | undefined;
        if (knockDirOrKnockback instanceof Vec3) {
            // 调用方已算好方向（长度 = 力度系数）
            knockDir = knockDirOrKnockback;
        } else if (knockDirOrKnockback > 0) {
            // 数值系数：由玩家指向敌人（远离玩家），长度 = 力度系数
            const player = find('Canvas/Player'); // 玩家节点命名约定（PlayerController.onLoad 保证）
            if (player && player.isValid) {
                const dir = Vec3.subtract(new Vec3(), enemy.node.worldPosition, player.worldPosition);
                if (dir.lengthSqr() > 1) {
                    knockDir = dir.normalize().multiplyScalar(knockDirOrKnockback);
                }
            }
        }

        // 扣血 + 受击闪白 + 击退 + （死亡时掉落/回收），由 Enemy 内部处理。
        // Enemy.takeDamage 返回实际结算值（含"眩晕中双倍伤害"等修正）
        const applied = enemy.takeDamage(amount, knockDir);
        if (applied <= 0) return; // 目标已死/已回收：不产生飘字

        // 广播伤害事件（位置取世界坐标副本；负载形状与 ui/DamageNumber 对齐）
        const pos = enemy.node.worldPosition;
        EventBus.getInstance().emit(GameEvent.COMBAT_DAMAGE, {
            target: enemy.getType() ?? 'unknown',
            damage: applied,
            isCrit: isCrit,
            position: { x: pos.x, y: pos.y },
        });
    }
}
