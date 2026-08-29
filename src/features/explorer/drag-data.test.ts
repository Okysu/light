import { describe, expect, it } from 'vitest'
import { hasTreeDrag, readTreeDrag, TREE_DRAG_TYPE, writeTreeDrag } from './drag-data'

function transfer(dropCustomMime = false) {
  const values = new Map<string, string>()
  return {
    types: [] as string[],
    setData(type: string, value: string) {
      values.set(type, value)
      if (!this.types.includes(type)) this.types.push(type)
    },
    getData(type: string) {
      if (dropCustomMime && type === TREE_DRAG_TYPE) return ''
      return values.get(type) ?? ''
    },
  }
}

describe('文件树拖拽载荷', () => {
  it('WebView2 丢弃自定义 MIME 后仍能从标准文本载荷恢复路径', () => {
    const data = transfer(true)
    writeTreeDrag(data, '目录/笔记.md')

    expect(hasTreeDrag(data)).toBe(true)
    expect(readTreeDrag(data)).toBe('目录/笔记.md')
  })

  it('不会把外部普通文本当成内部文件路径', () => {
    const data = transfer()
    data.setData('text/plain', '一段外部文本')

    expect(readTreeDrag(data)).toBe('')
  })
})
