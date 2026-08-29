import { describe, expect, it } from 'vitest'
import {
  anchorOn,
  boundsOf,
  boundsOfAll,
  createViewport,
  intersects,
  normalizeBox,
  pointsToPath,
  simplifyPoints,
  toCanvas,
  toScreen,
  zoomAt,
  MAX_SCALE,
  MIN_SCALE,
} from './geometry'
import type { DrawShape, LineShape, RectShape, Shape } from './types'

function rect(patch: Partial<RectShape> = {}): RectShape {
  return {
    id: 'r1',
    kind: 'rect',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    stroke: '#000',
    fill: '',
    strokeWidth: 1,
    locked: false,
    groupId: '',
    text: '',
    ...patch,
  }
}

describe('坐标变换', () => {
  const viewport = { x: 100, y: 50, scale: 2 }

  it('屏幕与画布互为逆变换', () => {
    const point = { x: 37, y: -12 }
    expect(toCanvas(toScreen(point, viewport), viewport)).toEqual(point)
  })

  it('默认视口是恒等变换', () => {
    const identity = createViewport()
    expect(toCanvas({ x: 5, y: 7 }, identity)).toEqual({ x: 5, y: 7 })
  })
})

describe('zoomAt', () => {
  /**
   * 锚点必须在缩放前后落在同一个画布位置上。
   * 不满足的话，用滚轮放大时光标下的内容会飘走——最影响手感的一种错。
   */
  it('锚点下的画布位置不变', () => {
    const viewport = { x: 30, y: 40, scale: 1 }
    const anchor = { x: 200, y: 150 }

    const before = toCanvas(anchor, viewport)
    const after = toCanvas(anchor, zoomAt(viewport, anchor, 1.5))

    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('缩放被夹在上下限内', () => {
    const viewport = { x: 0, y: 0, scale: 1 }
    expect(zoomAt(viewport, { x: 0, y: 0 }, 100).scale).toBe(MAX_SCALE)
    expect(zoomAt(viewport, { x: 0, y: 0 }, 0.001).scale).toBe(MIN_SCALE)
  })

  /** 比例被夹住时，位移必须按**实际生效**的比例算，否则会跳一下 */
  it('触到上限时锚点依然稳定', () => {
    const viewport = { x: 30, y: 40, scale: MAX_SCALE }
    const anchor = { x: 200, y: 150 }

    const before = toCanvas(anchor, viewport)
    const after = toCanvas(anchor, zoomAt(viewport, anchor, 3))

    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })
})

describe('boundsOf', () => {
  it('矩形直接用自身尺寸', () => {
    expect(boundsOf(rect())).toEqual({ x: 10, y: 20, width: 100, height: 50 })
  })

  /** 线的 x/y/width/height 只是缓存，实际范围要按端点算 */
  it('线按端点算，且方向无关', () => {
    const line: LineShape = {
      ...rect(),
      kind: 'line',
      from: { x: 100, y: 200 },
      to: { x: 20, y: 40 },
      fromId: '',
      toId: '',
    }
    expect(boundsOf(line)).toEqual({ x: 20, y: 40, width: 80, height: 160 })
  })

  it('手绘按全部点算', () => {
    const draw: DrawShape = {
      ...rect(),
      kind: 'draw',
      points: [
        { x: 5, y: 5 },
        { x: 50, y: 80 },
        { x: 30, y: 10 },
      ],
    }
    expect(boundsOf(draw)).toEqual({ x: 5, y: 5, width: 45, height: 75 })
  })

  it('没有点的手绘退回自身尺寸而不是崩掉', () => {
    const draw: DrawShape = { ...rect(), kind: 'draw', points: [] }
    expect(boundsOf(draw)).toEqual({ x: 10, y: 20, width: 100, height: 50 })
  })
})

describe('boundsOfAll', () => {
  it('合并多个图形', () => {
    const shapes: Shape[] = [rect(), rect({ id: 'r2', x: 200, y: 0, width: 40, height: 300 })]
    expect(boundsOfAll(shapes)).toEqual({ x: 10, y: 0, width: 230, height: 300 })
  })

  it('空集合返回 null 而不是零尺寸盒子', () => {
    expect(boundsOfAll([])).toBeNull()
  })
})

describe('intersects', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 }

  /** 框选时擦到就该选中，因此用相交而不是包含 */
  it('部分重叠算相交', () => {
    expect(intersects(box, { x: 50, y: 50, width: 100, height: 100 })).toBe(true)
  })

  it('完全分离不算', () => {
    expect(intersects(box, { x: 200, y: 0, width: 10, height: 10 })).toBe(false)
  })

  it('边缘相接算相交', () => {
    expect(intersects(box, { x: 100, y: 0, width: 10, height: 10 })).toBe(true)
  })
})

describe('normalizeBox', () => {
  it('往右下拖', () => {
    expect(normalizeBox({ x: 10, y: 10 }, { x: 50, y: 40 })).toEqual({ x: 10, y: 10, width: 40, height: 30 })
  })

  /** 往左上拖时宽高会是负数，不归一化的话框就画不出来 */
  it('往左上拖同样得到正的宽高', () => {
    expect(normalizeBox({ x: 50, y: 40 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 40, height: 30 })
  })
})

describe('anchorOn', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 }

  it('正右方向落在右边中点', () => {
    expect(anchorOn(box, { x: 500, y: 50 })).toEqual({ x: 100, y: 50 })
  })

  it('正下方向落在底边中点', () => {
    expect(anchorOn(box, { x: 50, y: 500 })).toEqual({ x: 50, y: 100 })
  })

  /** 固定四锚点的话，斜着连的线会有一截穿进图形里 */
  it('斜方向落在边界上而不是角外', () => {
    const point = anchorOn(box, { x: 200, y: 100 })
    expect(point.x).toBeCloseTo(100, 6)
    expect(point.y).toBeLessThanOrEqual(100)
    expect(point.y).toBeGreaterThan(50)
  })

  it('目标就在中心时返回中心，不产生除零', () => {
    expect(anchorOn(box, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 })
  })
})

describe('pointsToPath', () => {
  it('多点连成折线', () => {
    expect(pointsToPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe('M 0 0 L 10 10')
  })

  /** 单点若只产出 M，SVG 画不出任何东西——用户点一下应当留下一个墨点 */
  it('单点退化成一个点而不是空路径', () => {
    expect(pointsToPath([{ x: 5, y: 5 }])).toBe('M 5 5 L 5 5')
  })

  it('空点串产出空字符串', () => {
    expect(pointsToPath([])).toBe('')
  })
})

describe('simplifyPoints', () => {
  it('丢掉过近的采样点', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
      { x: 0.4, y: 0 },
      { x: 50, y: 0 },
    ]
    expect(simplifyPoints(points)).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }])
  })

  /** 首尾必须保留，否则线会缩短，用户看得出来 */
  it('始终保留首尾两点', () => {
    const points = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }]
    const result = simplifyPoints(points)
    expect(result[0]).toEqual({ x: 0, y: 0 })
    expect(result.at(-1)).toEqual({ x: 0.2, y: 0 })
  })

  it('两点及以下原样返回', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    expect(simplifyPoints(points)).toEqual(points)
  })
})
