// ============================================================
// GameEvent —— 全局游戏事件名定义（枚举值 = 事件名字符串）
// ------------------------------------------------------------
// 全项目事件收发统一使用本枚举（EventBus.on/off/emit 第一个参数），
// 禁止散落裸字符串字面量，避免大小写不一致导致事件静默失联。
// ============================================================

export enum GameEvent {
    // —— 生命周期 ——
    /** 开局（core/GameManager.startGame 广播，WenxinManager 收到后重置） */
    GAME_START = 'game_start',
    /** 游戏结束（超时或死亡） */
    GAME_OVER = 'game_over',
    /** 每秒整秒计时 */
    SECOND_TICK = 'second_tick',

    // —— 玩家 ——
    /** 玩家升级（XPSystem 广播；GameManager 收到后进入升级暂停） */
    PLAYER_LEVEL_UP = 'player_level_up',
    /** 玩家死亡 */
    PLAYER_DIED = 'player_died',
    /** 玩家受击（HUD 血条/红屏反馈） */
    PLAYER_DAMAGED = 'player_damaged',
    /** 玩家生命变化（回血） */
    PLAYER_HP_CHANGED = 'player_hp_changed',
    /** 玩家经验增加（HUD 经验条） */
    PLAYER_XP = 'player_xp',
    /** 玩家复活（激励视频成功后广播，{ graceSeconds }；玩家系统监听后恢复控制） */
    PLAYER_REVIVED = 'player_revived',

    // —— 战斗 ——
    /** 敌人被击杀 */
    ENEMY_KILLED = 'enemy_killed',
    /** 战斗伤害（飘字/HUD） */
    COMBAT_DAMAGE = 'combat_damage',
    /** 敌人弹幕命中玩家 */
    ENEMY_BULLET_HIT = 'enemy_bullet_hit',
    /**
     * 敌人攻击命中玩家（{ damage, kind: 'melee' | 'bullet' }）。
     * 代码驱动的攻击判定（接触 / 弹幕），不依赖 2D 物理碰撞回调；
     * PlayerController 收到后统一走 takeDamage（含无敌帧）。
     */
    ENEMY_ATTACK = 'enemy_attack',
    /** 敌人掉落经验宝石 */
    DROP_XP = 'drop_xp',
    /** 敌人掉落灵石 */
    DROP_GOLD = 'drop_gold',
    /** 敌人掉落宝箱 */
    DROP_CHEST = 'drop_chest',
    /** 经验宝石被拾取 */
    XP_PICKED = 'xp_picked',
    /** 灵石被拾取 */
    GOLD_PICKED = 'gold_picked',

    // —— 刷怪 / 波次 ——
    /** 刷怪 */
    ENEMY_SPAWNED = 'enemy_spawned',
    /** 每分钟波次广播 */
    WAVE_STARTED = 'wave_started',
    /** 天劫之主降临 */
    BOSS_SPAWNED = 'boss_spawned',
    /** 天劫之主被击败 */
    BOSS_DEFEATED = 'boss_defeated',
    /** 天劫之主半血狂暴（二阶段） */
    BOSS_PHASE_TWO = 'boss_phase_two',

    // —— 武器 ——
    /** 武器获得 */
    WEAPON_ADDED = 'weapon_added',
    /** 武器升级 */
    WEAPON_UPGRADED = 'weapon_upgraded',
    /** 武器进化超武 */
    WEAPON_EVOLVED = 'weapon_evolved',
    /** 武器开火（{ id, name, level }；DebugPanel 统计释放次数、排查"只释放一次"类问题） */
    WEAPON_FIRED = 'weapon_fired',

    // —— 主动技能：御风步 ——
    /** 御风步冲刺开始（{ direction }）；期间玩家无敌 */
    DASH_STARTED = 'dash_started',
    /** 御风步冲刺结束（{ passed }：本次穿过的敌人数量） */
    DASH_ENDED = 'dash_ended',
    /** 御风步冷却完毕（按钮发光提示） */
    DASH_READY = 'dash_ready',

    // —— 地图事件（灵脉 / 精英 / 流派天赋 / 问心结果，供横幅与 DebugPanel 使用） ——
    /** 灵脉现世（{ position, duration }） */
    LINGMAI_SPAWNED = 'lingmai_spawned',
    /** 灵脉被采走（{ reward }） */
    LINGMAI_COLLECTED = 'lingmai_collected',
    /** 灵脉超时消失 */
    LINGMAI_EXPIRED = 'lingmai_expired',
    /** 宝箱掉落（{ position, quality }，由 Enemy 的 DROP_CHEST 转出） */
    CHEST_SPAWNED = 'chest_spawned',
    /** 宝箱开启（{ reward }） */
    CHEST_OPENED = 'chest_opened',
    /** 精英妖王来袭（{ node }，顶部横幅"妖王来袭"） */
    ELITE_WARNING = 'elite_warning',
    /** 获得流派天赋（{ talentId, name }，横幅"流派天赋：X"） */
    TALENT_GAINED = 'talent_gained',
    /** 问心结算的战斗后果（{ tier, success, effect }，横幅"问心功成/未竟"） */
    WENXIN_OUTCOME = 'wenxin_outcome',
    /** 击败精英后获得一次可选问心（{ charges }，WenxinUI 显示"问心"按钮） */
    WENXIN_OPTIONAL = 'wenxin_optional',
    /** 请求立刻降临一只精英（问心天问失败；由 EnemySpawner 订阅执行） */
    ELITE_SUMMON = 'elite_summon',

    // —— 经验系统 ——
    /** 经验入账（XPSystem 广播，{ amount }） */
    XP_COLLECTED = 'xp_collected',

    // —— 问心（核心差异化系统） ——
    /** 问心触发（面板弹出；GameManager 触发并进入问心暂停） */
    WENXIN_TRIGGER = 'wenxin_trigger',
    /** 问心结算完成（{ tier, success, courageGain }；GameManager 收到后恢复游戏） */
    WENXIN_RESULT = 'wenxin_result',
}
