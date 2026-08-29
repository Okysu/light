import type { StorageAdapter } from '../storage'
import { CANVAS_VERSION, createEmptyCanvas, type CanvasDoc, type Shape, type ShapeKind } from './types'

const KINDS: ReadonlySet<string> = new Set<ShapeKind>([
  'rect',
  'ellipse',
  'line',
  'arrow',
  'text',
  'note',
  'draw',
  'noteRef',
  'imageRef',
  'boardCardRef',
])

/**
 * 画板文件的读写（模块 4）。
 *
 * 与看板同一条原则：读取时永远归一化。画板文件更容易出问题——它可能被
 * 旧版本写过，也可能被用户手工编辑过，而一个坏掉的图元不该让整张画布打不开。
 * 认不出来的图元直接丢弃（而不是补默认值）：一个类型未知的东西，
 * 补出来的默认值只会是个莫名其妙的方块。
 */
export class CanvasService {
  constructor(private readonly storage: StorageAdapter) {}

  async read(path: string): Promise<CanvasDoc> {
    try {
      return this.normalize(JSON.parse(await this.storage.readText(path)))
    } catch {
      return createEmptyCanvas()
    }
  }

  async write(path: string, doc: CanvasDoc): Promise<void> {
    await this.storage.writeText(path, JSON.stringify(doc, null, 2))
  }

  normalize(input: unknown): CanvasDoc {
    const raw = (input ?? {}) as Partial<CanvasDoc>
    const shapes = Array.isArray(raw.shapes) ? raw.shapes : []

    return {
      version: CANVAS_VERSION,
      kind: 'canvas',
      shapes: shapes.filter((shape): shape is Shape => this.isValidShape(shape)).map((shape) => normalizeShape(shape)),
    }
  }

  private isValidShape(shape: unknown): boolean {
    const value = shape as Partial<Shape>
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof value.id === 'string' &&
      typeof value.kind === 'string' &&
      KINDS.has(value.kind)
    )
  }
}

/** 逐字段兜底，缺什么补什么——坐标缺失比图元丢失好办 */
function normalizeShape(shape: Shape): Shape {
  const base = {
    id: shape.id,
    kind: shape.kind,
    x: number(shape.x),
    y: number(shape.y),
    width: number(shape.width),
    height: number(shape.height),
    stroke: typeof shape.stroke === 'string' ? shape.stroke : 'var(--foreground)',
    fill: typeof shape.fill === 'string' ? shape.fill : '',
    strokeWidth: number(shape.strokeWidth, 2),
    locked: shape.locked === true,
    groupId: typeof shape.groupId === 'string' ? shape.groupId : '',
  }

  switch (shape.kind) {
    case 'line':
    case 'arrow':
      return {
        ...base,
        kind: shape.kind,
        from: point(shape.from),
        to: point(shape.to),
        fromId: typeof shape.fromId === 'string' ? shape.fromId : '',
        toId: typeof shape.toId === 'string' ? shape.toId : '',
      }

    case 'draw':
      return {
        ...base,
        kind: 'draw',
        points: Array.isArray(shape.points) ? shape.points.map(point) : [],
      }

    case 'text':
      return {
        ...base,
        kind: 'text',
        text: typeof shape.text === 'string' ? shape.text : '',
        fontSize: number(shape.fontSize, 16),
      }

    case 'noteRef':
      return { ...base, kind: 'noteRef', path: typeof shape.path === 'string' ? shape.path : '' }

    case 'imageRef':
      return {
        ...base,
        kind: 'imageRef',
        src: typeof shape.src === 'string' ? shape.src : '',
        alt: typeof shape.alt === 'string' ? shape.alt : '',
      }

    case 'boardCardRef':
      return {
        ...base,
        kind: 'boardCardRef',
        boardPath: typeof shape.boardPath === 'string' ? shape.boardPath : '',
        cardId: typeof shape.cardId === 'string' ? shape.cardId : '',
        title: typeof shape.title === 'string' ? shape.title : '',
      }

    default:
      return { ...base, kind: shape.kind, text: typeof shape.text === 'string' ? shape.text : '' }
  }
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function point(value: unknown): { x: number; y: number } {
  const raw = (value ?? {}) as { x?: unknown; y?: unknown }
  return { x: number(raw.x), y: number(raw.y) }
}
