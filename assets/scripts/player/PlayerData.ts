/**
 * PlayerData.ts —— 玩家纯数据类（非 Component）
 *
 * 《问道幸存者》玩家局内属性容器：
 *   - 基础属性（HP / 等级 / 经验 / 灵石 / 击杀）
 *   - 战斗属性（受武器、被动、问心影响：might/area/speed/duration/cooldown/luck/greed）
 *   - 装备槽（6 武器 + 6 被动，同 Vampire Survivors 槽位约束）
 *   - 问心状态（道心值、经验倍率、问心档位、连渡次数）
 *
 * 升级经验曲线：getXpForLevel(lv) = 20 × 1.3^(lv-1)（VS 风格指数曲线，
 * 保证前期升级快、后期升级慢，配合"击杀掉宝石→磁吸拾取→升级"节奏）。
 */

/** 武器槽位（id 对应武器表，level 为当前等级，满级后可进化超武） */
export interface WeaponSlot {
    id: string;
    level: number;
}

/** 被动槽位（id 对应被动表，level 为当前等级） */
export interface PassiveSlot {
    id: string;
    level: number;
}

export class PlayerData {
    // ==================== 基础属性 ====================

    /** 当前生命值 */
    hp: number = 100;

    /** 最大生命值 */
    maxHp: number = 100;

    /** 当前等级（每满一条经验条 +1） */
    level: number = 1;

    /** 当前经验（未满的下一条经验条进度） */
    xp: number = 0;

    /** 本局击杀数 */
    kills: number = 0;

    /** 灵石（局内掉落货币，结算按 60% 兑换局外灵石） */
    gold: number = 0;

    // ==================== 战斗属性（受武器/被动/问心影响） ====================

    /** 伤害倍率（基础攻击力 = 10 × might） */
    might: number = 1;

    /** 范围倍率（影响武器攻击范围、磁吸半径等） */
    area: number = 1;

    /** 速度倍率（基础移速 = 200 × speed） */
    speed: number = 1;

    /** 持续时间倍率（影响武器持续型效果） */
    duration: number = 1;

    /** 冷却倍率（数值越大冷却越短，基础 1） */
    cooldown: number = 1;

    /** 幸运（影响暴击率、宝箱品质等） */
    luck: number = 1;

    /** 贪婪（灵石掉落倍率） */
    greed: number = 1;

    /** 道心值（本局，问心系统累积的勇气积分） */
    bravery: number = 0;

    // ==================== 装备 ====================

    /** 已持有武器列表（最多 maxWeapons 个） */
    weapons: WeaponSlot[] = [];

    /** 已持有被动列表（最多 maxPassives 个） */
    passives: PassiveSlot[] = [];

    /** 武器槽上限 */
    maxWeapons: number = 6;

    /** 被动槽上限 */
    maxPassives: number = 6;

    // ==================== 问心状态 ====================

    /** 经验倍率（问道功成时加成，未竟时减半，有保底） */
    xpMultiplier: number = 1;

    /** 当前问心档位（天问档越高回馈越大） */
    currentWenxinTier: number = 0;

    /** 连渡次数（连渡天劫层数） */
    consecutiveWins: number = 0;

    // ==================== 计算属性 ====================

    /** 攻击力（基础 10 × 伤害倍率） */
    get attackPower(): number {
        return 10 * this.might;
    }

    /** 暴击率（基础 5% + 幸运 × 3%） */
    get critChance(): number {
        return 0.05 + this.luck * 0.03;
    }

    /** 磁吸/拾取半径（基础 80 × 范围倍率） */
    get pickupRange(): number {
        return 80 * this.area;
    }

    /** 基础移动速度（200 × 速度倍率） */
    get moveSpeed(): number {
        return 200 * this.speed;
    }

    /**
     * 升级经验需求：从 lv 级升到 lv+1 级所需经验。
     * 曲线：20 × 1.3^(lv-1)。lv=1 需 20 点，lv=5 约 57 点，lv=10 约 206 点。
     * （小妖掉落 1 点经验宝石，前期约 20 只升 1 级，节奏与 VS 一致）
     */
    getXpForLevel(lv: number): number {
        return Math.floor(20 * Math.pow(1.3, Math.max(1, Math.floor(lv)) - 1));
    }

    /**
     * 当前升级所需经验（代理到 getXpForLevel，随等级自动增长）。
     * 设计为 getter 而非静态字段，避免升级后忘记同步 xpToNext。
     */
    get xpToNext(): number {
        return this.getXpForLevel(this.level);
    }

    // ==================== 辅助方法 ====================

    /** 添加武器槽（超过上限返回 false） */
    addWeapon(id: string): boolean {
        if (this.weapons.length >= this.maxWeapons) return false;
        if (this.weapons.some((w) => w.id === id)) return false; // 同武器不重复占槽
        this.weapons.push({ id, level: 1 });
        return true;
    }

    /** 武器升级（返回升级后的等级，-1 表示未持有） */
    upgradeWeapon(id: string): number {
        const slot = this.weapons.find((w) => w.id === id);
        if (!slot) return -1;
        slot.level++;
        return slot.level;
    }

    /** 添加被动槽（超过上限返回 false） */
    addPassive(id: string): boolean {
        if (this.passives.length >= this.maxPassives) return false;
        if (this.passives.some((p) => p.id === id)) return false;
        this.passives.push({ id, level: 1 });
        return true;
    }

    /** 被动升级（返回升级后的等级，-1 表示未持有） */
    upgradePassive(id: string): number {
        const slot = this.passives.find((p) => p.id === id);
        if (!slot) return -1;
        slot.level++;
        return slot.level;
    }

    /** 是否持有某武器 */
    hasWeapon(id: string): boolean {
        return this.weapons.some((w) => w.id === id);
    }

    /** 是否持有某被动 */
    hasPassive(id: string): boolean {
        return this.passives.some((p) => p.id === id);
    }

    /** 治疗（不超过最大生命） */
    heal(amount: number): void {
        this.hp = Math.min(this.maxHp, this.hp + amount);
    }
}
