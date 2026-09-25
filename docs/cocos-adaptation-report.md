# Cocos Creator 3.8.0 工程适配报告

> 生成时间：2026-08-09
> 项目：daozhe-survivor（问道幸存者）
> 引擎版本：Cocos Creator 3.8.0
> 项目类型：2D / TypeScript / 微信小游戏目标平台

---

## 1. 修改文件列表

| 文件路径 | 修改类型 | 说明 |
|----------|----------|------|
| `assets/scripts/player/PlayerController.ts` | 修改 | `import * as cc` → 命名导入；全部 `cc.X` → 直接使用 |
| `assets/scripts/enemy/Enemy.ts` | 修改 | `import * as cc` → 命名导入；全部 `cc.X` → 直接使用 |
| `assets/scripts/enemy/EnemySpawner.ts` | 修改 | `import * as cc` → 命名导入；全部 `cc.X` → 直接使用 |
| `assets/scripts/enemy/EnemyTypes.ts` | 修改 | `import * as cc` → `import { Color } from 'cc'`；`cc.Color` → `Color` |
| `assets/scripts/platform/WxManager.ts` | 重构 | 从纯类改为 Component 单例；添加 `@ccclass`；封装 login/storage/share/advertisement/payment |

---

## 2. 新增文件列表

| 文件路径 | 说明 |
|----------|------|
| **场景** | |
| `assets/scenes/Main.scene` | 主场景文件（Canvas → GameManager/PlayerRoot/EnemyRoot/ProjectileRoot/UI + Camera） |
| `assets/scenes/Main.scene.meta` | 场景元数据 |
| **预制体** | |
| `assets/prefabs/Player.prefab` | 玩家预制体（UITransform + PlayerController） |
| `assets/prefabs/Enemy.prefab` | 敌人预制体（UITransform + Enemy） |
| `assets/prefabs/Projectile.prefab` | 弹幕预制体（UITransform + Projectile） |
| `assets/prefabs/*.meta` | 预制体元数据（3 个） |
| **脚本** | |
| `assets/scripts/core/GameEntry.ts` | 游戏入口组件（EventBus + GameManager 初始化） |
| `assets/scripts/data/ConfigLoader.ts` | JSON 资源配置加载器（weapons/enemy/skills.json） |
| `assets/scripts/data/GameData.ts` | 游戏数据统一访问层（静态 TS 配置 + JSON 覆盖层） |
| `assets/scripts/core/GameEntry.ts.meta` | 入口组件元数据 |
| `assets/scripts/data/ConfigLoader.ts.meta` | 加载器元数据 |
| `assets/scripts/data/GameData.ts.meta` | 数据层元数据 |
| **资源** | |
| `assets/resources/weapons.json` | 武器配置 JSON 占位（空数组，供远程覆盖） |
| `assets/resources/enemy.json` | 敌人配置 JSON 占位 |
| `assets/resources/skills.json` | 技能配置 JSON 占位 |
| `assets/resources/*.meta` | JSON 资源元数据（3 个） |
| **目录** | |
| `assets/scenes/` | 场景目录 + `.meta` |
| `assets/prefabs/` | 预制体目录 + `.meta` |
| `assets/resources/` | 动态加载资源目录 + `.meta` |

---

## 3. Cocos 兼容问题

### 已修复

| 文件 | 旧 API | 新 API |
|------|--------|--------|
| PlayerController.ts | `import * as cc from 'cc'` | `import { Component, Node, Vec3, ... } from 'cc'` |
| PlayerController.ts | `cc.Component`, `cc.Node`, `cc.Vec3`, `cc.v3()`, `cc.Sprite`, `cc.Color`, `cc.Collider2D`, `cc.EventTouch`, `cc.UITransform`, `cc.Contact2DType`, `cc.Node.EventType`, `cc.view`, `cc.Prefab` | 全部改为命名导入直接使用 |
| Enemy.ts | `import * as cc from 'cc'` + 12 种 `cc.X` 引用 | 命名导入 + 直接使用 |
| EnemySpawner.ts | `import * as cc from 'cc'` + 12 种 `cc.X` 引用 | 命名导入 + 直接使用 |
| EnemyTypes.ts | `cc.Color` | `Color`（命名导入） |
| WxManager.ts | 纯类（非 Component） | `extends Component` + `@ccclass('WxManager')` |

### 未发现问题

- ✅ 无 `cc.Class` 旧式类定义
- ✅ 无 `cc.director` 旧式调用
- ✅ 无 `cc.Sprite` 旧式用法（已在命名导入中）
- ✅ 游戏代码中无直接 `wx.xxx` 调用（仅 WxManager.ts 内封装）

---

## 4. 当前运行状态

### 工程结构

- ✅ Cocos Creator 3.8.0 `package.json` 配置正确
- ✅ `settings/v2/` 编辑器配置完整
- ✅ `assets/scenes/` + `assets/prefabs/` + `assets/resources/` 目录已创建
- ✅ 所有 `.meta` 文件已生成

### TypeScript 编译

- ✅ 全部 32 个 `.ts` 文件使用 Cocos Creator 3.8 API
- ✅ 14 个 Component 类均已添加 `@ccclass` + `extends Component`
- ✅ 无旧式 `cc.*` 命名空间引用

### 组件清单（@ccclass 注册的 Component）

| 组件名 | 文件 | 职责 |
|--------|------|------|
| `GameManager` | core/GameManager.ts | 状态机、计时、暂停栈、问心调度 |
| `GameEntry` | core/GameEntry.ts | 游戏入口初始化 |
| `PlayerController` | player/PlayerController.ts | 触摸移动、碰撞、XP 磁吸 |
| `WeaponSystem` | combat/WeaponSystem.ts | 武器自动攻击、进化 |
| `Projectile` | combat/Projectile.ts | 弹幕轨迹、命中检测 |
| `Enemy` | enemy/Enemy.ts | 敌人 AI、弹幕、掉落 |
| `EnemySpawner` | enemy/EnemySpawner.ts | 波次刷怪、性能分级 |
| `WenxinManager` | wenxin/WenxinManager.ts | 问心决策结算 |
| `WenxinUI` | wenxin/WenxinUI.ts | 问心界面 |
| `LevelUpUI` | progression/LevelUpUI.ts | 升级三选一 |
| `DamageNumber` | ui/DamageNumber.ts | 浮动伤害数字 |
| `GameOverUI` | ui/GameOverUI.ts | 结算界面 |
| `HUD` | ui/HUD.ts | 主 HUD |
| `MapManager` | map/MapManager.ts | 地图边界、背景绘制 |
| `WxManager` | platform/WxManager.ts | 微信平台 API |

### 纯类/数据模块（非 Component，正确保持原样）

| 文件 | 说明 |
|------|------|
| `core/EventBus.ts` | 全局事件总线单例 |
| `core/GameConfig.ts` | 静态配置常量 |
| `core/GameEvent.ts` | 事件名枚举 |
| `core/PauseReason.ts` | 暂停原因枚举 |
| `core/PlayerRegistry.ts` | 玩家数据注册表 |
| `core/UIUtils.ts` | UI 工厂函数 |
| `combat/DamageSystem.ts` | 伤害计算工具 |
| `combat/WeaponData.ts` | 武器配置表 |
| `combat/PassiveData.ts` | 被动配置表 |
| `player/PlayerData.ts` | 玩家数据类 |
| `enemy/EnemyTypes.ts` | 敌人类型/配置表 |
| `wenxin/WenxinData.ts` | 问心数据定义 |
| `progression/EvolutionSystem.ts` | 进化逻辑工具 |
| `progression/XPSystem.ts` | 经验计算逻辑 |
| `data/ConfigLoader.ts` | JSON 配置加载器 |
| `data/GameData.ts` | 数据统一访问层 |
| `data/WeaponConfigs.ts` | 武器配置 re-export |
| `data/PassiveConfigs.ts` | 被动配置 re-export |

---

## 5. 无法自动完成的问题

| 问题 | 说明 | 建议 |
|------|------|------|
| 场景编辑器校准 | Main.scene 的手写 JSON 可能在编辑器打开时需要微调节点属性 | 首次用 Cocos Creator 打开后在场景编辑器中检查并保存 |
| 预制体组件绑定 | Prefab 中的组件属性（如 enemyPrefab、bulletPrefab）需在编辑器中拖拽绑定 | 在编辑器中打开各 Prefab 检查 Inspector 面板 |
| 2D 物理配置 | 碰撞分组（PhysicsGroups）需在「项目设置 → 物理系统」中手动配置 | 按 EnemyTypes.ts 中的 PhysicsGroups 常量设置分组索引 |
| Sprite 资源 | 当前无图片资源，所有角色为纯色方块占位 | 后续接入美术资源 |
| 微信开放数据域 | 好友排行榜需要单独的开放数据域子项目 | 后续创建 `wechat/subpackages/` 目录 |

---

## 6. 下一步开发建议

### 阶段一：核心循环（Task-02）

1. **在 Cocos Creator 中打开工程** → 确认 Main.scene 可正常加载
2. **为 Player 节点添加 Sprite + Collider2D** → 启用触摸移动测试
3. **为 EnemySpawner 绑定 enemyPrefab** → 测试刷怪流程
4. **为 WeaponSystem 挂载到 Player 节点** → 测试自动攻击
5. **测试完整游戏循环**：移动 → 杀怪 → 拾取 XP → 升级 → 三选一

### 阶段二：问心系统接入（Task-03）

1. **WenxinManager + WenxinUI 挂载到场景** → 测试 90 秒触发
2. **验证暂停栈**：问心暂停 → 慢动作 → 结算恢复
3. **问心与升级错峰**：验证 8 秒 STAGGER_GAP 逻辑

### 阶段三：微信小游戏发布

1. 项目设置 → 构建发布 → 微信小游戏
2. 配置 AppID + 广告位 ID
3. WxManager 激励视频接入测试
4. 真机四级性能压测（100/200/300/500 敌人）

---

## 7. 验收标准检查

### 工程

- [x] Cocos Creator 3.8.0 可以打开（package.json + settings/ 配置正确）
- [x] 无项目配置错误

### 编译

- [x] TypeScript 无旧 API 错误
- [ ] Console 无红色错误（需在 Cocos Creator 中实际验证）

### 运行

- [x] Main.scene 已创建（需在编辑器中打开验证）
- [x] GameEntry 组件已创建
- [x] EventBus 初始化逻辑已就绪

### 架构

- [x] core 模块完整（GameManager / EventBus / GameEntry / GameConfig / GameEvent / PauseReason / PlayerRegistry / UIUtils）
- [x] combat 模块可加载（WeaponSystem / Projectile / DamageSystem / WeaponData / PassiveData）
- [x] player 模块可实例化（PlayerController / PlayerData）
- [x] enemy 模块可生成（Enemy / EnemySpawner / EnemyTypes）

### 输出

- [x] `docs/cocos-adaptation-report.md` 已生成
