/**
 * Scene startup component. Attach this to the same node as GameManager.
 */
import {
    _decorator, BoxCollider2D, Color, Component, find, Graphics,
    Label, Node, Size, UITransform, view, log, warn,
} from 'cc';
import { EventBus } from './EventBus';
import { GameManager } from './GameManager';
import { GAME_CONFIG } from './GameConfig';
import { WenxinManager } from '../wenxin/WenxinManager';
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

        const map = this.ensureChild(canvas, 'Map');
        if (!map.getComponent(UITransform)) map.addComponent(UITransform).setContentSize(2000, 2000);
        if (!map.getComponent(MapManager)) map.addComponent(MapManager);

        const player = this.ensureChild(canvas, 'Player');
        if (!player.getComponent(UITransform)) player.addComponent(UITransform).setContentSize(48, 48);
        if (!player.getComponent(Graphics)) {
            const graphics = player.addComponent(Graphics);
            graphics.fillColor = new Color(94, 234, 212, 255);
            graphics.circle(0, 0, 22);
            graphics.fill();
            graphics.strokeColor = new Color(255, 255, 255, 220);
            graphics.lineWidth = 3;
            graphics.circle(0, 0, 22);
            graphics.stroke();
        }
        if (!player.getComponent(BoxCollider2D)) {
            const collider = player.addComponent(BoxCollider2D);
            collider.size = new Size(44, 44);
        }
        if (!player.getComponent(PlayerController)) player.addComponent(PlayerController);
        if (!player.getComponent(WeaponSystem)) player.addComponent(WeaponSystem);

        const spawner = this.ensureChild(canvas, 'EnemySpawner');
        if (!spawner.getComponent(EnemySpawner)) spawner.addComponent(EnemySpawner);

        const pickups = this.ensureChild(canvas, 'Pickups');
        if (!pickups.getComponent(PickupSystem)) pickups.addComponent(PickupSystem);

        // 每个弹层必须是 HUD 的独立兄弟节点；问心/升级/结算组件会各自隐藏自身节点。
        const uiRoot = this.ensureChild(canvas, 'UI');
        this.ensureComponent(uiRoot, 'HUD', HUD);
        this.ensureComponent(uiRoot, 'DamageNumbers', DamageNumber);
        this.ensureComponent(uiRoot, 'WenxinUI', WenxinUI);
        this.ensureComponent(uiRoot, 'LevelUpUI', LevelUpUI);
        this.ensureComponent(uiRoot, 'GameOverUI', GameOverUI);
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
            node.addComponent(UITransform).setContentSize(720, 42);
            node.addComponent(Label);
        }
        const label = node.getComponent(Label)!;
        label.string = '拖拽移动 · 环绕飞剑自动斩妖 · 拾取蓝色灵珠升级';
        label.fontSize = 20;
        label.lineHeight = 30;
        label.color = new Color(210, 232, 240, 230);
        const size = view.getVisibleSize();
        node.setPosition(0, size.height / 2 - 95, 0);
    }
}
