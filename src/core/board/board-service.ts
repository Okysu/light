import type { StorageAdapter } from '../storage'
import { BOARD_VERSION, createEmptyBoard, type Board, type BoardCard, type BoardColumn } from './types'

/**
 * 看板文件的读写（模块 3）。
 *
 * 读取时**永远做一次归一化**：文件可能是用户手工改过的、是旧版本写的、
 * 或者干脆坏了。看板打不开比少一个字段严重得多，因此缺什么补什么，
 * 实在读不出来就退回一个空看板，而不是抛错让整个界面白屏。
 */
export class BoardService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async read(path: string): Promise<Board> {
    try {
      return this.normalize(JSON.parse(await this.storage.readText(path)))
    } catch {
      return createEmptyBoard(this.newId)
    }
  }

  async write(path: string, board: Board): Promise<void> {
    await this.storage.writeText(path, JSON.stringify(board, null, 2))
  }

  /**
   * 把任意输入整成合法看板。
   *
   * 逐字段兜底而不是「校验失败就丢弃」：用户的卡片标题即使别的字段都坏了
   * 也该保住——数据能救回多少是多少，这是本地优先应有的态度。
   */
  normalize(input: unknown): Board {
    const raw = (input ?? {}) as Partial<Board>
    const columns = Array.isArray(raw.columns) ? raw.columns : []

    const normalized = columns
      .filter((column): column is BoardColumn => typeof column === 'object' && column !== null)
      .map((column) => this.normalizeColumn(column))

    // 一列都没有的看板没法用，给回默认三列
    if (normalized.length === 0) return createEmptyBoard(this.newId)

    return { version: BOARD_VERSION, kind: 'board', columns: normalized }
  }

  private normalizeColumn(column: Partial<BoardColumn>): BoardColumn {
    const cards = Array.isArray(column.cards) ? column.cards : []

    return {
      id: typeof column.id === 'string' && column.id ? column.id : this.newId(),
      title: typeof column.title === 'string' ? column.title : '未命名',
      cards: cards
        .filter((card): card is BoardCard => typeof card === 'object' && card !== null)
        .map((card) => this.normalizeCard(card)),
    }
  }

  private normalizeCard(card: Partial<BoardCard>): BoardCard {
    return {
      id: typeof card.id === 'string' && card.id ? card.id : this.newId(),
      title: typeof card.title === 'string' ? card.title : '',
      description: typeof card.description === 'string' ? card.description : '',
      tags: Array.isArray(card.tags) ? card.tags.filter((tag) => typeof tag === 'string') : [],
      due: typeof card.due === 'string' ? card.due : '',
      priority:
        card.priority === 'low' || card.priority === 'high' || card.priority === 'normal'
          ? card.priority
          : 'normal',
      cover: typeof card.cover === 'string' ? card.cover : '',
      checklist: Array.isArray(card.checklist)
        ? card.checklist
            .filter((item) => typeof item === 'object' && item !== null)
            .map((item) => ({
              id: typeof item.id === 'string' && item.id ? item.id : this.newId(),
              text: typeof item.text === 'string' ? item.text : '',
              done: item.done === true,
            }))
        : [],
      notePath: typeof card.notePath === 'string' ? card.notePath : '',
      assignee: typeof card.assignee === 'string' ? card.assignee : '',
      archived: card.archived === true,
    }
  }
}
