import { describe, expect, it } from 'vitest'
import { boardFromTaskLines, canvasFromMindmap } from './artifacts'
import type { LineShape } from '@/core/canvas/types'

function ids(): () => string {
  let value = 0
  return () => `id-${++value}`
}

describe('AI 结构化结果落盘', () => {
  it('任务列表会清理项目符号并生成看板卡片', () => {
    const board = boardFromTaskLines('- 编写测试\n2. 修复错误\n\n[ ] 发布版本', ids())
    expect(board.columns[0]?.cards.map((card) => card.title)).toEqual(['编写测试', '修复错误', '发布版本'])
    expect(board.columns[1]?.cards).toEqual([])
  })

  it('缩进脑图生成节点和指向父节点的箭头', () => {
    const canvas = canvasFromMindmap('Light\n  编辑器\n    高亮\n  同步', ids())
    const notes = canvas.shapes.filter((shape) => shape.kind === 'note')
    const arrows = canvas.shapes.filter((shape): shape is LineShape => shape.kind === 'arrow')
    expect(notes.map((shape) => shape.text)).toEqual(['Light', '编辑器', '高亮', '同步'])
    expect(arrows).toHaveLength(3)
    expect(arrows[1]?.fromId).toBe(notes[1]?.id)
  })
})
