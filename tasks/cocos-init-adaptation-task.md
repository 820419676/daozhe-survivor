
# Cocos Creator 3.8.0 工程初始化适配任务

## 任务名称

daozhe-survivor Cocos Creator 3.8.0 工程初始化适配


# 一、任务目标

将当前 daozhe-survivor 项目转换为标准 Cocos Creator 3.8.0 TypeScript 游戏工程。

目标：

- 可以被 Cocos Creator 3.8.0 正常打开
- 可以运行 Main Scene
- scripts 下所有核心系统可以被 Cocos 识别
- 建立基础游戏启动流程
- 为后续微信小游戏发布做好准备


# 二、当前项目结构

项目路径：

D:/vsprojects/AI game/daozhe-survivor


当前已有：

assets/scripts/

包含：

core/
combat/
player/
enemy/
wenxin/
progression/
ui/
platform/
map/
data/


已有设计文档：

../output/gdd/haodu-survivor-gdd-v3.md


# 三、技术约束

必须使用：

- Cocos Creator 3.8.0
- TypeScript
- 2D项目
- 微信小游戏目标平台


禁止：

- 不允许重写已有游戏逻辑
- 不允许删除已有模块
- 不允许改变目录结构
- 不允许引入第三方游戏框架


# 四、执行任务


## Task 1：检查工程结构

检查当前项目是否符合 Cocos Creator 3.8.0标准。


如果缺少以下文件，需要创建：

```

project.json

settings/

assets/scenes/

assets/prefabs/

assets/resources/

````


确保：

package.json

符合 Cocos Creator 项目要求。


---

# Task 2：初始化项目配置


创建：

project.json


配置：

项目名称：

daozhe-survivor


项目类型：

2D


引擎版本：

3.8.0


---

# Task 3：适配 TypeScript


检查：

assets/scripts/**/*.ts


所有需要挂载到节点的脚本：

必须继承：

Component


例如：

修改前：

```ts
export class GameManager {

}
````

修改后：

```ts
import { Component } from 'cc';

export class GameManager extends Component {

}
```

添加：

@ccclass

例如：

```ts
@ccclass('GameManager')
export class GameManager extends Component {

}
```

---

# Task 4：建立游戏入口

创建：

assets/scripts/core/GameEntry.ts

要求：

继承 Component

负责：

* 初始化 GameManager
* 初始化 EventBus
* 初始化配置
* 创建游戏状态

生命周期：

使用：

onLoad()

start()

---

# Task 5：创建Main场景

创建：

assets/scenes/Main.scene

场景结构：

```
Main

├── GameManager

├── PlayerRoot

├── EnemyRoot

├── ProjectileRoot

├── UI

└── Camera
```

并绑定：

GameEntry

---

# Task 6：创建基础Prefab

创建：

assets/prefabs/

包含：

```
Player.prefab

Enemy.prefab

Projectile.prefab
```

要求：

可以被脚本动态加载。

---

# Task 7：资源配置系统

检查：

assets/scripts/data/

如果不存在：

创建：

```
ConfigLoader.ts

GameData.ts
```

支持加载：

```
weapons.json

enemy.json

skills.json
```

---

# Task 8：修复Cocos API兼容问题

扫描全部代码：

检查：

* cc.Node
* cc.Component
* cc.Sprite
* cc.director
* cc.Class

旧API。

全部升级到：

Cocos Creator 3.8 API

例如：

旧：

```ts
cc.Component
```

新：

```ts
import {Component} from 'cc';
```

---

# Task 9：微信小游戏适配

检查：

platform/WxManager.ts

要求：

封装：

```
login()

storage()

share()

advertisement()

payment()
```

禁止：

代码中直接调用：

wx.xxx

---

# Task 10：生成运行检查报告

完成后生成：

```
docs/cocos-adaptation-report.md
```

内容：

包括：

1. 修改文件列表

2. 新增文件列表

3. Cocos兼容问题

4. 当前运行状态

5. 下一步开发建议

---

# 五、验收标准

必须满足：

## 工程

[ ] Cocos Creator 3.8.0可以打开

[ ] 无项目配置错误

## 编译

[ ] TypeScript无错误

[ ] Console无红色错误

## 运行

[ ] Main.scene可以运行

[ ] GameEntry正常启动

[ ] EventBus初始化成功

## 架构

[ ] core模块可用

[ ] combat模块可加载

[ ] player模块可实例化

[ ] enemy模块可生成

## 输出

生成：

docs/cocos-adaptation-report.md

# 六、执行方式

请直接修改项目文件。

不要只输出代码建议。

完成后：

1. 汇总修改内容
2. 列出无法自动完成的问题
3. 给出下一阶段任务建议

```

---

## 给 AI 执行时的推荐提示词

不要直接丢 md，可以这样：

```

你现在是项目主程。

请读取：
tasks/cocos-init-adaptation-task.md

按照任务要求直接修改当前工程。

执行原则：

1. 先扫描项目结构
2. 再修改文件
3. 不要只给方案
4. 每完成一个Task进行自检
5. 最后输出验收报告

如果发现设计文档和代码冲突，以GDD为准。

```

---

## 另外针对你的项目，我建议 AI 执行顺序不要一次性改完

因为你的项目有「问心系统」这个核心创新，建议拆成 3 个 Agent 任务：

```

Task-01
Cocos工程初始化
↓
Task-02
游戏核心循环打通
(Player + Enemy + Weapon)
↓
Task-03
问心系统接入游戏循环

```

这样 AI 成功率会高很多。

一次让 AI 改整个幸存者游戏，Claude/Codex 都容易出现“架构看起来完成，但无法运行”的情况。你这个项目更适合 **工程化分阶段 Agent 开发流程**。
```
