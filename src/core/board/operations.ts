import type { Board, BoardCard, BoardColumn, CardPriority } from './types'

/**
 * 看板的全部变更操作（模块 3）。
 *
 * 每个函数都是**纯的**：收下一份看板，返回一份新的，绝不原地改。
 * 这样撤销、并发保存、以及「界面上看到的和落盘的是不是同一份」都有确定答案，
 * 而拖拽排序这类操作恰恰最容易在原地修改时出现「只动了一半」的中间态。
 *
 * 也因为纯，这一层能脱离 Vue 与 DOM 完整单测——拖拽的下标计算是这个模块
 * 最容易错的地方，它值得被逐种情形锁住。
 */

// --- 列 -----------------------------------------------------------------

export function addColumn(board: Board, title: string, id: string): Board {
  return { ...board, columns: [...board.columns, { id, title, cards: [] }] }
}

export function renameColumn(board: Board, columnId: string, title: string): Board {
  return {
    ...board,
    columns: board.columns.map((column) => (column.id === columnId ? { ...column, title } : column)),
  }
}

/** 删除整列，连同其中的卡片。调用方负责先确认 */
export function removeColumn(board: Board, columnId: string): Board {
  return { ...board, columns: board.columns.filter((column) => column.id !== columnId) }
}

export function moveColumn(board: Board, columnId: string, toIndex: number): Board {
  const from = board.columns.findIndex((column) => column.id === columnId)
  if (from === -1 || toIndex < 0 || toIndex >= board.columns.length || from === toIndex) return board

  const columns = [...board.columns]
  const [moved] = columns.splice(from, 1)
  columns.splice(toIndex, 0, moved!)
  return { ...board, columns }
}

// --- 卡片 ---------------------------------------------------------------

export function addCard(board: Board, columnId: string, card: BoardCard): Board {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId ? { ...column, cards: [...column.cards, card] } : column,
    ),
  }
}

export function updateCard(board: Board, cardId: string, patch: Partial<BoardCard>): Board {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.map((card) => (card.id === cardId ? { ...card, ...patch, id: card.id } : card)),
    })),
  }
}

export function removeCard(board: Board, cardId: string): Board {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.filter((card) => card.id !== cardId),
    })),
  }
}

/**
 * 拖拽移动卡片（3.4）：跨列与列内排序走同一条路径。
 *
 * `toIndex` 是**移除源卡片之后**的目标下标。同列内向后拖时这一点尤其要紧：
 * 若按移除前的下标插入，卡片会比用户松手的位置多往后一格——那种「差一格」
 * 的错位用户说不清，只会觉得拖拽不准。
 *
 * @param toIndex 省略则追加到目标列末尾
 */
export function moveCard(board: Board, cardId: string, toColumnId: string, toIndex?: number): Board {
  const card = findCard(board, cardId)
  if (!card) return board

  const target = board.columns.find((column) => column.id === toColumnId)
  if (!target) return board

  // 先摘出来，再按摘除后的序列插入——两步都在同一份新数组上完成
  const columns = board.columns.map((column) => ({
    ...column,
    cards: column.cards.filter((item) => item.id !== cardId),
  }))

  const targetIndex = columns.findIndex((column) => column.id === toColumnId)
  const cards = [...columns[targetIndex]!.cards]
  const at = toIndex === undefined ? cards.length : clamp(toIndex, 0, cards.length)
  cards.splice(at, 0, card)

  columns[targetIndex] = { ...columns[targetIndex]!, cards }
  return { ...board, columns }
}

/** 归档 / 取消归档（3.6）。归档只是标记，卡片仍在原列里，随时能翻出来 */
export function setArchived(board: Board, cardId: string, archived: boolean): Board {
  return updateCard(board, cardId, { archived })
}

/** 把某列中已归档的卡片一次性收起来 */
export function archiveDone(board: Board, columnId: string): Board {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId
        ? { ...column, cards: column.cards.map((card) => ({ ...card, archived: true })) }
        : column,
    ),
  }
}

// --- 查询与筛选 ---------------------------------------------------------

export function findCard(board: Board, cardId: string): BoardCard | null {
  for (const column of board.columns) {
    const card = column.cards.find((item) => item.id === cardId)
    if (card) return card
  }
  return null
}

export function columnOf(board: Board, cardId: string): BoardColumn | null {
  return board.columns.find((column) => column.cards.some((card) => card.id === cardId)) ?? null
}

export interface BoardFilter {
  /** 标题与描述的关键词 */
  keyword?: string
  /** 必须同时具备的标签 */
  tags?: readonly string[]
  priority?: CardPriority
  assignee?: string
  /** 截止日期早于等于此日期（ISO 日期串） */
  dueBefore?: string
  /** 是否显示已归档卡片，默认不显示 */
  includeArchived?: boolean
}

/**
 * 按条件筛选（3.5）。返回的是**结构相同**的看板，只是卡片被过滤过——
 * 这样界面拿到筛选结果后不需要写第二套渲染逻辑。
 */
export function filterBoard(board: Board, filter: BoardFilter): Board {
  const keyword = filter.keyword?.trim().toLowerCase() ?? ''
  const tags = filter.tags ?? []

  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.filter((card) => matches(card, keyword, tags, filter)),
    })),
  }
}

function matches(
  card: BoardCard,
  keyword: string,
  tags: readonly string[],
  filter: BoardFilter,
): boolean {
  if (!filter.includeArchived && card.archived) return false

  if (keyword) {
    const haystack = `${card.title}\n${card.description}`.toLowerCase()
    if (!haystack.includes(keyword)) return false
  }

  // 多个标签取交集：勾了两个标签是想找「同时具备」的卡片
  if (tags.length > 0 && !tags.every((tag) => card.tags.includes(tag))) return false

  if (filter.priority && card.priority !== filter.priority) return false
  if (filter.assignee && card.assignee !== filter.assignee) return false

  // 没有截止日期的卡片不参与日期筛选——它不是「很晚」，是「没有这个属性」
  if (filter.dueBefore) {
    if (!card.due) return false
    if (card.due > filter.dueBefore) return false
  }

  return true
}

/** 看板里出现过的全部标签，供筛选器列出候选 */
export function collectBoardTags(board: Board): string[] {
  const tags = new Set<string>()
  for (const column of board.columns) {
    for (const card of column.cards) {
      for (const tag of card.tags) tags.add(tag)
    }
  }
  return [...tags]
}

/** 统计：总数与已归档数，供列头显示 */
export function countCards(column: BoardColumn): { total: number; archived: number } {
  const archived = column.cards.filter((card) => card.archived).length
  return { total: column.cards.length, archived }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
