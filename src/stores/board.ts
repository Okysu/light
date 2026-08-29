import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { BoardService } from '@/core/board/board-service'
import {
  addCard,
  addColumn,
  archiveDone,
  collectBoardTags,
  filterBoard,
  moveCard,
  moveColumn,
  removeCard,
  removeColumn,
  renameColumn,
  setArchived,
  updateCard,
  type BoardFilter,
} from '@/core/board/operations'
import { createCard, type Board, type BoardCard } from '@/core/board/types'
import { createAutosave } from './autosave'
import { useSearchStore } from './search'
import { useWorkspaceStore } from './workspace'

/**
 * 当前打开的看板（模块 3）。
 *
 * 与笔记编辑器同一套 local-first 做法：改动先进内存并立刻标脏，
 * 落盘异步且防抖，切换或关闭前强制 flush。
 *
 * 每个变更都走 `apply`——它统一负责「替换状态 + 标脏 + 排期落盘」，
 * 免得每个操作各写一遍，也免得漏掉其中一步（漏掉落盘是不会报错的那种漏）。
 */
export const useBoardStore = defineStore('board', () => {
  const workspace = useWorkspaceStore()

  const service = shallowRef<BoardService | null>(null)
  const board = ref<Board | null>(null)
  const path = ref<string | null>(null)
  const dirty = ref(false)
  const saving = ref(false)
  const loadError = ref<string | null>(null)

  /** 筛选条件（3.5）。不落盘——它是「此刻想看什么」，不是看板的属性 */
  const filter = ref<BoardFilter>({})

  const SAVE_DELAY = 400

  /** 应用筛选后的视图；结构与原看板相同，界面无需第二套渲染逻辑 */
  const visible = computed(() => (board.value ? filterBoard(board.value, filter.value) : null))

  const allTags = computed(() => (board.value ? collectBoardTags(board.value) : []))

  const hasFilter = computed(() => {
    const value = filter.value
    return Boolean(
      value.keyword?.trim() ||
        value.tags?.length ||
        value.priority ||
        value.assignee ||
        value.dueBefore ||
        value.includeArchived,
    )
  })

  async function open(target: string): Promise<void> {
    // 同名文件被删掉又新建时路径不变，但内容已经是另一份了。
    // 只比路径就短路的话，下一次自动保存会把旧看板写进新文件。
    // 有未保存改动时保持现状，否则重读会吞掉用户刚做的调整
    if (path.value === target && dirty.value) return
    await flush()

    loadError.value = null
    try {
      const instance = ensureService()
      board.value = await instance.read(target)
      path.value = target
      dirty.value = false
      filter.value = {}
    } catch (cause) {
      loadError.value = cause instanceof Error ? cause.message : String(cause)
      board.value = null
      path.value = null
    }
  }

  async function close(): Promise<void> {
    await flush()
    board.value = null
    path.value = null
    dirty.value = false
  }

  /** 全部变更的唯一出口：换状态、标脏、排期落盘 */
  function apply(next: Board): void {
    board.value = next
    dirty.value = true
    schedule()
  }

  /**
   * 一次实际写入。看板与路径都在进入异步前定格——
   * 等 await 回来时，用户可能已经切到另一个看板了。
   */
  async function writeOnce(): Promise<void> {
    const current = board.value
    const target = path.value
    if (!current || !target || !dirty.value) return

    saving.value = true
    try {
      await ensureService().write(target, current)
      // 索引跟的是文件，与「当前打开的是谁」无关——哪怕用户已经切走了，
      // 刚写进磁盘的这份看板内容也该能被搜到
      void useSearchStore().touch(target)
      // 仍停在同一个看板、且内容没再变，才清脏标记。
      // 少了路径判断的话，切走之后这次写入回来会把新看板标成「已保存」
      if (path.value === target && board.value === current) dirty.value = false
    } finally {
      saving.value = false
    }
  }

  /** 防抖落盘队列。竞态处理见 stores/autosave.ts */
  const autosave = createAutosave(writeOnce)

  function schedule(): void {
    autosave.schedule(SAVE_DELAY)
  }

  const flush = autosave.flush

  function invalidate(): void {
    autosave.cancel()
    service.value = null
    board.value = null
    path.value = null
    dirty.value = false
    filter.value = {}
  }

  // --- 变更操作：全部委托给 core 的纯函数 --------------------------------

  const newId = (): string => crypto.randomUUID()

  function withBoard(mutate: (current: Board) => Board): void {
    if (board.value) apply(mutate(board.value))
  }

  return {
    board,
    visible,
    path,
    dirty,
    saving,
    loadError,
    filter,
    allTags,
    hasFilter,

    open,
    close,
    flush,
    invalidate,

    addColumn: (title: string) => withBoard((b) => addColumn(b, title, newId())),
    renameColumn: (columnId: string, title: string) => withBoard((b) => renameColumn(b, columnId, title)),
    removeColumn: (columnId: string) => withBoard((b) => removeColumn(b, columnId)),
    moveColumn: (columnId: string, toIndex: number) => withBoard((b) => moveColumn(b, columnId, toIndex)),

    addCard: (columnId: string, title: string) =>
      withBoard((b) => addCard(b, columnId, createCard(newId, title))),
    updateCard: (cardId: string, patch: Partial<BoardCard>) => withBoard((b) => updateCard(b, cardId, patch)),
    removeCard: (cardId: string) => withBoard((b) => removeCard(b, cardId)),
    moveCard: (cardId: string, toColumnId: string, toIndex?: number) =>
      withBoard((b) => moveCard(b, cardId, toColumnId, toIndex)),
    setArchived: (cardId: string, archived: boolean) => withBoard((b) => setArchived(b, cardId, archived)),
    archiveColumn: (columnId: string) => withBoard((b) => archiveDone(b, columnId)),
  }

  function ensureService(): BoardService {
    if (!workspace.storage) throw new Error('尚未打开工作区')
    if (!service.value) service.value = new BoardService(workspace.storage, newId)
    return service.value
  }
})
