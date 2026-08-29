import { describe, expect, it } from 'vitest'
import { contextUnit, expandGroupedSelection, groupShapes, selectionUnit, ungroupShapes } from './groups'
import type { RectShape } from './types'

function shape(id: string, groupId = '', locked = false): RectShape {
  return {
    id, groupId, locked, kind: 'rect', x: 0, y: 0, width: 10, height: 10,
    stroke: '', fill: '', strokeWidth: 1, text: '',
  }
}

describe('画板分组', () => {
  it('点击成员选中完整未锁定分组', () => {
    const shapes = [shape('a', 'g'), shape('b', 'g'), shape('c', 'g', true), shape('d')]
    expect(selectionUnit(shapes, 'a')).toEqual(['a', 'b'])
    expect(selectionUnit(shapes, 'd')).toEqual(['d'])
    expect(selectionUnit(shapes, 'c')).toEqual([])
  })

  it('框选一个成员扩展整组并去重', () => {
    const shapes = [shape('a', 'g'), shape('b', 'g'), shape('c')]
    expect(expandGroupedSelection(shapes, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('右键包含锁定组员，允许完整解锁分组', () => {
    const shapes = [shape('a', 'g'), shape('b', 'g', true), shape('c')]
    expect(contextUnit(shapes, 'b')).toEqual(['a', 'b'])
  })

  it('至少两个图元才能形成新组', () => {
    const shapes = [shape('a'), shape('b'), shape('c', 'old')]
    expect(groupShapes(shapes, ['a'], 'new')).toEqual(shapes)
    expect(groupShapes(shapes, ['a', 'c'], 'new').map((item) => item.groupId)).toEqual(['new', '', 'new'])
  })

  it('解组选中成员所属的完整分组', () => {
    const shapes = [shape('a', 'g'), shape('b', 'g'), shape('c', 'other')]
    expect(ungroupShapes(shapes, ['a']).map((item) => item.groupId)).toEqual(['', '', 'other'])
  })
})
