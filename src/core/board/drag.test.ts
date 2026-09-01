import { describe, expect, it } from 'vitest'
import { isBoardCardDrag, readBoardCardDrag, writeBoardCardDrag } from './drag'

function transfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'uninitialized',
    get types() { return [...values.keys()] },
    setData: (type: string, value: string) => { values.set(type, value) },
    getData: (type: string) => values.get(type) ?? '',
  } as unknown as DataTransfer
}

describe('看板拖拽载荷', () => {
  it('写入桌面 WebView 可识别的载荷并能读回卡片', () => {
    const data = transfer()
    writeBoardCardDrag(data, 'card-1')
    expect(data.effectAllowed).toBe('move')
    expect(isBoardCardDrag(data)).toBe(true)
    expect(readBoardCardDrag(data)).toBe('card-1')
    expect(data.getData('text/plain')).toBe('card-1')
  })

  it('不把外部文本拖放误认成卡片', () => {
    const data = transfer()
    data.setData('text/plain', 'outside')
    expect(isBoardCardDrag(data)).toBe(false)
  })
})
