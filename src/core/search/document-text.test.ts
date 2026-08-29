import { describe, expect, it } from 'vitest'
import type { Board, BoardCard, BoardColumn } from '../board/types'
import type { CanvasDoc, Shape } from '../canvas/types'
import { boardText, canvasText } from './document-text'

function card(partial: Partial<BoardCard>): BoardCard {
  return {
    id: 'c',
    title: '',
    description: '',
    tags: [],
    due: '',
    priority: 'normal',
    cover: '',
    checklist: [],
    notePath: '',
    assignee: '',
    archived: false,
    ...partial,
  }
}

function board(columns: BoardColumn[]): Board {
  return { version: 1, kind: 'board', columns }
}

function canvas(shapes: Shape[]): CanvasDoc {
  return { version: 1, kind: 'canvas', shapes }
}

const BASE = { stroke: '#000', fill: '', strokeWidth: 2, locked: false, groupId: '' }

describe('boardText', () => {
  it('抽出列名、卡片标题、描述、负责人与子任务', () => {
    const result = boardText(
      board([
        {
          id: 'a',
          title: '进行中',
          cards: [
            card({
              title: '修复导出乱码',
              description: 'UTF-8 BOM 的问题',
              assignee: '小张',
              checklist: [{ id: '1', text: '复现', done: false }],
            }),
          ],
        },
      ]),
    )

    expect(result.content).toBe('进行中\n修复导出乱码\nUTF-8 BOM 的问题\n小张\n复现')
  })

  it('列名排在自己的卡片之前，片段才有上下文', () => {
    const result = boardText(
      board([
        { id: 'a', title: '待办', cards: [card({ title: '甲' })] },
        { id: 'b', title: '完成', cards: [card({ title: '乙' })] },
      ]),
    )

    expect(result.content).toBe('待办\n甲\n完成\n乙')
  })

  it('汇总全部卡片标签并去重', () => {
    const result = boardText(
      board([
        {
          id: 'a',
          title: '列',
          cards: [card({ tags: ['设计', '紧急'] }), card({ tags: ['设计'] })],
        },
      ]),
    )

    expect(result.tags).toEqual(['设计', '紧急'])
  })

  it('归档卡片照样索引——它没被删除，用户仍会去找它', () => {
    const result = boardText(
      board([{ id: 'a', title: '列', cards: [card({ title: '旧提案', archived: true })] }]),
    )

    expect(result.content).toContain('旧提案')
  })

  it('关联笔记只收文件名，不把目录名混进正文', () => {
    const result = boardText(
      board([{ id: 'a', title: '列', cards: [card({ notePath: '归档/2024/方案.md' })] }]),
    )

    expect(result.content).toContain('方案')
    expect(result.content).not.toContain('归档')
  })

  it('不把坐标、id、颜色这些机器字段带进正文', () => {
    const result = boardText(board([{ id: '很长的uuid', title: '列', cards: [card({ id: 'xyz' })] }]))

    expect(result.content).not.toContain('uuid')
    expect(result.content).not.toContain('xyz')
  })
})

describe('canvasText', () => {
  it('抽出文本与便利贴上的字', () => {
    const result = canvasText(
      canvas([
        { ...BASE, id: '1', kind: 'text', x: 0, y: 0, width: 10, height: 10, text: '架构草图', fontSize: 16 },
        { ...BASE, id: '2', kind: 'note', x: 0, y: 50, width: 10, height: 10, text: '记得补测试' },
      ]),
    )

    expect(result.content).toBe('架构草图\n记得补测试')
  })

  it('按从上到下、从左到右排序，而不是创建顺序', () => {
    const result = canvasText(
      canvas([
        { ...BASE, id: '1', kind: 'text', x: 100, y: 200, width: 10, height: 10, text: '下', fontSize: 16 },
        { ...BASE, id: '2', kind: 'text', x: 200, y: 10, width: 10, height: 10, text: '上右', fontSize: 16 },
        { ...BASE, id: '3', kind: 'text', x: 10, y: 10, width: 10, height: 10, text: '上左', fontSize: 16 },
      ]),
    )

    expect(result.content).toBe('上左\n上右\n下')
  })

  it('嵌入的笔记只收文件名', () => {
    const result = canvasText(
      canvas([
        { ...BASE, id: '1', kind: 'noteRef', x: 0, y: 0, width: 10, height: 10, path: '项目/需求.md' },
      ]),
    )

    expect(result.content).toBe('需求')
  })

  it('手绘轨迹不产生正文——几百个坐标点不是用户会搜的东西', () => {
    const result = canvasText(
      canvas([
        {
          ...BASE,
          id: '1',
          kind: 'draw',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
      ]),
    )

    expect(result.content).toBe('')
  })
})
