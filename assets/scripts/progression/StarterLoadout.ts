// ============================================================
// StarterLoadout —— 开局武器选择
// ------------------------------------------------------------
// 每局开始（含"再来一局"）弹出六把基础武器的选择面板：
// 玩家在起点就决定流派方向（爆发 / 持续），而不是被动接受默认剑阵。
//
// 为什么要单独一个组件：
//   - 初始武器原本写死在 GameEntry.addStarterWeapon()，重开时会产生
//     "复活但没武器"的死局；这里作为唯一入口，首局与新一局统一处理。
//   - 面板占线或玩家跳过时直接补发兜底武器，绝不出现开局裸奔。
//
// 事件：GAME_START（触发选择）→ WEAPON_ADDED（HUD 武器栏刷新）
// ============================================================

import { _decorator, Component, find } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvent';
import { GameManager } from '../core/GameManager';
import { PlayerRegistry } from '../core/PlayerRegistry';
import { WeaponSystem } from '../combat/WeaponSystem';
import { WEAPON_CONFIGS } from '../combat/WeaponData';
import { TAG_COLORS, TAG_NAMES } from './BuildSystem';
import { RewardPanel } from './RewardPanel';
import { Banner } from '../ui/Banner';

const { ccclass } = _decorator;

/** 可选初始武器（六把基础武器）+ 一句话特点，帮助玩家做流派取舍 */
const STARTER_WEAPONS: { id: string; hint: string }[] = [
    { id: 'sword_array', hint: '飞剑环绕周身，贴身清怪最稳（新手友好）' },
    { id: 'flying_sword', hint: '直线贯穿飞剑，远程点名成排敌人' },
    { id: 'thunder_talisman', hint: '随机天雷落点爆发，对精英收益高' },
    { id: 'ice_palm', hint: '前方扇形冰霜，需要走位对准方向' },
    { id: 'flame_ring', hint: '周期性火焰光环，贴身持续灼烧' },
    { id: 'sword_storm', hint: '大范围剑雨，冷却较长但覆盖面广' },
];

/** 面板不可用时的兜底初始武器 */
const DEFAULT_STARTER = 'sword_array';

@ccclass('StarterLoadout')
export class StarterLoadout extends Component {
    onLoad(): void {
        EventBus.getInstance().on(GameEvent.GAME_START, this.onGameStart);
    }

    onDestroy(): void {
        EventBus.getInstance().off(GameEvent.GAME_START, this.onGameStart);
    }

    private onGameStart = (): void => {
        // 延后一帧：确保各系统的 GAME_START 复位（含清空武器槽）已经执行完
        this.scheduleOnce(() => this.presentChoice(), 0);
    };

    /** 弹出六选一面板；面板占线时直接发放默认武器（绝不出现"开局没有武器"） */
    private presentChoice(): void {
        const pd = PlayerRegistry.getPlayer();
        if (pd && pd.weapons.length > 0) return; // 异常情况：已有武器，不打断战斗

        const options = STARTER_WEAPONS.map((entry) => {
            const cfg = WEAPON_CONFIGS[entry.id];
            const tagName = cfg ? TAG_NAMES[cfg.buildTag] : '';
            return {
                id: entry.id,
                name: `${cfg ? cfg.name : entry.id}〔${tagName}〕`,
                desc: entry.hint,
            };
        });

        const opened = RewardPanel.open(
            '选择初始武器',
            '本局起点 · 决定你的流派方向（爆发 / 持续）',
            options,
            (id) => this.grant(id),
        );
        if (!opened) this.grant(DEFAULT_STARTER);
    }

    /**
     * 授予初始武器（也可被外部直接调用，便于测试）。
     * @returns 是否成功授予
     */
    public grant(weaponId: string): boolean {
        const gm = GameManager.getInstance();
        const player = (gm ? gm.getPlayer() : null) ?? find('Canvas/Player');
        const weapons = player ? player.getComponent(WeaponSystem) : null;
        if (!weapons) return false;

        weapons.addWeapon(weaponId);
        const cfg = WEAPON_CONFIGS[weaponId];
        if (cfg) {
            Banner.show(`初始武器：${cfg.name} · ${TAG_NAMES[cfg.buildTag]}`, TAG_COLORS[cfg.buildTag], 1.8);
        }
        return true;
    }
}
