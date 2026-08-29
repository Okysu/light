import { describe, expect, it } from 'vitest'
import { positionInScrollContainer } from './selection-position'

describe('选区工具条坐标换算', () => {
  it('把垂直滚动距离计入内容坐标，长图片和表格后不向上漂移', () => {
    expect(positionInScrollContainer(
      { left: 420, right: 620, top: 760 },
      { left: 100, top: 80 },
      0,
      900,
    )).toEqual({ left: 420, top: 1580 })
  })

  it('同时处理横向滚动', () => {
    expect(positionInScrollContainer(
      { left: 220, right: 320, top: 300 },
      { left: 20, top: 50 },
      120,
      40,
    )).toEqual({ left: 370, top: 290 })
  })
})
