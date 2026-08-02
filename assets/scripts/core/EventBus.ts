// ============================================================
// EventBus —— 全局事件总线（单例，实例方法 + 静态快捷方式）
// ------------------------------------------------------------
// 用法（事件名一律用 core/GameEvent 枚举，禁止裸字符串）：
//   // 实例式（推荐）
//   EventBus.getInstance().on(GameEvent.WENXIN_TRIGGER, this.handleX, this);
//   EventBus.getInstance().emit(GameEvent.WENXIN_RESULT, payload);
//   EventBus.getInstance().off(GameEvent.WENXIN_TRIGGER, this.handleX, this);
//
//   // 静态式（等价于 getInstance() 快捷调用）
//   EventBus.on(GameEvent.PLAYER_DIED, this.onPlayerDied, this);
//   EventBus.emit(GameEvent.ENEMY_KILLED, { type, node });
//   EventBus.off(GameEvent.PLAYER_DIED, this.onPlayerDied, this);
//
// 说明：on/off/emit 同时支持实例与静态两种调用形态；
// 回调带 target 绑定（组件销毁时用同一引用 off 即可安全退订）。
// GameEvent 枚举的权威定义在 core/GameEvent.ts，请勿在本模块复制。
// ============================================================

type Handler = (...args: any[]) => void;

interface Listener {
    handler: Handler;
    target: unknown;
}

export class EventBus {
    private static _instance: EventBus | null = null;

    private listeners: Map<string, Listener[]> = new Map();

    static getInstance(): EventBus {
        if (!EventBus._instance) {
            EventBus._instance = new EventBus();
        }
        return EventBus._instance;
    }

    /** 订阅事件（target 作为回调的 this） */
    on(event: string, handler: Handler, target?: unknown): void {
        let list = this.listeners.get(event);
        if (!list) {
            list = [];
            this.listeners.set(event, list);
        }
        list.push({ handler, target });
    }

    /** 取消订阅（需与注册时相同的 handler/target 引用） */
    off(event: string, handler: Handler, target?: unknown): void {
        const list = this.listeners.get(event);
        if (!list) return;
        for (let i = list.length - 1; i >= 0; i--) {
            const l = list[i];
            if (l.handler === handler && l.target === target) {
                list.splice(i, 1);
            }
        }
        if (list.length === 0) this.listeners.delete(event);
    }

    /** 广播事件 */
    emit(event: string, ...args: any[]): void {
        const list = this.listeners.get(event);
        if (!list) return;
        // 拷贝快照，防止回调中增删监听导致遍历异常
        const snapshot = list.slice();
        for (const l of snapshot) {
            l.handler.apply(l.target, args);
        }
    }

    /** 清空全部监听（场景切换时用） */
    clear(): void {
        this.listeners.clear();
    }

    // ==================== 静态快捷方式（等价于 getInstance().x） ====================

    static on(event: string, handler: Handler, target?: unknown): void {
        EventBus.getInstance().on(event, handler, target);
    }

    static off(event: string, handler: Handler, target?: unknown): void {
        EventBus.getInstance().off(event, handler, target);
    }

    static emit(event: string, ...args: any[]): void {
        EventBus.getInstance().emit(event, ...args);
    }
}
