import { describe, expect, it } from 'vitest'
import {
  addCard,
  addColumn,
  archiveDone,
  collectBoardTags,
  columnOf,
  filterBoard,
  findCard,
  moveCard,
  moveColumn,
  removeCard,
  removeColumn,
  renameColumn,
  setArchived,
  updateCard,
} from './operations'
import { createCard, type Board, type BoardCard } from './types'

let counter = 0
const nextId = (): string => `id-${++counter}`

function card(id: string, title: string, patch: Partial<BoardCard> = {}): BoardCard {
  return { ...createCard(() => id, title), ...patch }
}

function board(): Board {
  return {
    version: 1,
    kind: 'board',
    columns: [
      { id: 'c1', title: '待办', cards: [card('a', '甲'), card('b', '乙')] },
      { id: 'c2', title: '进行中', cards: [card('c', '丙')] },
      { id: 'c3', title: '已完成', cards: [] },
    ],
  }
}

/** 取每列的卡片 id，绝大多数断言看的就是这个 */
function layout(value: Board): Record<string, string[]> {
  return Object.fromEntries(value.columns.map((column) => [column.id, column.cards.map((c) => c.id)]))
}

describe('列操作', () => {
  it('新增列追加在末尾', () => {
    const next = addColumn(board(), '归档', 'c4')
    expect(next.columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  it('重命名列', () => {
    expect(renameColumn(board(), 'c2', '处理中').columns[1]?.title).toBe('处理中')
  })

  it('删除列连同卡片', () => {
    const next = removeColumn(board(), 'c1')
    expect(next.columns.map((c) => c.id)).toEqual(['c2', 'c3'])
    expect(findCard(next, 'a')).toBeNull()
  })

  it('移动列', () => {
    expect(moveColumn(board(), 'c3', 0).columns.map((c) => c.id)).toEqual(['c3', 'c1', 'c2'])
  })

  it('越界的目标下标不动', () => {
    expect(moveColumn(board(), 'c1', 9).columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    expect(moveColumn(board(), 'c1', -1).columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })
})

describe('卡片操作', () => {
  it('新增卡片追加到指定列', () => {
    const next = addCard(board(), 'c3', card('d', '丁'))
    expect(layout(next)['c3']).toEqual(['d'])
  })

  it('更新卡片字段', () => {
    const next = updateCard(board(), 'a', { title: '改过了', priority: 'high' })
    expect(findCard(next, 'a')).toMatchObject({ title: '改过了', priority: 'high' })
  })

  it('id 不会被 patch 覆盖', () => {
    const next = updateCard(board(), 'a', { id: '别的' } as Partial<BoardCard>)
    expect(findCard(next, 'a')).not.toBeNull()
  })

  it('删除卡片', () => {
    expect(layout(removeCard(board(), 'a'))['c1']).toEqual(['b'])
  })

  it('columnOf 找出卡片所在列', () => {
    expect(columnOf(board(), 'c')?.id).toBe('c2')
    expect(columnOf(board(), '不存在')).toBeNull()
  })
})

/**
 * 拖拽的下标计算是这个模块最容易错的地方。
 * 「差一格」的错位用户说不清，只会觉得拖拽不准，因此逐种情形锁住。
 */
describe('moveCard', () => {
  it('跨列移动到指定位置', () => {
    const next = moveCard(board(), 'a', 'c2', 0)
    expect(layout(next)).toEqual({ c1: ['b'], c2: ['a', 'c'], c3: [] })
  })

  it('跨列移动完整保留封面、描述、标签、子任务和关联信息', () => {
    const original = board()
    const rich = card('rich', '完整卡片', {
      cover: '../attachments/cover.png',
      description: '包含 **Markdown**',
      tags: ['图片', '重要'],
      checklist: [{ id: 'task', text: '检查预览', done: true }],
      notePath: '说明.md',
      assignee: 'Alice',
      due: '2026-09-02',
      priority: 'high',
    })
    original.columns[0]!.cards.push(rich)

    const moved = moveCard(original, rich.id, 'c2', 0)

    expect(findCard(moved, rich.id)).toBe(rich)
    expect(findCard(moved, rich.id)).toEqual(rich)
  })

  it('跨列移动省略下标时追加到末尾', () => {
    expect(layout(moveCard(board(), 'a', 'c2'))).toEqual({ c1: ['b'], c2: ['c', 'a'], c3: [] })
  })

  it('移动到空列', () => {
    expect(layout(moveCard(board(), 'a', 'c3', 0))).toEqual({ c1: ['b'], c2: ['c'], c3: ['a'] })
  })

  /** 同列内向后拖：toIndex 是移除源卡片**之后**的下标 */
  it('列内向后移动', () => {
    expect(layout(moveCard(board(), 'a', 'c1', 1))).toEqual({ c1: ['b', 'a'], c2: ['c'], c3: [] })
  })

  it('列内向前移动', () => {
    expect(layout(moveCard(board(), 'b', 'c1', 0))).toEqual({ c1: ['b', 'a'], c2: ['c'], c3: [] })
  })

  it('移动到原位不改变顺序', () => {
    expect(layout(moveCard(board(), 'a', 'c1', 0))).toEqual({ c1: ['a', 'b'], c2: ['c'], c3: [] })
  })

  it('下标超出范围时夹到边界而不是丢卡片', () => {
    expect(layout(moveCard(board(), 'c', 'c1', 99))).toEqual({ c1: ['a', 'b', 'c'], c2: [], c3: [] })
    expect(layout(moveCard(board(), 'c', 'c1', -5))).toEqual({ c1: ['c', 'a', 'b'], c2: [], c3: [] })
  })

  it('卡片不存在时原样返回', () => {
    expect(layout(moveCard(board(), '不存在', 'c2', 0))).toEqual(layout(board()))
  })

  it('目标列不存在时原样返回——绝不能把卡片弄丢', () => {
    const next = moveCard(board(), 'a', '不存在的列', 0)
    expect(layout(next)).toEqual(layout(board()))
    expect(findCard(next, 'a')).not.toBeNull()
  })

  /** 纯函数：调用后原对象必须完好，否则撤销与并发保存都会出问题 */
  it('不修改传入的看板', () => {
    const original = board()
    moveCard(original, 'a', 'c2', 0)
    expect(layout(original)).toEqual({ c1: ['a', 'b'], c2: ['c'], c3: [] })
  })
})

describe('归档', () => {
  it('归档单张卡片', () => {
    expect(findCard(setArchived(board(), 'a', true), 'a')?.archived).toBe(true)
  })

  it('取消归档', () => {
    const archived = setArchived(board(), 'a', true)
    expect(findCard(setArchived(archived, 'a', false), 'a')?.archived).toBe(false)
  })

  it('整列归档', () => {
    const next = archiveDone(board(), 'c1')
    expect(next.columns[0]?.cards.every((c) => c.archived)).toBe(true)
    expect(next.columns[1]?.cards.every((c) => !c.archived)).toBe(true)
  })

  /** 归档只是标记，卡片仍在原列，随时能翻出来 */
  it('归档不改变卡片位置', () => {
    expect(layout(setArchived(board(), 'a', true))).toEqual(layout(board()))
  })
})

describe('filterBoard', () => {
  function rich(): Board {
    return {
      version: 1,
      kind: 'board',
      columns: [
        {
          id: 'c1',
          title: '待办',
          cards: [
            card('a', '写文档', { tags: ['工作', '紧急'], priority: 'high', due: '2026-09-01', assignee: '张三' }),
            card('b', '买菜', { tags: ['生活'], priority: 'low', due: '2026-08-30' }),
            card('c', '已完成的事', { archived: true, tags: ['工作'] }),
            card('d', '没有截止日期', { tags: ['工作'] }),
          ],
        },
      ],
    }
  }

  const ids = (value: Board): string[] => value.columns.flatMap((c) => c.cards.map((card) => card.id))

  it('默认隐藏已归档卡片', () => {
    expect(ids(filterBoard(rich(), {}))).toEqual(['a', 'b', 'd'])
  })

  it('可以显示已归档', () => {
    expect(ids(filterBoard(rich(), { includeArchived: true }))).toContain('c')
  })

  it('关键词同时匹配标题与描述', () => {
    expect(ids(filterBoard(rich(), { keyword: '文档' }))).toEqual(['a'])
  })

  it('关键词大小写不敏感', () => {
    const value = filterBoard(
      { ...rich(), columns: [{ id: 'x', title: 'x', cards: [card('e', 'Hello World')] }] },
      { keyword: 'hello' },
    )
    expect(ids(value)).toEqual(['e'])
  })

  /** 勾了两个标签是想找「同时具备」的卡片，不是任意一个 */
  it('多标签取交集', () => {
    expect(ids(filterBoard(rich(), { tags: ['工作', '紧急'] }))).toEqual(['a'])
    expect(ids(filterBoard(rich(), { tags: ['工作'] }))).toEqual(['a', 'd'])
  })

  it('按优先级筛选', () => {
    expect(ids(filterBoard(rich(), { priority: 'low' }))).toEqual(['b'])
  })

  it('按负责人筛选', () => {
    expect(ids(filterBoard(rich(), { assignee: '张三' }))).toEqual(['a'])
  })

  /** 没有截止日期不等于「很晚」，它是没有这个属性 */
  it('按截止日期筛选时，无日期的卡片不入选', () => {
    expect(ids(filterBoard(rich(), { dueBefore: '2026-08-31' }))).toEqual(['b'])
  })

  it('筛选保留列结构，界面无需第二套渲染逻辑', () => {
    const value = filterBoard(rich(), { keyword: '不存在的词' })
    expect(value.columns).toHaveLength(1)
    expect(value.columns[0]?.cards).toEqual([])
  })

  it('多个条件同时生效', () => {
    expect(ids(filterBoard(rich(), { tags: ['工作'], priority: 'high' }))).toEqual(['a'])
  })
})

describe('collectBoardTags', () => {
  it('汇总去重', () => {
    const value: Board = {
      version: 1,
      kind: 'board',
      columns: [
        { id: 'c1', title: 'x', cards: [card('a', 'a', { tags: ['工作', '生活'] })] },
        { id: 'c2', title: 'y', cards: [card('b', 'b', { tags: ['工作'] })] },
      ],
    }
    expect(collectBoardTags(value).sort()).toEqual(['工作', '生活'].sort())
  })

  it('没有标签时返回空', () => {
    expect(collectBoardTags(board())).toEqual([])
  })
})

describe('nextId 辅助', () => {
  it('createCard 产出完整的默认字段', () => {
    const created = createCard(nextId, '新卡片')
    expect(created).toMatchObject({
      title: '新卡片',
      description: '',
      tags: [],
      due: '',
      priority: 'normal',
      archived: false,
    })
  })
})
