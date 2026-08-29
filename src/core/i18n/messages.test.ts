import { describe, expect, it } from 'vitest'
import { messages } from './messages'

describe('中英语言资源', () => {
  it('两种语言键集合完全一致且没有空翻译', () => {
    expect(Object.keys(messages['en-US']).sort()).toEqual(Object.keys(messages['zh-CN']).sort())
    expect(Object.values(messages['zh-CN']).every(Boolean)).toBe(true)
    expect(Object.values(messages['en-US']).every(Boolean)).toBe(true)
  })
})
