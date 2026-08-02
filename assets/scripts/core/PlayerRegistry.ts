// ============================================================
// PlayerRegistry —— 玩家数据全局注册表（轻量单例）
// ------------------------------------------------------------
// 背景：core/GameManager 不持有 PlayerData，玩家数据由
// PlayerController 等战斗侧组件创建。问心/升级系统需要读写
// 玩家数据（道心、倍率、武器、被动），因此由创建方在开局时
// 注册一次：
//     PlayerRegistry.bind(playerData);
// 本局结束（GAME_OVER）或新一局（GAME_START）时建议重新 bind。
// ============================================================

import { PlayerData } from '../player/PlayerData';

export class PlayerRegistry {
    private static player: PlayerData | null = null;

    /** 绑定当前局的玩家数据（开局时由 PlayerController 调用） */
    static bind(player: PlayerData): void {
        PlayerRegistry.player = player;
    }

    /** 获取当前局玩家数据（未绑定时返回 null） */
    static getPlayer(): PlayerData | null {
        return PlayerRegistry.player;
    }

    /** 解绑（结算/切场景时调用） */
    static clear(): void {
        PlayerRegistry.player = null;
    }
}
