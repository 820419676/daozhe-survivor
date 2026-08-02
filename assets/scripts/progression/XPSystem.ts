// ============================================================
// XPSystem —— 经验系统（挂载方：PlayerController 或独立 Manager）
// ------------------------------------------------------------
// 经验公式：
//   实际经验 = 拾取量 × 修为回馈倍率（问心核心出口） × 贪婪系数
// 升级判定基于 player/PlayerData.xpToNext（getter，随等级自动增长），
// 曲线定义在 PlayerData.getXpForLevel（20 × 1.3^(lv-1)）。
//
// 事件（core/GameEvent 枚举）：
//   XP_COLLECTED     → { amount }（修为回馈/贪婪加成后的实际入账）
//   PLAYER_LEVEL_UP  → { level }（core/GameManager 收到后自动进入
//                      升级暂停并等待三选一）
//
// 接线：PlayerController.onLoad 创建本系统（new XPSystem(this.data)），
// 拾取经验统一走 PlayerController.collectXp → XPSystem.addXp。
//
// 注意：纯数据逻辑类（非 Component），由持有 PlayerData 的组件创建。
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { PlayerData } from '../player/PlayerData';
import { WenxinManager } from '../wenxin/WenxinManager';

export class XPSystem {
    private playerData: PlayerData;

    constructor(playerData: PlayerData) {
        this.playerData = playerData;
    }

    /**
     * 增加经验（PlayerController 拾取宝石时调用）
     * @param amount 宝石的基础经验值
     * @returns 实际入账经验（含问心倍率×贪婪加成，供 HUD 展示）
     */
    addXp(amount: number): number {
        // 修为回馈倍率（问心系统核心出口：功成后升级更快、build 更肥）
        const wm = WenxinManager.getInstance();
        const multiplier = wm ? wm.getCurrentMultiplier() : 1;
        // 贪婪（PlayerData.greed，灵石掉落倍率同源）
        const actual = amount * multiplier * this.playerData.greed;
        this.playerData.xp += actual;

        EventBus.getInstance().emit(GameEvent.XP_COLLECTED, { amount: actual });

        // 升级（可连续触发多级）
        while (this.playerData.xp >= this.playerData.xpToNext) {
            this.levelUp();
        }
        return actual;
    }

    /** 升级一级：扣经验 → 提等级 → 广播事件（框架自动进入升级暂停） */
    private levelUp(): void {
        this.playerData.xp -= this.playerData.xpToNext;
        this.playerData.level++;
        EventBus.getInstance().emit(GameEvent.PLAYER_LEVEL_UP, { level: this.playerData.level });
    }

    /** 升级所需经验曲线（代理到 PlayerData，避免双份实现） */
    getXpForLevel(lv: number): number {
        return this.playerData.getXpForLevel(lv);
    }

    /** 当前经验条进度（0~1，供 HUD 进度条使用） */
    getProgress(): number {
        if (this.playerData.xpToNext <= 0) return 1;
        return Math.min(1, this.playerData.xp / this.playerData.xpToNext);
    }
}
