/**
 * Scene startup component. Attach this to the same node as GameManager.
 */
import {
    _decorator, BoxCollider2D, Color, Component, find, Graphics,
    Label, Node, Size, UITransform, view, log, warn, UIOpacity, tween,
} from 'cc';
import { EventBus } from './EventBus';
import { GameManager, GameMode } from './GameManager';
import { GAME_CONFIG } from './GameConfig';
import { WenxinManager } from '../wenxin/WenxinManager';
import { WxManager } from '../platform/WxManager';
import { PlayerController } from '../player/PlayerController';
import { WeaponSystem } from '../combat/WeaponSystem';
import { EnemySpawner } from '../enemy/EnemySpawner';
import { MapManager } from '../map/MapManager';
import { HUD } from '../ui/HUD';
import { DamageNumber } from '../ui/DamageNumber';
import { GameOverUI } from '../ui/GameOverUI';
import { WenxinUI } from '../wenxin/WenxinUI';
import { LevelUpUI } from '../progression/LevelUpUI';
import { PickupSystem } from '../progression/PickupSystem';
import { DebugPanel } from '../ui/DebugPanel';
import { Banner } from '../ui/Banner';
import { DashAbility } from '../player/DashAbility';
import { LingmaiSystem } from '../progression/LingmaiSystem';
import { ChestSystem } from '../progression/ChestSystem';
import { RewardPanel } from '../progression/RewardPanel';

const { ccclass } = _decorator;

@ccclass('GameEntry')
export class GameEntry extends Component {
    onLoad(): void {
        EventBus.getInstance();
        log('[GameEntry] EventBus initialized.');

        // MVP 场景只需要一个 Canvas + GameEntry。其余运行时节点统一由这里创建，
        // 避免手写 .scene 序列化数据导致 Creator 无法解析脚本 UUID。
        this.bootstrapMvpScene();

        const gameManager = this.getComponent(GameManager) ?? GameManager.getInstance();
        if (gameManager) {
            log(`[GameEntry] GameManager ready. mode=${gameManager.mode}`);
        } else {
            warn('[GameEntry] GameManager is missing from the startup node.');
        }

        log(`[GameEntry] wenxinInterval=${GAME_CONFIG.wenxin.defaultInterval}s`);
    }

    start(): void {
        EventBus.emit('GAME_ENTRY_READY');
        // PlayerController 的 onLoad 已完成，下一帧赠送首把武器，确保开局立即有战斗反馈。
        this.scheduleOnce(() => this.addStarterWeapon(), 0);
        log('[GameEntry] Startup complete.');
    }

    private bootstrapMvpScene(): void {
        const canvas = this.node.name === 'Canvas' ? this.node : (this.node.parent ?? find('Canvas'));
        if (!canvas) {
            warn('[GameEntry] 未找到 Canvas。请将 GameEntry 挂到 Canvas 或 Canvas 的子节点。');
            return;
        }

        // 这行状态文字故意不依赖 HUD：它是场景接线的可视化探针。
        // 如果只看到背景/玩家但看不到它，就说明 GameEntry 根本没有被加载。
        this.showBootStatus(canvas, 'MVP STARTING', new Color(255, 215, 0, 255));

        try {
            this.bootstrapMvpSceneInner(canvas);
            this.hideBootStatus(canvas);
        } catch (error) {
            console.error('[GameEntry] MVP bootstrap failed:', error);
            const detail = error instanceof Error ? error.message : String(error);
            // 预览页的运行时 Console 与 Creator 编辑器 Console 相互独立。
            // 因此把错误正文直接画到场景中，方便在不打开浏览器开发者工具时定位。
            this.showBootStatus(canvas, `MVP ERROR: ${detail}`, new Color(255, 100, 100, 255));
        }
    }

    private bootstrapMvpSceneInner(canvas: Node): void {

        // GameEntry 可以直接挂 Canvas，也可以挂 Canvas/GameRoot；两种布局都支持。
        const gameRoot = this.node.name === 'Canvas' ? this.ensureChild(canvas, 'GameRoot') : this.node;
        if (!gameRoot.getComponent(GameManager)) gameRoot.addComponent(GameManager);
        if (!gameRoot.getComponent(WenxinManager)) gameRoot.addComponent(WenxinManager);
        // 平台管理器：结算界面的复活/翻倍按钮依赖它（缺失会空指针）；
        // 非微信环境内部自动降级为本地模拟（showRewardedAd 直接 resolve(true)）
        if (!gameRoot.getComponent(WxManager)) gameRoot.addComponent(WxManager);

        const map = this.ensureChild(canvas, 'Map');
        if (!map.getComponent(UITransform)) map.addComponent(UITransform).setContentSize(2000, 2000);
        if (!map.getComponent(MapManager)) map.addComponent(MapManager);

        const player = this.ensureChild(canvas, 'Player');
        if (!player.getComponent(UITransform)) player.addComponent(UITransform).setContentSize(48, 48);
        if (!player.getComponent(Graphics)) {
            const graphics = player.addComponent(Graphics);
            // 外层光晕（柔化轮廓）
            graphics.fillColor = new Color(94, 234, 212, 60);
            graphics.circle(0, 0, 30);
            graphics.fill();
            // 主体青绿色圆形
            graphics.fillColor = new Color(94, 234, 212, 255);
            graphics.circle(0, 0, 22);
            graphics.fill();
            // 白色描边
            graphics.strokeColor = new Color(255, 255, 255, 230);
            graphics.lineWidth = 3;
            graphics.circle(0, 0, 22);
            graphics.stroke();
            // 发光核心
            graphics.fillColor = new Color(224, 255, 248, 255);
            graphics.circle(0, 0, 8);
            graphics.fill();
        }
        if (!player.getComponent(BoxCollider2D)) {
            const collider = player.addComponent(BoxCollider2D);
            collider.size = new Size(44, 44);
        }
        if (!player.getComponent(PlayerController)) player.addComponent(PlayerController);
        // 地图边界与 MapManager(2000×2000) 对齐，留 50px 边距
        const playerCtrl = player.getComponent(PlayerController)!;
        playerCtrl.mapHalfWidth = 950;
        playerCtrl.mapHalfHeight = 950;
        if (!player.getComponent(WeaponSystem)) player.addComponent(WeaponSystem);

        const spawner = this.ensureChild(canvas, 'EnemySpawner');
        const spawnerComp = spawner.getComponent(EnemySpawner) ?? spawner.addComponent(EnemySpawner);
        // MVP 数值接线：同屏上限 60 / 地图边界与玩家一致 /
        // 2 分钟测试模式（无终局 Boss，精英提前到 60 秒）
        const testMode = GAME_CONFIG.debug.test2Minute;
        spawnerComp.maxEnemies = GAME_CONFIG.screen.maxEnemies;
        spawnerComp.gameEndTime = testMode ? GameMode.TEST_2MIN : GameMode.TRIAL_15;
        spawnerComp.mapHalfWidth = 950;
        spawnerComp.mapHalfHeight = 950;
        // 精英妖王：每 45 秒一只，首次即第 45 秒（P1 验收节奏）
        spawnerComp.eliteInterval = GAME_CONFIG.elite.interval;

        const pickups = this.ensureChild(canvas, 'Pickups');
        if (!pickups.getComponent(PickupSystem)) pickups.addComponent(PickupSystem);

        // 地图资源点：灵脉（每 35 秒一座）与宝箱（精英掉落）
        const lingmai = this.ensureChild(canvas, 'Lingmai');
        if (!lingmai.getComponent(LingmaiSystem)) lingmai.addComponent(LingmaiSystem);
        const chests = this.ensureChild(canvas, 'Chests');
        if (!chests.getComponent(ChestSystem)) chests.addComponent(ChestSystem);

        // 每个弹层必须是 HUD 的独立兄弟节点；问心/升级/结算组件会各自隐藏自身节点。
        const uiRoot = this.ensureChild(canvas, 'UI');
        this.ensureComponent(uiRoot, 'HUD', HUD);
        this.ensureComponent(uiRoot, 'DamageNumbers', DamageNumber);
        this.ensureComponent(uiRoot, 'WenxinUI', WenxinUI);
        this.ensureComponent(uiRoot, 'LevelUpUI', LevelUpUI);
        this.ensureComponent(uiRoot, 'GameOverUI', GameOverUI);
        // 事件短横幅（妖王来袭 / 灵脉现世 / 流派天赋 / 身法绝妙 / 问心功成）
        this.ensureComponent(uiRoot, 'Banner', Banner);
        // 御风步（唯一主动技能：右下角按钮 + 冲刺位移/无敌/击退）
        this.ensureComponent(uiRoot, 'DashAbility', DashAbility);
        // 通用三选一奖励面板（灵脉 / 宝箱共用；独立暂停原因，不与升级面板互相干扰）
        this.ensureComponent(uiRoot, 'RewardPanel', RewardPanel);
        // 可玩状态调试面板（仅开发环境；GAME_CONFIG.debug.debugUi / DEBUG_UI 常量关闭）
        if (GAME_CONFIG.debug.debugUi) {
            this.ensureComponent(uiRoot, 'DebugPanel', DebugPanel);
        }
        this.showPlayHint(canvas);
    }

    private showBootStatus(canvas: Node, text: string, color: Color): void {
        let node = canvas.getChildByName('MvpBootStatus');
        if (!node) {
            node = new Node('MvpBootStatus');
            node.setParent(canvas);
            node.addComponent(UITransform).setContentSize(1080, 72);
            node.addComponent(Label);
        }
        const label = node.getComponent(Label)!;
        label.string = text;
        label.fontSize = 18;
        label.lineHeight = 28;
        label.enableWrapText = true;
        label.color = color;
        const size = view.getVisibleSize();
        node.setPosition(-size.width / 2 + 185, size.height / 2 - 35, 0);
    }

    private hideBootStatus(canvas: Node): void {
        const node = canvas.getChildByName('MvpBootStatus');
        if (node) node.active = false;
    }

    private addStarterWeapon(): void {
        const canvas = this.node.name === 'Canvas' ? this.node : this.node.parent;
        const player = canvas?.getChildByName('Player');
        const weapons = player?.getComponent(WeaponSystem);
        if (weapons && weapons.playerData.weapons.length === 0) {
            // 3 把常驻环绕飞剑比瞬时弹道更适合首屏教学：玩家一眼能看懂“自动战斗”。
            weapons.addWeapon('sword_array');
            log('[GameEntry] Starter weapon added: sword_array');
        }
    }

    private ensureChild(parent: Node, name: string): Node {
        const existing = parent.getChildByName(name);
        if (existing) return existing;
        const node = new Node(name);
        node.setParent(parent);
        return node;
    }

    private ensureComponent<T extends Component>(parent: Node, name: string, ctor: new () => T): T {
        const child = this.ensureChild(parent, name);
        return child.getComponent(ctor) ?? child.addComponent(ctor);
    }

    private showPlayHint(canvas: Node): void {
        let node = canvas.getChildByName('MvpPlayHint');
        if (!node) {
            node = new Node('MvpPlayHint');
            node.setParent(canvas);
            node.addComponent(UITransform).setContentSize(760, 44);
            node.addComponent(Label);
        }
        const label = node.getComponent(Label)!;
        label.string = '拖拽移动 · 飞剑自动斩妖 · 拾取蓝色灵珠升级';
        label.fontSize = 20;
        label.lineHeight = 30;
        label.color = new Color(210, 232, 240, 235);
        const size = view.getVisibleSize();
        // 顶部 HUD 下方
        node.setPosition(0, size.height / 2 - 118, 0);
        // 首局引导：显示 8 秒后淡出
        const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        op.opacity = 255;
        tween(op)
            .delay(8)
            .to(1.0, { opacity: 0 })
            .call(() => {
                if (node.isValid) node.active = false;
            })
            .start();
    }
}
