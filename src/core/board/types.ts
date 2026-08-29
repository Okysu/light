/**
 * 看板的数据结构（模块 3）。
 *
 * 落盘成 `.board` 的 JSON 文件，与笔记一样直接躺在工作区里——
 * 「文件即真源」对看板同样成立：用户能看到它、能备份它、能用别的工具打开它。
 *
 * 不用 Markdown 表达看板：列与卡片的顺序、卡片的多个字段，用 Markdown 表达
 * 要么丢信息要么得靠约定俗成的注释，那才是真正的锁定。JSON 至少是通用格式。
 */

export type CardPriority = 'low' | 'normal' | 'high'

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface BoardCard {
  id: string
  title: string
  /** 描述支持 Markdown（3.2），渲染交给编辑器那套管线 */
  description: string
  tags: string[]
  /** 截止日期，ISO 日期串（YYYY-MM-DD）；空表示未设置 */
  due: string
  priority: CardPriority
  /** 封面图，工作区内的附件路径；空表示无封面 */
  cover: string
  checklist: ChecklistItem[]
  /**
   * 关联的笔记路径（3.3）。
   * 存路径而不是笔记 id：与双向链接同一套思路，路径是用户能看懂的东西，
   * 而 id 一旦对不上就无从排查。改名跟随由 workspace 统一处理。
   */
  notePath: string
  /** 负责人。需求 3.5 要求「预留」，因此只存文本不做成员系统 */
  assignee: string
  /** 已归档的卡片默认不显示（3.6） */
  archived: boolean
}

export interface BoardColumn {
  id: string
  title: string
  cards: BoardCard[]
}

export interface Board {
  version: 1
  kind: 'board'
  columns: BoardColumn[]
}

export const BOARD_VERSION = 1

/** 新建看板的默认三列，直接可用，省去用户第一步的空白 */
export function createEmptyBoard(newId: () => string): Board {
  return {
    version: BOARD_VERSION,
    kind: 'board',
    columns: [
      { id: newId(), title: '待办', cards: [] },
      { id: newId(), title: '进行中', cards: [] },
      { id: newId(), title: '已完成', cards: [] },
    ],
  }
}

export function createCard(newId: () => string, title: string): BoardCard {
  return {
    id: newId(),
    title,
    description: '',
    tags: [],
    due: '',
    priority: 'normal',
    cover: '',
    checklist: [],
    notePath: '',
    assignee: '',
    archived: false,
  }
}
