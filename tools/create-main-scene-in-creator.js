/*
 * Cocos Creator 3.8 scene builder for daozhe-survivor.
 *
 * Usage:
 * 1. Open this project in Cocos Creator 3.8.
 * 2. Open Developer -> Console.
 * 3. Paste this entire file into the console and press Enter.
 * 4. Save the scene as assets/scenes/main.scene.
 *
 * This script deliberately builds the scene through Creator runtime APIs instead
 * of writing .scene JSON by hand. Creator will assign the correct component
 * metadata and script references when the scene is saved.
 */
(async () => {
  const cc = globalThis.cc;
  if (!cc || !cc.director) {
    throw new Error('Cocos runtime is not available. Run this inside Cocos Creator Console.');
  }

  const {
    director,
    Node,
    UITransform,
    Canvas,
    Camera,
    Widget,
    Sprite,
    Color,
    view,
    ERigidBody2DType,
    RigidBody2D,
    BoxCollider2D,
    CircleCollider2D,
    Label,
  } = cc;

  const scene = director.getScene();
  if (!scene) {
    throw new Error('No active scene. Create or open an empty scene first.');
  }

  const importModule = async (url) => {
    if (globalThis.System && typeof globalThis.System.import === 'function') {
      return globalThis.System.import(url);
    }
    if (typeof cc.require === 'function') {
      return cc.require(url);
    }
    throw new Error('No module loader found. Creator Console should expose System.import or cc.require.');
  };

  const getExport = async (url, exportName) => {
    const mod = await importModule(url);
    const value = mod && (mod[exportName] || mod.default);
    if (!value) {
      throw new Error(`Could not load ${exportName} from ${url}`);
    }
    return value;
  };

  const [
    GameEntry,
    GameManager,
    PlayerController,
    WeaponSystem,
    EnemySpawner,
    MapManager,
    HUD,
    WenxinManager,
    WenxinUI,
    LevelUpUI,
    GameOverUI,
  ] = await Promise.all([
    getExport('db://assets/scripts/core/GameEntry.ts', 'GameEntry'),
    getExport('db://assets/scripts/core/GameManager.ts', 'GameManager'),
    getExport('db://assets/scripts/player/PlayerController.ts', 'PlayerController'),
    getExport('db://assets/scripts/combat/WeaponSystem.ts', 'WeaponSystem'),
    getExport('db://assets/scripts/enemy/EnemySpawner.ts', 'EnemySpawner'),
    getExport('db://assets/scripts/map/MapManager.ts', 'MapManager'),
    getExport('db://assets/scripts/ui/HUD.ts', 'HUD'),
    getExport('db://assets/scripts/wenxin/WenxinManager.ts', 'WenxinManager'),
    getExport('db://assets/scripts/wenxin/WenxinUI.ts', 'WenxinUI'),
    getExport('db://assets/scripts/progression/LevelUpUI.ts', 'LevelUpUI'),
    getExport('db://assets/scripts/ui/GameOverUI.ts', 'GameOverUI'),
  ]);

  const removeIfExists = (parent, name) => {
    const existing = parent.getChildByName(name);
    if (existing) existing.destroy();
  };

  const makeNode = (name, parent) => {
    const node = new Node(name);
    parent.addChild(node);
    return node;
  };

  const addUITransform = (node, width, height) => {
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height);
    return transform;
  };

  const addWidgetFull = (node) => {
    const widget = node.addComponent(Widget);
    widget.isAlignLeft = true;
    widget.isAlignRight = true;
    widget.isAlignTop = true;
    widget.isAlignBottom = true;
    widget.left = 0;
    widget.right = 0;
    widget.top = 0;
    widget.bottom = 0;
    widget.alignMode = Widget.AlignMode.ALWAYS;
    return widget;
  };

  const addLabel = (parent, text, y, size = 28) => {
    const node = makeNode(text, parent);
    addUITransform(node, 560, 48);
    node.setPosition(0, y, 0);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = Math.round(size * 1.2);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.color = new Color(235, 232, 220, 255);
    return node;
  };

  for (const name of ['Canvas', 'GameRoot', 'Main Camera', 'Main Light']) {
    removeIfExists(scene, name);
  }

  const visible = view.getVisibleSize();
  const width = Math.max(720, Math.round(visible.width || 720));
  const height = Math.max(1280, Math.round(visible.height || 1280));

  const canvas = makeNode('Canvas', scene);
  addUITransform(canvas, width, height);
  canvas.addComponent(Canvas);
  addWidgetFull(canvas);

  const cameraNode = makeNode('UICamera', canvas);
  cameraNode.setPosition(0, 0, 1000);
  const camera = cameraNode.addComponent(Camera);
  camera.projection = Camera.ProjectionType.ORTHO;
  camera.orthoHeight = height / 2;
  canvas.getComponent(Canvas).cameraComponent = camera;

  const gameRoot = makeNode('GameRoot', canvas);
  addUITransform(gameRoot, width, height);
  gameRoot.addComponent(GameEntry);
  gameRoot.addComponent(GameManager);
  gameRoot.addComponent(WenxinManager);

  const map = makeNode('Map', canvas);
  addUITransform(map, width, height);
  map.addComponent(MapManager);

  const player = makeNode('Player', canvas);
  addUITransform(player, 46, 46);
  player.setPosition(0, 0, 0);
  const playerSprite = player.addComponent(Sprite);
  playerSprite.color = new Color(80, 220, 160, 255);
  const playerBody = player.addComponent(RigidBody2D);
  playerBody.type = ERigidBody2DType.Kinematic;
  const playerCollider = player.addComponent(CircleCollider2D);
  playerCollider.radius = 23;
  player.addComponent(PlayerController);
  player.addComponent(WeaponSystem);

  const enemies = makeNode('Enemies', canvas);
  addUITransform(enemies, width, height);
  const spawner = enemies.addComponent(EnemySpawner);
  spawner.playerNode = player;

  const enemyPrefabRoot = makeNode('EnemyPrefabTemplate', enemies);
  enemyPrefabRoot.active = false;
  addUITransform(enemyPrefabRoot, 38, 38);
  enemyPrefabRoot.addComponent(Sprite).color = new Color(210, 70, 70, 255);
  const enemyBody = enemyPrefabRoot.addComponent(RigidBody2D);
  enemyBody.type = ERigidBody2DType.Kinematic;
  const enemyCollider = enemyPrefabRoot.addComponent(BoxCollider2D);
  enemyCollider.size = new cc.Size(38, 38);

  const ui = makeNode('UI', canvas);
  addUITransform(ui, width, height);

  const hud = makeNode('HUD', ui);
  addUITransform(hud, width, height);
  hud.addComponent(HUD);

  const wenxinUI = makeNode('WenxinUI', ui);
  addUITransform(wenxinUI, width, height);
  wenxinUI.addComponent(WenxinUI);
  wenxinUI.active = false;

  const levelUpUI = makeNode('LevelUpUI', ui);
  addUITransform(levelUpUI, width, height);
  levelUpUI.addComponent(LevelUpUI);
  levelUpUI.active = false;

  const gameOverUI = makeNode('GameOverUI', ui);
  addUITransform(gameOverUI, width, height);
  gameOverUI.addComponent(GameOverUI);
  gameOverUI.active = false;

  const hint = makeNode('SceneReadyHint', ui);
  addUITransform(hint, 640, 150);
  hint.setPosition(0, -height / 2 + 120, 0);
  addLabel(hint, 'Scene generated. Save as assets/scenes/main.scene', 25, 24);
  addLabel(hint, 'Then press Preview to test the game loop.', -25, 22);

  console.log('[daozhe-survivor] Main scene hierarchy generated.');
  console.log('[daozhe-survivor] Save this scene as assets/scenes/main.scene.');
})();
