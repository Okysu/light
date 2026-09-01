import { describe, expect, it } from 'vitest'
import { mergeText } from './three-way-merge'

describe('Git 风格三方文本合并', () => {
  it('自动合并不同位置的编辑', () => {
    const result = mergeText(
      '标题\n第一段\n第二段\n结尾',
      '新标题\n第一段\n第二段\n结尾',
      '标题\n第一段\n云端第二段\n结尾',
    )
    expect(result).toEqual({ text: '新标题\n第一段\n云端第二段\n结尾', clean: true })
  })

  it('自动组合一侧插入与另一侧删除', () => {
    const result = mergeText('A\nB\nC', 'A\n本地新增\nB\nC', 'A\nC')
    expect(result).toEqual({ text: 'A\n本地新增\nC', clean: true })
  })

  it('双方做出相同改动时只保留一份', () => {
    expect(mergeText('旧', '新', '新')).toEqual({ text: '新', clean: true })
  })

  it('重叠改动写入标准冲突标记并保留 base', () => {
    const result = mergeText('共同\n旧值\n结尾', '共同\n本地值\n结尾', '共同\n云端值\n结尾')
    expect(result.clean).toBe(false)
    expect(result.text).toContain('<<<<<<< LOCAL\n本地值')
    expect(result.text).toContain('||||||| BASE\n旧值')
    expect(result.text).toContain('=======\n云端值\n>>>>>>> REMOTE')
  })

  it('保留末尾换行', () => {
    expect(mergeText('A\n', 'A\nB\n', 'X\nA\n')).toEqual({ text: 'X\nA\nB\n', clean: true })
  })
})
