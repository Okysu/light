import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  deleteSelectedCellsCommand,
  moveColCommand,
  moveRowCommand,
  selectColCommand,
  selectRowCommand,
  setAlignCommand,
} from '@milkdown/kit/preset/gfm'
import { CellSelection, TableMap } from '@milkdown/kit/prose/tables'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { ref, type Ref } from 'vue'

/**
 * 表格菜单。
 *
 * 分工参考 Affine：
 * - **单元格右键**只放最常用的三项（复制 / 粘贴 / 清空内容），保持轻量；
 * - **行列操作**收进行首、列顶的把手菜单里（见 handles.ts / TableHandles.vue）。
 *   把手打开菜单时传的是**坐标**，由这里对当前文档重新解析行列；
 *   缓存 DOM 引用会在表格重渲染后失效，是此前焦点错乱与「第二次操作失灵」的根源。
 *
 * 不向 ProseMirror 管理的 DOM 注入元素：把手与菜单都由 Vue 渲染并 Teleport 到 body。
 * 曾因注入到单元格内部触发它的 DOM 同步机制，与 MutationObserver 形成互相触发的死循环。
 */

export type TableMenuKind = 'cell' | 'row' | 'col'

/**
 * 触发菜单时表格的状态。
 *
 * 行列号与尺寸由 `TableMap` 从当前文档解析，不依赖选区、也不依赖 DOM 引用——
 * 前者会在选区尚未更新时给出旧值，后者会在表格重渲染后失效。
 */
export interface TableContext {
  row: number
  col: number
  rowCount: number
  colCount: number
}

export interface TableMenuItem {
  id: string
  label: string
  danger?: boolean
  separatorBefore?: boolean
  /** 返回 true 时置灰：用于挡住越界的移动与会破坏表格结构的删除 */
  disabled?: (context: TableContext | null) => boolean
  run: (ctx: Ctx, context: TableContext | null) => void | Promise<void>
}

export interface TableMenuState {
  visible: Ref<boolean>
  kind: Ref<TableMenuKind>
  x: Ref<number>
  y: Ref<number>
  items: Ref<TableMenuItem[]>
  handleContextMenu: (event: MouseEvent, ctx: Ctx) => void
  /** 由把手调用：按坐标解析单元格并打开行/列菜单，锚定在把手矩形上 */
  openForPoint: (ctx: Ctx, point: { x: number; y: number }, kind: 'row' | 'col', anchor: DOMRect) => void
  close: () => void
  run: (item: TableMenuItem, ctx: Ctx) => void
  /** 当前菜单对应的表格状态，供渲染禁用态使用 */
  context: Ref<TableContext | null>
}

// --- 定位辅助 -------------------------------------------------------------

/**
 * 把光标放进指定单元格，后续命令都以此为基准。
 *
 * 用 `TextSelection.near` 而不是 `create`：`posAtDOM(cell, 0)` 给出的是**节点位置**，
 * 直接交给 `create` 会因不是合法文本位置而抛错（且被 catch 吞掉，表现为菜单毫无反应）。
 * `near` 会自动落到最近的可放光标处。
 */
function focusCellElement(view: EditorView, cell: Element): boolean {
  try {
    const pos = view.posAtDOM(cell, 0)
    if (pos < 0) return false
    const selection = TextSelection.near(view.state.doc.resolve(pos))
    view.dispatch(view.state.tr.setSelection(selection))
    return true
  } catch {
    return false
  }
}

function call(ctx: Ctx, key: unknown, payload?: unknown): void {
  ctx.get(commandsCtx).call(key as never, payload as never)
}

/**
 * 从视口坐标解析出所在单元格的行列号与表格尺寸。
 *
 * 走 ProseMirror 的 `posAtCoords` + `TableMap`，而**不是**缓存 DOM 引用：
 * 增删行列会让表格整体重渲染，此前拿到的单元格随即脱离文档，
 * 再用它推导只会得到 null——表现为「第二次操作时菜单项全部置灰、移动无效」。
 * 每次从当前文档状态解析，就不存在过期问题。
 */
function resolveTableContext(
  view: EditorView,
  point: { x: number; y: number },
): (TableContext & { pos: number }) | null {
  const found = view.posAtCoords({ left: point.x, top: point.y })
  if (!found) return null

  const $pos = view.state.doc.resolve(found.pos)

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name
    if (name !== 'table_cell' && name !== 'table_header') continue

    const tableDepth = depth - 2
    const table = $pos.node(tableDepth)
    if (table.type.name !== 'table') return null

    const map = TableMap.get(table)
    const cellStart = $pos.before(depth) - $pos.start(tableDepth)
    const rect = map.findCell(cellStart)

    return {
      row: rect.top,
      col: rect.left,
      rowCount: map.height,
      colCount: map.width,
      pos: $pos.before(depth),
    }
  }
  return null
}

/** 清空当前选中单元格的内容，但保留单元格本身 */
function clearCells(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx)
  const { selection } = view.state
  if (!(selection instanceof CellSelection)) return

  const tr = view.state.tr
  selection.forEachCell((cell, pos) => {
    const start = pos + 1
    const end = pos + cell.nodeSize - 1
    if (end > start) tr.delete(tr.mapping.map(start), tr.mapping.map(end))
  })
  if (tr.docChanged) view.dispatch(tr)
}

async function copySelection(ctx: Ctx): Promise<void> {
  const { state } = ctx.get(editorViewCtx)
  const text = state.doc.textBetween(state.selection.from, state.selection.to, '\n', ' ')
  if (text) await navigator.clipboard.writeText(text)
}

async function pasteIntoSelection(ctx: Ctx): Promise<void> {
  const view = ctx.get(editorViewCtx)
  const text = await navigator.clipboard.readText()
  if (text) view.dispatch(view.state.tr.insertText(text))
}

// --- 菜单项 ---------------------------------------------------------------

/** 单元格右键：只保留最常用的三项 */
const CELL_ITEMS: TableMenuItem[] = [
  { id: 'copy', label: '复制', run: copySelection },
  { id: 'paste', label: '粘贴', run: pasteIntoSelection },
  { id: 'clear', label: '清空内容', separatorBefore: true, run: clearCells },
]

/**
 * 移动行/列。
 *
 * 越界会让上游的 `getSelectionRangeInColumn` 拿到 undefined 并抛
 * `Cannot read properties of undefined (reading 'pos')`，
 * 因此这里既在 disabled 里挡住入口，run 中也再校验一次。
 */
function move(kind: 'row' | 'col', delta: number) {
  return (ctx: Ctx, context: TableContext | null) => {
    if (!context) return

    const from = kind === 'row' ? context.row : context.col
    const limit = kind === 'row' ? context.rowCount : context.colCount
    const to = from + delta
    if (to < 0 || to >= limit) return

    call(ctx, kind === 'row' ? moveRowCommand.key : moveColCommand.key, { from, to })
  }
}

function moveDisabled(kind: 'row' | 'col', delta: number) {
  return (context: TableContext | null) => {
    if (!context) return true
    const from = kind === 'row' ? context.row : context.col
    const limit = kind === 'row' ? context.rowCount : context.colCount
    const to = from + delta
    return to < 0 || to >= limit
  }
}

const ROW_ITEMS: TableMenuItem[] = [
  { id: 'row-before', label: '在上方插入行', run: (ctx) => call(ctx, addRowBeforeCommand.key) },
  { id: 'row-after', label: '在下方插入行', run: (ctx) => call(ctx, addRowAfterCommand.key) },
  {
    id: 'row-up',
    label: '上移本行',
    separatorBefore: true,
    disabled: moveDisabled('row', -1),
    run: move('row', -1),
  },
  { id: 'row-down', label: '下移本行', disabled: moveDisabled('row', 1), run: move('row', 1) },
  { id: 'row-clear', label: '清空本行内容', separatorBefore: true, run: clearCells },
  {
    id: 'row-delete',
    label: '删除本行',
    danger: true,
    // Markdown 表格必须有表头，删掉它会让表格结构失效
    disabled: (context) => !context || context.row === 0 || context.rowCount <= 2,
    run: (ctx) => call(ctx, deleteSelectedCellsCommand.key),
  },
]

const COL_ITEMS: TableMenuItem[] = [
  { id: 'col-before', label: '在左侧插入列', run: (ctx) => call(ctx, addColBeforeCommand.key) },
  { id: 'col-after', label: '在右侧插入列', run: (ctx) => call(ctx, addColAfterCommand.key) },
  {
    id: 'col-left',
    label: '左移本列',
    separatorBefore: true,
    disabled: moveDisabled('col', -1),
    run: move('col', -1),
  },
  { id: 'col-right', label: '右移本列', disabled: moveDisabled('col', 1), run: move('col', 1) },
  // 对齐是 Markdown 表格本身就有的语义，能写进文件，因此值得保留
  { id: 'align-left', label: '左对齐', separatorBefore: true, run: (ctx) => call(ctx, setAlignCommand.key, 'left') },
  { id: 'align-center', label: '居中对齐', run: (ctx) => call(ctx, setAlignCommand.key, 'center') },
  { id: 'align-right', label: '右对齐', run: (ctx) => call(ctx, setAlignCommand.key, 'right') },
  { id: 'col-clear', label: '清空本列内容', separatorBefore: true, run: clearCells },
  {
    id: 'col-delete',
    label: '删除本列',
    danger: true,
    // 至少保留一列，否则表格没有内容可承载
    disabled: (context) => !context || context.colCount <= 1,
    run: (ctx) => call(ctx, deleteSelectedCellsCommand.key),
  },
]

// --- 状态 -----------------------------------------------------------------

export function createTableMenu(): TableMenuState {
  const visible = ref(false)
  const kind = ref<TableMenuKind>('cell')
  const x = ref(0)
  const y = ref(0)
  const items = ref<TableMenuItem[]>(CELL_ITEMS)
  const context = ref<TableContext | null>(null)

  function open(at: { x: number; y: number }, next: TableMenuKind): void {
    kind.value = next
    items.value = next === 'row' ? ROW_ITEMS : next === 'col' ? COL_ITEMS : CELL_ITEMS
    x.value = at.x
    y.value = at.y
    visible.value = true
  }

  /** 单元格右键 */
  function handleContextMenu(event: MouseEvent, ctx: Ctx): void {
    const cell = (event.target as Element | null)?.closest?.('.milkdown-table-block td, .milkdown-table-block th')
    if (!cell) {
      visible.value = false
      return
    }

    const view = ctx.get(editorViewCtx)
    if (!focusCellElement(view, cell)) return

    const resolved = resolveTableContext(view, { x: event.clientX, y: event.clientY })
    context.value = resolved
      ? { row: resolved.row, col: resolved.col, rowCount: resolved.rowCount, colCount: resolved.colCount }
      : null

    event.preventDefault()
    open({ x: event.clientX, y: event.clientY }, 'cell')
  }

  /**
   * 由把手触发：按坐标解析出所在单元格，选中整行整列，再弹菜单。
   *
   * 传坐标而非 DOM 引用：增删行列后表格会整体重渲染，缓存的单元格随即失效。
   * 坐标每次都对当前文档重新解析，因此连续操作也不会错位。
   */
  function openForPoint(
    ctx: Ctx,
    point: { x: number; y: number },
    menuKind: 'row' | 'col',
    anchor: DOMRect,
  ): void {
    const view = ctx.get(editorViewCtx)
    const resolved = resolveTableContext(view, point)
    if (!resolved) return

    // 光标先落进该单元格，命令才有作用对象
    try {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(resolved.pos))))
    } catch {
      return
    }

    context.value = {
      row: resolved.row,
      col: resolved.col,
      rowCount: resolved.rowCount,
      colCount: resolved.colCount,
    }

    // 选中整行/整列。**必须显式传 index**：selectRow/ColCommand 的 payload
    // 默认是 `{ index: 0 }`，不传就恒选第 0 行/列——这正是「点第二行却高亮表头」的原因。
    try {
      call(ctx, menuKind === 'row' ? selectRowCommand.key : selectColCommand.key, {
        index: menuKind === 'row' ? resolved.row : resolved.col,
      })
    } catch {
      // 选中失败不应连累菜单弹出，否则表现为「点了毫无反应」
    }

    // 菜单贴着把手展开：列把手在上方 → 向下；行把手在左侧 → 向右
    const at =
      menuKind === 'col'
        ? { x: anchor.left, y: anchor.bottom + 6 }
        : { x: anchor.right + 6, y: anchor.top }
    open(at, menuKind)
  }

  function close(): void {
    visible.value = false
  }

  function run(item: TableMenuItem, ctx: Ctx): void {
    if (item.disabled?.(context.value)) return

    visible.value = false
    void Promise.resolve(item.run(ctx, context.value)).then(() => {
      ctx.get(editorViewCtx).focus()
    })
  }

  return { visible, kind, x, y, items, context, handleContextMenu, openForPoint, close, run }
}
