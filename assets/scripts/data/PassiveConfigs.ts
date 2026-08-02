// ============================================================
// data/PassiveConfigs —— 兼容转发层
// ------------------------------------------------------------
// 被动数据唯一权威定义位于 combat/PassiveData.ts（PASSIVE_CONFIGS /
// PassiveConfig / PassiveStat），本文件仅做 re-export，供按 data/
// 路径导入的模块使用，避免出现两份被动配置表。
// ============================================================

export * from '../combat/PassiveData';
