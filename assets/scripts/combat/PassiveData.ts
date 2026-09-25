/**
 * PassiveData.ts — 被动技能数据表（《问道幸存者》MVP）
 *
 * 4 个被动。被动通过升级系统获得（PlayerData.addPassive），
 * 效果逐级叠加；同时武器进化依赖「持有对应被动」判定（WeaponSystem.checkEvolution）。
 *
 * 数值约定：
 *  - cooldown 为乘算缩减（每级 ×(1 - valuePerLevel)）
 *  - maxHp 为加算生命
 *  - 其余多数为加算系数（作用于 PlayerData 对应倍率字段）
 *  - buildTag 流派标签（升级三选一按标签累计流派）
 */

import { BuildTag } from '../progression/BuildSystem';

/** 被动可影响的属性类型（与 PlayerData.applyPassiveEffect 一一对应） */
export type PassiveStat = 'might' | 'area' | 'speed' | 'duration' | 'cooldown' | 'luck' | 'greed' | 'maxHp';

export interface PassiveEffect {
    stat: PassiveStat;
    valuePerLevel: number;
}

export interface PassiveConfig {
    id: string;
    name: string;
    description: string;
    icon: string;
    // 每级加成
    effects: PassiveEffect[];
    /** 流派标签 */
    buildTag: BuildTag;
}

export const PASSIVE_CONFIGS: Record<string, PassiveConfig> = {
    /** 道法自然 — 冷却缩减（太极剑阵 / 飞剑术 的进化被动） */
    'taoist_nature': {
        id: 'taoist_nature', name: '道法自然', description: '功法运转更加圆融',
        icon: 'passive_cooldown',
        effects: [{ stat: 'cooldown', valuePerLevel: 0.08 }], // 每级-8%冷却
        buildTag: BuildTag.BURST,
    },
    /** 灵气护体 — 生命与范围（烈焰环 的进化被动） */
    'spirit_guard': {
        id: 'spirit_guard', name: '灵气护体', description: '灵气凝聚为护盾',
        icon: 'passive_defense',
        effects: [{ stat: 'maxHp', valuePerLevel: 30 }, { stat: 'area', valuePerLevel: 0.05 }],
        buildTag: BuildTag.SURVIVAL,
    },
    /** 天机推演 — 幸运与贪婪（雷霆符 / 万剑诀 的进化被动） */
    'heavenly_secret': {
        id: 'heavenly_secret', name: '天机推演', description: '窥见天机，洞察先机',
        icon: 'passive_luck',
        effects: [{ stat: 'luck', valuePerLevel: 0.15 }, { stat: 'greed', valuePerLevel: 0.1 }],
        buildTag: BuildTag.SUSTAIN,
    },
    /** 仙骨丹 — 弹速与持续（寒冰掌 的进化被动） */
    'spirit_bone': {
        id: 'spirit_bone', name: '仙骨丹', description: '脱胎换骨，身轻如燕',
        icon: 'passive_speed',
        effects: [{ stat: 'speed', valuePerLevel: 0.1 }, { stat: 'duration', valuePerLevel: 0.1 }],
        buildTag: BuildTag.SUSTAIN,
    },
};

/** 按 id 获取被动配置（不存在返回 undefined） */
export function getPassiveConfig(id: string): PassiveConfig | undefined {
    return PASSIVE_CONFIGS[id];
}
