// ============================================================
// PauseReason —— 暂停原因枚举（暂停栈元素，core/GameManager 使用）
// ------------------------------------------------------------
// 时间流速规则（GameManager.recomputeTimeScale）：
//   - WENXIN：问心触发（画面减速至 20%，不打断割草，GDD 4.3.2）
//   - 其余原因：完全冻结（0x）
// 本文件是唯一权威定义；core/GameManager 以 re-export 方式对外提供。
// ============================================================

export enum PauseReason {
    /** 问心触发（弹窗决策；时间流速降至 20%，不打断割草） */
    WENXIN = 'wenxin',
    /** 升级三选一（完全冻结） */
    LEVEL_UP = 'level_up',
    /** 手动暂停（设置/切后台等） */
    MANUAL = 'manual',
    /** 设置面板 */
    SETTINGS = 'settings',
    /** 激励视频广告期间 */
    AD = 'ad',
    /** 终局问心·九重天劫 */
    FINAL_WENXIN = 'final_wenxin',
}
