import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { CanvasService } from './canvas-service'
import { createEmptyCanvas, type CanvasDoc, type RectShape } from './types'

describe('CanvasService', () => {
  let fs: MemoryAdapter
  let service: CanvasService

  beforeEach(() => {
    fs = new MemoryAdapter()
    service = new CanvasService(fs)
  })

  it('读写往返', async () => {
    const doc: CanvasDoc = {
      ...createEmptyCanvas(),
      shapes: [
        {
          id: 's1',
          kind: 'rect',
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          stroke: 'var(--foreground)',
          fill: '',
          strokeWidth: 2,
          locked: false,
          groupId: '',
          text: '方块',
        } satisfies RectShape,
      ],
    }

    await service.write('画板.canvas', doc)
    expect(await service.read('画板.canvas')).toEqual(doc)
  })

  it('文件不存在时给出空画板', async () => {
    expect(await service.read('不存在.canvas')).toEqual(createEmptyCanvas())
  })

  it('JSON 损坏时不抛错', async () => {
    await fs.writeText('坏的.canvas', '{ 不是 JSON')
    expect((await service.read('坏的.canvas')).shapes).toEqual([])
  })

  /** 一个类型未知的东西，补出来的默认值只会是个莫名其妙的方块 */
  it('认不出类型的图元直接丢弃', () => {
    const doc = service.normalize({
      shapes: [{ id: 'a', kind: 'rect' }, { id: 'b', kind: '外星图形' }, { id: 'c' }, null, 'string'],
    })
    expect(doc.shapes.map((s) => s.id)).toEqual(['a'])
  })

  it('缺坐标的图元被补成 0 而不是丢掉', () => {
    const doc = service.normalize({ shapes: [{ id: 'a', kind: 'rect', text: '保住了' }] })
    expect(doc.shapes[0]).toMatchObject({ x: 0, y: 0, width: 0, height: 0, text: '保住了' })
  })

  it('NaN 与非数字坐标被换成默认值', () => {
    const doc = service.normalize({
      shapes: [{ id: 'a', kind: 'rect', x: NaN, y: 'abc', width: Infinity }],
    })
    expect(doc.shapes[0]).toMatchObject({ x: 0, y: 0, width: 0 })
  })

  it('线的端点被补齐', () => {
    const doc = service.normalize({ shapes: [{ id: 'a', kind: 'arrow' }] })
    expect(doc.shapes[0]).toMatchObject({ from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, fromId: '', toId: '' })
  })

  it('手绘的点串被逐点归一化', () => {
    const doc = service.normalize({
      shapes: [{ id: 'a', kind: 'draw', points: [{ x: 1, y: 2 }, { x: 'bad' }, null] }],
    })
    expect(doc.shapes[0]).toMatchObject({
      points: [{ x: 1, y: 2 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    })
  })

  it('文本图元有默认字号', () => {
    const doc = service.normalize({ shapes: [{ id: 'a', kind: 'text' }] })
    expect(doc.shapes[0]).toMatchObject({ fontSize: 16, text: '' })
  })

  it('分组 ID 保留，缺失时归一化为空串', () => {
    const doc = service.normalize({ shapes: [{ id: 'a', kind: 'rect', groupId: 'g1' }, { id: 'b', kind: 'rect' }] })
    expect(doc.shapes.map((shape) => shape.groupId)).toEqual(['g1', ''])
  })

  it('归一化后再次归一化不再变化', () => {
    const once = service.normalize({ shapes: [{ id: 'a', kind: 'rect' }, { id: 'b', kind: 'draw' }] })
    expect(service.normalize(once as unknown)).toEqual(once)
  })

  it('null 与非对象输入都能兜住', () => {
    for (const input of [null, undefined, 42, 'x', []]) {
      expect(service.normalize(input)).toEqual(createEmptyCanvas())
    }
  })
})
