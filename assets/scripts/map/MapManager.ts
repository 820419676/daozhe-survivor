// ============================================================
// MapManager —— 地图管理（单张「修道场」地图 2000×2000）
// ------------------------------------------------------------
// 职责：
//   1. 边界定义：矩形区域 2000×2000（以世界原点为中心，±1000）
//   2. 边界查询 / 钳制：getBounds / isInBounds / clampToBounds
//   3. 简单背景绘制：深绿 → 深蓝 纵向渐变（Graphics 纯代码，无美术资源）
//
// 挂载：地图根节点（世界坐标原点处），全场景唯一。
// 注意：PlayerController.clampToMap 默认 ±1800 与本地图不匹配，
// 建议将玩家节点上的 mapHalfWidth / mapHalfHeight 改为 1000，
// 或直接调用 MapManager.clampToBounds 统一边界。
// ============================================================

import { _decorator, Component, Graphics, Color, Node, Vec3 } from 'cc';
import { hexColor } from '../core/UIUtils';
import { GameEntry } from '../core/GameEntry';

const { ccclass, property } = _decorator;

/** 地图尺寸（宽 / 高，px） */
export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 2000;
export const MAP_HALF_WIDTH = MAP_WIDTH / 2;
export const MAP_HALF_HEIGHT = MAP_HEIGHT / 2;

/** 地图矩形边界 */
export interface MapBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/** 颜色线性插值（渐变条带用） */
function lerpColor(a: Color, b: Color, t: number): Color {
    return new Color(
        Math.round(a.r + (b.r - a.r) * t),
        Math.round(a.g + (b.g - a.g) * t),
        Math.round(a.b + (b.b - a.b) * t),
        255,
    );
}

@ccclass('MapManager')
export class MapManager extends Component {
    private static instance: MapManager | null = null;

    /** 地图半宽（可覆盖默认值做子区域缩水 / 调试） */
    @property({ tooltip: '地图半宽（px），默认 1000（2000×2000 修道场）' })
    halfWidth: number = MAP_HALF_WIDTH;
    /** 地图半高 */
    @property({ tooltip: '地图半高（px），默认 1000' })
    halfHeight: number = MAP_HALF_HEIGHT;

    /** 渐变条带数量（背景绘制） */
    private readonly GRADIENT_BANDS = 16;

    static getInstance(): MapManager | null {
        return MapManager.instance;
    }

    onLoad() {
        MapManager.instance = this;
    }

    start() {
        // 地图以世界原点为中心；背景绘制前强制归位并垫底
        this.node.setPosition(0, 0, 0);
        if (this.node.parent) this.node.setSiblingIndex(0);
        this.drawBackground();

        // 场景已经能显示地图却遗漏启动器时，自动补齐 MVP 入口。
        // 这样旧的手工场景也无需再逐个挂载 HUD、刷怪器与战斗系统。
        const canvas = this.node.parent;
        if (canvas && !canvas.getComponent(GameEntry)) {
            console.log('[MapManager] GameEntry missing; adding MVP bootstrap automatically.');
            canvas.addComponent(GameEntry);
        }
    }

    onDestroy() {
        if (MapManager.instance === this) {
            MapManager.instance = null;
        }
    }

    // ============================================================
    // 边界查询 / 钳制
    // ============================================================

    /** 获取地图边界 */
    getBounds(): MapBounds {
        return {
            minX: -this.halfWidth,
            maxX: this.halfWidth,
            minY: -this.halfHeight,
            maxY: this.halfHeight,
        };
    }

    /** 点是否在地图内（pos 支持 Vec3 / 任意 { x, y } 结构） */
    isInBounds(pos: { x: number; y: number }): boolean {
        const b = this.getBounds();
        return pos.x >= b.minX && pos.x <= b.maxX && pos.y >= b.minY && pos.y <= b.maxY;
    }

    /** 钳制坐标到地图内（返回新 Vec3，不修改入参） */
    clampToBounds(pos: Vec3): Vec3 {
        const b = this.getBounds();
        return new Vec3(
            Math.min(Math.max(pos.x, b.minX), b.maxX),
            Math.min(Math.max(pos.y, b.minY), b.maxY),
            pos.z,
        );
    }

    // ---- 静态便捷接口（无需实例引用也可使用；存在实例时委托给实例） ----

    static getBounds(): MapBounds {
        if (MapManager.instance) return MapManager.instance.getBounds();
        return {
            minX: -MAP_HALF_WIDTH, maxX: MAP_HALF_WIDTH,
            minY: -MAP_HALF_HEIGHT, maxY: MAP_HALF_HEIGHT,
        };
    }

    static isInBounds(pos: { x: number; y: number }): boolean {
        if (MapManager.instance) return MapManager.instance.isInBounds(pos);
        return pos.x >= -MAP_HALF_WIDTH && pos.x <= MAP_HALF_WIDTH
            && pos.y >= -MAP_HALF_HEIGHT && pos.y <= MAP_HALF_HEIGHT;
    }

    static clampToBounds(pos: Vec3): Vec3 {
        if (MapManager.instance) return MapManager.instance.clampToBounds(pos);
        return pos.clone();
    }

    // ============================================================
    // 背景绘制（深绿 → 深蓝 渐变 + 边界描边）
    // ============================================================

    private drawBackground(): void {
        let g = this.node.getComponent(Graphics);
        if (!g) g = this.node.addComponent(Graphics);
        g.clear();

        const W = this.halfWidth * 2;
        const H = this.halfHeight * 2;
        const bandH = H / this.GRADIENT_BANDS;

        // 渐变端点：顶部深绿 → 底部深蓝（修道场山林夜色意象）
        const topColor = hexColor('#0B3B2A');
        const bottomColor = hexColor('#081B38');

        for (let i = 0; i < this.GRADIENT_BANDS; i++) {
            const t = i / (this.GRADIENT_BANDS - 1); // 0（顶）→ 1（底）
            g.fillColor = lerpColor(topColor, bottomColor, t);
            const y = this.halfHeight - (i + 1) * bandH; // 当前条带底边
            g.rect(-this.halfWidth, y, W, bandH);
            g.fill();
        }

        // 边界描边（修道场围墙意象）
        g.lineWidth = 8;
        g.strokeColor = hexColor('#2E7D32', 160);
        g.roundRect(-this.halfWidth, -this.halfHeight, W, H, 24);
        g.stroke();
    }
}
