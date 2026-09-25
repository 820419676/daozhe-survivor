// ============================================================
// WxManager —— 微信小游戏平台 API 封装（Component 单例）
// ------------------------------------------------------------
// 职责：
//   1. 环境检测：微信小游戏环境使用 wx. 原生 API，
//      非微信环境（浏览器 / 编辑器预览 / 开发工具）全部降级为
//      console.log + Promise.resolve（便于本地开发与自动化测试）
//   2. login()        - 微信登录
//   3. storage()      - 数据存储（好友排行榜 / 云存储）
//   4. share()        - 分享（主动 / 被动）
//   5. advertisement() - 激励视频广告
//   6. payment()      - 微信支付（预留接口）
//
// 约定：
//   游戏代码中禁止直接调用 wx.xxx，所有微信平台交互
//   必须通过本组件的方法完成。
//
// 用法：
//   // 在场景节点上挂载 WxManager 组件
//   const wxMgr = node.getComponent(WxManager);
//   // 或通过全局单例
//   const wxMgr = WxManager.getInstance();
//   const code = await wxMgr.login();
//   const ok = await wxMgr.showRewardedAd('adunit-xxx');
// ============================================================

import { _decorator, Component, log, warn } from 'cc';

const { ccclass } = _decorator;

/** 微信小游戏全局对象（仅微信小游戏环境存在；此处声明便于 TypeScript 编译） */
declare const wx: any;

@ccclass('WxManager')
export class WxManager extends Component {
    /** 全局单例（Component 挂载后自动注册） */
    private static instance: WxManager | null = null;

    /** 是否为微信小游戏环境 */
    private isWx: boolean = false;
    /** 已创建的激励视频广告缓存（adUnitId → RewardedVideoAd 实例） */
    private rewardedAds = new Map<string, any>();

    /** 获取全局唯一实例（需场景中已挂载本组件） */
    static getInstance(): WxManager | null {
        return WxManager.instance;
    }

    // ============================================================
    // 生命周期
    // ============================================================

    onLoad(): void {
        if (WxManager.instance && WxManager.instance !== this) {
            warn('[WxManager] 场景中存在多个 WxManager 实例，保留第一个');
            this.node.destroy();
            return;
        }
        WxManager.instance = this;
        this.init();
    }

    onDestroy(): void {
        if (WxManager.instance === this) {
            WxManager.instance = null;
        }
    }

    // ============================================================
    // 初始化与环境检测
    // ============================================================

    /** 初始化：检测当前是否微信小游戏环境 */
    init(): void {
        this.isWx = typeof wx !== 'undefined';
        if (this.isWx) {
            log('[WxManager] 微信小游戏环境，平台 API 生效');
        } else {
            log('[WxManager] 非微信环境，所有平台 API 降级为本地模拟');
        }
    }

    /** 是否微信小游戏环境 */
    isWechat(): boolean {
        return this.isWx;
    }

    // ============================================================
    // login() —— 微信登录
    // ============================================================

    /**
     * 微信登录：返回 wx.login 的 code（一次性凭证），
     * 服务端持 code 调用 code2session 换取 openid / session_key。
     * @returns Promise<string>：code（非微信环境返回 'dev-user' 测试标识）
     */
    login(): Promise<string> {
        if (!this.isWx) {
            log('[WxManager][模拟] 登录成功（开发用户）');
            return Promise.resolve('dev-user');
        }
        return new Promise<string>((resolve, reject) => {
            try {
                wx.login({
                    success: (res: any) => resolve(res && res.code ? res.code : ''),
                    fail: (err: any) => {
                        console.error('[WxManager] 登录失败：', err);
                        reject(err);
                    },
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    // ============================================================
    // storage() —— 数据存储（好友排行榜 / 云存储）
    // ============================================================

    /**
     * 打开好友排行榜（由开放数据域渲染）
     * @param key 榜单键（如 'courage'），与 uploadScore 一致
     */
    showFriendRanking(key: string): void {
        if (!this.isWx) {
            log(`[WxManager][模拟] 打开好友榜：${key}`);
            return;
        }
        try {
            const openCtx = wx.getOpenDataContext();
            openCtx.postMessage({ type: 'showRanking', key });
        } catch (e) {
            console.error('[WxManager] 打开排行榜失败：', e);
        }
    }

    /**
     * 上传分数到好友榜（如道心值）
     * @param key   榜单键
     * @param score 分数（数字）
     * @returns 是否上传成功
     */
    uploadScore(key: string, score: number): Promise<boolean> {
        if (!this.isWx) {
            log(`[WxManager][模拟] 上报分数：${key} = ${score}`);
            return Promise.resolve(true);
        }
        return new Promise<boolean>((resolve) => {
            try {
                wx.setUserCloudStorage({
                    KVDataList: [{ key, value: String(Math.floor(score)) }],
                    success: () => resolve(true),
                    fail: (err: any) => {
                        console.error('[WxManager] 上报分数失败：', err);
                        resolve(false);
                    },
                });
            } catch (e) {
                console.error('[WxManager] 上报分数异常：', e);
                resolve(false);
            }
        });
    }

    /**
     * 本地存储写入（wx.setStorageSync / localStorage 降级）
     * @param key   存储键
     * @param value 存储值
     */
    setStorage(key: string, value: any): void {
        if (!this.isWx) {
            try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* ignore */ }
            return;
        }
        try {
            wx.setStorageSync(key, value);
        } catch (e) {
            console.error('[WxManager] setStorage 失败：', e);
        }
    }

    /**
     * 本地存储读取（wx.getStorageSync / localStorage 降级）
     * @param key 存储键
     * @returns 存储值（不存在返回 null）
     */
    getStorage(key: string): any {
        if (!this.isWx) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch (_) {
                return null;
            }
        }
        try {
            return wx.getStorageSync(key) ?? null;
        } catch (e) {
            console.error('[WxManager] getStorage 失败：', e);
            return null;
        }
    }

    // ============================================================
    // share() —— 分享（战绩卡 / 自嘲卡）
    // ============================================================

    /**
     * 主动分享（必须由用户点击触发）
     * @param title    分享标题（如「我渡过了 15 分钟天劫！」）
     * @param imageUrl 分享图（战绩卡 / 自嘲卡路径，可选）
     * @returns 是否分享成功
     */
    share(title: string, imageUrl?: string): Promise<boolean> {
        if (!this.isWx) {
            log(`[WxManager][模拟] 分享：${title}`);
            return Promise.resolve(true);
        }
        return new Promise<boolean>((resolve) => {
            try {
                wx.shareAppMessage({
                    title,
                    imageUrl,
                    success: () => resolve(true),
                    fail: (err: any) => {
                        console.error('[WxManager] 分享失败：', err);
                        resolve(false);
                    },
                });
            } catch (e) {
                console.error('[WxManager] 分享异常：', e);
                resolve(false);
            }
        });
    }

    /**
     * 配置被动分享（右上角「...」菜单分享，无需用户主动点击）
     * @param title    分享标题
     * @param imageUrl 分享图（可选）
     */
    setupPassiveShare(title: string, imageUrl?: string): void {
        if (!this.isWx) {
            log(`[WxManager][模拟] 配置被动分享：${title}`);
            return;
        }
        try {
            wx.onShareAppMessage(() => ({ title, imageUrl }));
            wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'] });
        } catch (e) {
            console.error('[WxManager] 配置被动分享失败：', e);
        }
    }

    // ============================================================
    // advertisement() —— 激励视频广告
    // ============================================================

    /**
     * 展示激励视频广告
     * @param adUnitId 广告位 ID（微信公众平台申请）
     * @returns Promise<boolean>：是否完整观看（isEnded）。
     *          - 非微信环境：直接 resolve(true)（开发测试通过）
     *          - 广告加载/展示失败：resolve(false)，不抛异常，保证游戏流程可收尾
     */
    showRewardedAd(adUnitId: string): Promise<boolean> {
        if (!this.isWx) {
            log(`[WxManager][模拟] 激励视频「${adUnitId}」，判定完整观看（测试）`);
            return Promise.resolve(true);
        }

        return new Promise<boolean>((resolve) => {
            let ad = this.rewardedAds.get(adUnitId);
            if (!ad) {
                ad = wx.createRewardedVideoAd({ adUnitId });
                this.rewardedAds.set(adUnitId, ad);
            }

            let settled = false;
            const settle = (value: boolean) => {
                if (settled) return;
                settled = true;
                ad.offClose(onClose);
                ad.offError(onError);
                resolve(value);
            };

            // 关闭回调：res.isEnded = 是否完整观看（旧版本可能无 res，视为完整）
            const onClose = (res: any) => {
                const finished = !res || res.isEnded === true;
                settle(finished);
            };
            // 错误回调：加载/播放异常
            const onError = (err: any) => {
                console.error(`[WxManager] 激励视频「${adUnitId}」错误：`, err);
                settle(false);
            };
            ad.onClose(onClose);
            ad.onError(onError);

            // 预加载后展示；show 失败（未就绪）时重试一次
            const tryShow = () => {
                ad.load()
                    .catch(() => { /* load 失败交给 onError */ })
                    .then(() => ad.show())
                    .catch(() => {
                        ad.load()
                            .catch(() => {})
                            .then(() => ad.show())
                            .catch(() => { /* 重试失败，等待 onError 兜底 */ });
                    });
            };
            tryShow();

            // 兜底超时：10 秒仍无回调（如用户挂机不关广告）则判定失败，防止流程卡死
            setTimeout(() => settle(false), 10000);
        });
    }

    // ============================================================
    // payment() —— 微信支付（预留接口）
    // ============================================================

    /**
     * 微信支付（预留接口，实际接入需服务端配合统一下单）
     * @param orderId   订单 ID（服务端生成）
     * @param productId 商品 ID
     * @returns Promise<boolean>：是否支付成功
     */
    payment(orderId: string, productId: string): Promise<boolean> {
        if (!this.isWx) {
            log(`[WxManager][模拟] 支付：订单=${orderId}，商品=${productId}（测试通过）`);
            return Promise.resolve(true);
        }
        return new Promise<boolean>((resolve) => {
            try {
                wx.requestMidasPayment({
                    mode: 'game',
                    offerId: '', // 需替换为实际 offerId
                    currency: 'CNY',
                    platform: 'android',
                    buyQuantity: 1,
                    env: 0,
                    success: () => resolve(true),
                    fail: (err: any) => {
                        console.error('[WxManager] 支付失败：', err);
                        resolve(false);
                    },
                });
            } catch (e) {
                console.error('[WxManager] 支付异常：', e);
                resolve(false);
            }
        });
    }

    // ============================================================
    // 订阅消息（事件触发型一次性订阅）
    // ============================================================

    /**
     * 请求一次性订阅消息授权（如「问心失败」后推送激励）
     * @param tmplIds 模板 ID 列表（微信公众平台申请，一次性订阅）
     * @returns Promise<void>：成功 resolve；用户拒绝 / 失败 reject
     */
    requestSubscribeMessage(tmplIds: string[]): Promise<void> {
        if (!this.isWx) {
            log(`[WxManager][模拟] 订阅消息：${tmplIds.join(', ')}`);
            return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
            try {
                wx.requestSubscribeMessage({
                    tmplIds,
                    success: () => resolve(),
                    fail: (err: any) => {
                        console.error('[WxManager] 订阅消息失败：', err);
                        reject(err);
                    },
                });
            } catch (e) {
                reject(e);
            }
        });
    }
}
