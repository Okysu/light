/**
 * 画板的数据结构（模块 4）。
 *
 * 落盘为 `.canvas` 的 JSON。所有坐标都是**画布坐标**（世界坐标），
 * 与视口的缩放平移无关——否则换台屏幕打开，图就散了。
 *
 * 选型理由见 ADR-0002。
 */

export type ShapeKind =
  | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'note' | 'draw'
  | 'noteRef' | 'imageRef' | 'boardCardRef'

export interface Point {
  x: number
  y: number
}

interface ShapeBase {
  id: string
  kind: ShapeKind
  x: number
  y: number
  width: number
  height: number
  /** 描边色，取自主题变量名（如 `--foreground`）或具体色值 */
  stroke: string
  /** 填充色；空串表示不填充 */
  fill: string
  strokeWidth: number
  /** 锁定后不可选中与拖动（4.6 的一部分） */
  locked: boolean
  /** 空串表示未分组；同一非空 ID 的图元作为一个选择与移动单元。 */
  groupId: string
}

export interface RectShape extends ShapeBase {
  kind: 'rect'
  text: string
}

export interface EllipseShape extends ShapeBase {
  kind: 'ellipse'
  text: string
}

/** 线与箭头：起止点相对于 x/y，便于整体拖动 */
export interface LineShape extends ShapeBase {
  kind: 'line' | 'arrow'
  /** 起点与终点在画布坐标系中的绝对位置 */
  from: Point
  to: Point
  /** 连接的图形 id；有值时端点跟随该图形移动（4.4） */
  fromId: string
  toId: string
}

export interface TextShape extends ShapeBase {
  kind: 'text'
  text: string
  fontSize: number
}

/** 便利贴：带底色的文本块 */
export interface NoteShape extends ShapeBase {
  kind: 'note'
  text: string
}

/** 手绘（4.3）：一串画布坐标点 */
export interface DrawShape extends ShapeBase {
  kind: 'draw'
  points: Point[]
}

/** 嵌入的笔记卡片（4.5）：只存路径，内容始终以文件为准 */
export interface NoteRefShape extends ShapeBase {
  kind: 'noteRef'
  path: string
}

/** 图片仍存附件相对路径，画板 JSON 不复制二进制。 */
export interface ImageRefShape extends ShapeBase {
  kind: 'imageRef'
  src: string
  alt: string
}

/** 看板卡片引用：路径与 id 是真引用，标题只用于离线/断链时的可读降级。 */
export interface BoardCardRefShape extends ShapeBase {
  kind: 'boardCardRef'
  boardPath: string
  cardId: string
  title: string
}

export type Shape =
  | RectShape
  | EllipseShape
  | LineShape
  | TextShape
  | NoteShape
  | DrawShape
  | NoteRefShape
  | ImageRefShape
  | BoardCardRefShape

export interface CanvasDoc {
  version: 1
  kind: 'canvas'
  shapes: Shape[]
}

export const CANVAS_VERSION = 1

export function createEmptyCanvas(): CanvasDoc {
  return { version: CANVAS_VERSION, kind: 'canvas', shapes: [] }
}

/** 带文本的图形类型，界面据此决定要不要显示文本编辑入口 */
export function hasText(shape: Shape): shape is RectShape | EllipseShape | TextShape | NoteShape {
  return shape.kind === 'rect' || shape.kind === 'ellipse' || shape.kind === 'text' || shape.kind === 'note'
}

export function isLine(shape: Shape): shape is LineShape {
  return shape.kind === 'line' || shape.kind === 'arrow'
}
