import { describe, expect, it } from 'vitest'
import { compareVectors, incrementVector, mergeVectors } from './vector'

describe('版本向量', () => {
  it('区分相等、先后与并发', () => {
    expect(compareVectors({ a: 1 }, { a: 1 })).toBe('equal')
    expect(compareVectors({ a: 2 }, { a: 1 })).toBe('after')
    expect(compareVectors({ a: 1 }, { a: 2 })).toBe('before')
    expect(compareVectors({ a: 2, b: 1 }, { a: 1, b: 2 })).toBe('concurrent')
  })

  it('合并取各设备最大值，递增只改当前设备', () => {
    expect(mergeVectors({ a: 2 }, { a: 1, b: 3 })).toEqual({ a: 2, b: 3 })
    expect(incrementVector({ a: 2, b: 3 }, 'a')).toEqual({ a: 3, b: 3 })
  })
})
