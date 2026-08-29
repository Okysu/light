// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RectShape } from '@/core/canvas/types'
import { selectionUnit } from '@/core/canvas/groups'
import { useCanvasStore } from './canvas'
import { useWorkspaceStore } from './workspace'

function rect(id: string, x: number): RectShape {
  return {
    id,
    kind: 'rect',
    x,
    y: 10,
    width: 80,
    height: 50,
    stroke: '#111827',
    fill: '#ffffff',
    strokeWidth: 2,
    locked: false,
    groupId: '',
    text: '',
  }
}

describe('canvas store grouping', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('组合后按整体选择、移动和持久化，取消组合后恢复独立图元', async () => {
    const workspace = useWorkspaceStore()
    await workspace.open({ kind: 'memory' })
    const path = await workspace.createNote('', '分组测试', 'canvas')

    const canvas = useCanvasStore()
    await canvas.open(path)
    canvas.addShape(rect('a', 10))
    canvas.addShape(rect('b', 120))
    canvas.selectedIds = ['a', 'b']
    canvas.groupSelected()

    const groupId = canvas.shapes[0]?.groupId
    expect(groupId).toBeTruthy()
    expect(canvas.shapes.map((shape) => shape.groupId)).toEqual([groupId, groupId])

    canvas.selectedIds = selectionUnit(canvas.shapes, 'a')
    canvas.updateShapes(canvas.selected.map((shape) => ({ id: shape.id, patch: { x: shape.x + 25 } })))
    expect(canvas.shapes.map((shape) => shape.x)).toEqual([35, 145])

    canvas.ungroupSelected()
    expect(canvas.shapes.map((shape) => shape.groupId)).toEqual(['', ''])

    await canvas.flush()
    const saved = JSON.parse(await workspace.storage!.readText(path)) as { shapes: RectShape[] }
    expect(saved.shapes.map((shape) => ({ x: shape.x, groupId: shape.groupId }))).toEqual([
      { x: 35, groupId: '' },
      { x: 145, groupId: '' },
    ])
  })
})
