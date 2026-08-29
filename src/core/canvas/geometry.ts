import { isLine, type Point, type Shape } from './types'

/**
 * 画板的几何计算（模块 4）。
 *
 * 全是纯函数：视口变换、包围盒、连线锚点——这几件事一旦算错，
 * 表现是「点不中图形」「线连歪了」「缩放后图跑偏」，用户只会觉得画板不好用，
 * 却说不出哪里不对。因此它们值得脱离 DOM 被逐条测住。
 */

/** 视口：把画布坐标映射到屏幕的缩放与平移 */
export interface Viewport {
  /** 画布原点在屏幕上的偏移（像素） */
  x: number
  y: number
  scale: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 5

export function createViewport(): Viewport {
  return { x: 0, y: 0, scale: 1 }
}

/** 屏幕坐标 → 画布坐标 */
export function toCanvas(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  }
}

/** 画布坐标 → 屏幕坐标 */
export function toScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  }
}

/**
 * 以某个屏幕点为锚缩放。
 *
 * 锚点必须在缩放前后落在同一个画布位置上——否则用滚轮放大时，
 * 光标下的内容会飘走，那是最影响手感的一种错。
 */
export function zoomAt(viewport: Viewport, anchor: Point, factor: number): Viewport {
  const scale = clamp(viewport.scale * factor, MIN_SCALE, MAX_SCALE)
  // 实际生效的比例可能被夹住，位移要按它算，不能按传入的 factor
  const applied = scale / viewport.scale

  return {
    scale,
    x: anchor.x - (anchor.x - viewport.x) * applied,
    y: anchor.y - (anchor.y - viewport.y) * applied,
  }
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** 图形的包围盒。线与手绘要按实际点算，它们的 x/y/width/height 只是缓存 */
export function boundsOf(shape: Shape): Box {
  if (isLine(shape)) {
    const x = Math.min(shape.from.x, shape.to.x)
    const y = Math.min(shape.from.y, shape.to.y)
    return {
      x,
      y,
      width: Math.abs(shape.to.x - shape.from.x),
      height: Math.abs(shape.to.y - shape.from.y),
    }
  }

  if (shape.kind === 'draw' && shape.points.length > 0) {
    const xs = shape.points.map((point) => point.x)
    const ys = shape.points.map((point) => point.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }

  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
}

/** 一组图形的总包围盒；空集合返回 null 而不是零尺寸盒子 */
export function boundsOfAll(shapes: readonly Shape[]): Box | null {
  if (shapes.length === 0) return null

  const boxes = shapes.map(boundsOf)
  const x = Math.min(...boxes.map((box) => box.x))
  const y = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))

  return { x, y, width: right - x, height: bottom - y }
}

/** 矩形是否与选择框相交。用相交而不是包含：框选时擦到就该选中 */
export function intersects(a: Box, b: Box): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y)
}

/** 归一化拖出来的框：往左上拖时宽高会是负数 */
export function normalizeBox(from: Point, to: Point): Box {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  }
}

/**
 * 连线的锚点（4.4）：从图形中心朝目标方向，落在包围盒边界上。
 *
 * 不用固定的四个锚点：那样斜着连的线会有一截穿进图形里。
 * 从中心射线求交点，线永远停在边上。
 */
export function anchorOn(box: Box, toward: Point): Point {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  const dx = toward.x - cx
  const dy = toward.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }

  const halfW = box.width / 2
  const halfH = box.height / 2

  // 比较横竖两个方向到达边界所需的比例，取先撞上的那条边
  const scaleX = halfW === 0 ? Infinity : Math.abs(halfW / dx)
  const scaleY = halfH === 0 ? Infinity : Math.abs(halfH / dy)
  const t = Math.min(scaleX, scaleY)

  return { x: cx + dx * t, y: cy + dy * t }
}

/** 手绘点串转 SVG 路径。点太少时退化成一个点，避免产出非法路径 */
export function pointsToPath(points: readonly Point[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const only = points[0]!
    return `M ${only.x} ${only.y} L ${only.x} ${only.y}`
  }

  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

/**
 * 简化手绘轨迹：丢掉与前一点距离过近的采样。
 *
 * 不做的话，一条短线也会存下几百个点——文件体积、渲染开销、
 * 以及后续的包围盒计算都白白变重。
 */
export function simplifyPoints(points: readonly Point[], tolerance = 1.5): Point[] {
  if (points.length <= 2) return [...points]

  const result: Point[] = [points[0]!]
  for (const point of points.slice(1, -1)) {
    const last = result[result.length - 1]!
    if (Math.hypot(point.x - last.x, point.y - last.y) >= tolerance) result.push(point)
  }
  result.push(points[points.length - 1]!)

  return result
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
