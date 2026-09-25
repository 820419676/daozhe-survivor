// ============================================================
// BuildSystem —— 流派（构筑方向）与流派天赋
// ------------------------------------------------------------
// 三标签：爆发（高伤害/低频率/暴击）· 持续（范围/攻速/持续伤害）· 生存（护盾/移速/御风步）
// 规则：
//   - 每个升级选项都带标签，玩家连续 3 次选择同一标签 → 触发该标签的"流派天赋"
//   - 天赋改变玩法表现而非只加数值（见 TALENTS 表）
//   - 标签与天赋状态均为"本局"作用域，GAME_START 时由 resetRun() 复位
//
// 本模块保持零依赖（只被其它系统读取），避免循环引用。
// ============================================================

/** 流派标签 */
export enum BuildTag {
    /** 爆发：高伤害、低频率、暴击 */
    BURST = 'burst',
    /** 持续：范围、攻速、持续伤害 */
    SUSTAIN = 'sustain',
    /** 生存：护盾、移速、拾取范围、御风步强化 */
    SURVIVAL = 'survival',
}

/** 标签中文名 */
export const TAG_NAMES: Record<BuildTag, string> = {
    [BuildTag.BURST]: '爆发',
    [BuildTag.SUSTAIN]: '持续',
    [BuildTag.SURVIVAL]: '生存',
};

/** 标签主题色（升级卡与 DebugPanel 共用） */
export const TAG_COLORS: Record<BuildTag, string> = {
    [BuildTag.BURST]: '#F97316',
    [BuildTag.SUSTAIN]: '#38BDF8',
    [BuildTag.SURVIVAL]: '#4ADE80',
};

/** 连续选择同一标签该次数 → 触发流派天赋 */
export const TALENT_STREAK = 3;

/** 流派天赋定义 */
export interface TalentDef {
    id: string;
    tag: BuildTag;
    name: string;
    /** 一句话效果（升级/天赋面板展示） */
    desc: string;
}

/** 首批天赋（规格表 5-1；必须改变玩法表现，而非只加数值） */
export const TALENTS: Record<string, TalentDef> = {
    sword_pierce: {
        id: 'sword_pierce',
        tag: BuildTag.BURST,
        name: '剑意贯虹',
        desc: '飞剑每穿透一个敌人伤害 +20%，最多叠 5 次',
    },
    flame_domain: {
        id: 'flame_domain',
        tag: BuildTag.SUSTAIN,
        name: '焚天领域',
        desc: '烈焰环范围 +35%，处于环内的敌人移速 -25%',
    },
    cloud_step: {
        id: 'cloud_step',
        tag: BuildTag.SURVIVAL,
        name: '流云身法',
        desc: '御风步冷却 -2 秒；冲刺后留下 1 秒残影吸引敌人',
    },
    spirit_gather: {
        id: 'spirit_gather',
        tag: BuildTag.SURVIVAL,
        name: '聚灵诀',
        desc: '灵珠吸附范围翻倍；每拾取 20 个灵珠恢复 10 HP',
    },
};

export class BuildSystem {
    /** 当前连续标签 */
    private static streakTag: BuildTag | null = null;
    /** 当前连续次数 */
    private static streakCount: number = 0;
    /** 各标签累计选择次数（DebugPanel 展示） */
    private static tagCounts: Record<BuildTag, number> = {
        [BuildTag.BURST]: 0,
        [BuildTag.SUSTAIN]: 0,
        [BuildTag.SURVIVAL]: 0,
    };
    /** 已获得的流派天赋 */
    private static owned: Set<string> = new Set();

    // ==================== 选择记录 ====================

    /** 记录一次升级选择（由 LevelUpUI 应用选项后调用） */
    static recordPick(tag: BuildTag): void {
        if (this.streakTag === tag) {
            this.streakCount++;
        } else {
            this.streakTag = tag;
            this.streakCount = 1;
        }
        this.tagCounts[tag]++;
    }

    /** 若选择该标签是否会凑满流派（升级卡"可形成流派"提示用） */
    static wouldCompleteTalent(tag: BuildTag): boolean {
        return this.streakTag === tag && this.streakCount === TALENT_STREAK - 1;
    }

    /** 当前是否已满足天赋触发条件 */
    static canTriggerTalent(): boolean {
        return this.streakTag !== null && this.streakCount >= TALENT_STREAK;
    }

    /**
     * 消耗一次天赋触发机会，返回该标签下尚未拥有的天赋列表。
     * 返回空数组表示不满足条件或该标签天赋已全拿。
     */
    static consumeTalentTrigger(): TalentDef[] {
        if (!this.canTriggerTalent() || !this.streakTag) return [];
        const tag = this.streakTag;
        this.streakCount = 0;
        this.streakTag = null;
        return Object.keys(TALENTS)
            .map((id) => TALENTS[id])
            .filter((t) => t.tag === tag && !this.owned.has(t.id));
    }

    // ==================== 天赋查询 ====================

    static grantTalent(id: string): void {
        if (TALENTS[id]) this.owned.add(id);
    }

    static hasTalent(id: string): boolean {
        return this.owned.has(id);
    }

    static getOwnedTalentNames(): string[] {
        return Array.from(this.owned).map((id) => TALENTS[id]?.name ?? id);
    }

    // ==================== 展示 / 复位 ====================

    /** 标签统计摘要（DebugPanel：Current Build Tags） */
    static getTagSummary(): string {
        return (
            `${TAG_NAMES[BuildTag.BURST]}×${this.tagCounts[BuildTag.BURST]} ` +
            `${TAG_NAMES[BuildTag.SUSTAIN]}×${this.tagCounts[BuildTag.SUSTAIN]} ` +
            `${TAG_NAMES[BuildTag.SURVIVAL]}×${this.tagCounts[BuildTag.SURVIVAL]}`
        );
    }

    /** 天赋摘要（DebugPanel） */
    static getTalentSummary(): string {
        const names = this.getOwnedTalentNames();
        return names.length > 0 ? names.join('、') : '—';
    }

    /** 新一局复位 */
    static resetRun(): void {
        this.streakTag = null;
        this.streakCount = 0;
        this.tagCounts = {
            [BuildTag.BURST]: 0,
            [BuildTag.SUSTAIN]: 0,
            [BuildTag.SURVIVAL]: 0,
        };
        this.owned.clear();
    }
}
