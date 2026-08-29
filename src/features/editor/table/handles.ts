import { ref, type Ref } from 'vue'

/**
 * 表格行列把手。
 *
 * 不复用官方组件的把手：它的位置只在自己的悬停判定内更新，与「鼠标移向把手」
 * 的过程对不上，表现为位置滞后、重影、够不着。
 *
 * 这里自己算：鼠标落在哪个单元格，就把列把手摆到该列正上方、行把手摆到该行正左侧，
 * 并记下那个单元格。点击时行列已经确定，无需坐标反查。
 *
 * 两个关键细节：
 * 1. 把手**尺寸固定**，不随行高列宽变化——跟随尺寸会让宽列的把手变成一条长杠，
 *    窄行的把手又小到点不中。
 * 2. 监听挂在 document 上，并按「表格外扩一圈」的范围判定是否保留把手。
 *    把手 Teleport 到 body，不在编辑器容器内；若只在容器上监听，
 *    鼠标一离开单元格就会被清掉，人还没够到把手它就没了。
 */

export interface HandleTarget {
  /** 鼠标当前所在的单元格，行列操作以它为基准 */
  cell: HTMLTableCellElement
  table: HTMLTableElement
}

export interface HandleRect {
  x: number
  y: number
}

export interface TableHandlesState {
  target: Ref<HandleTarget | null>
  colPos: Ref<HandleRect | null>
  rowPos: Ref<HandleRect | null>
  install: () => () => void
  clear: () => void
}

/** 把手的固定尺寸与到表格的间距 */
const LONG = 26
const SHORT = 12
const GAP = 5
/** 判定「仍在表格附近」的外扩距离，需覆盖把手本身及其与表格之间的空隙 */
const HOVER_PADDING = LONG + GAP + 12

export function createTableHandles(): TableHandlesState {
  const target = ref<HandleTarget | null>(null)
  const colPos = ref<HandleRect | null>(null)
  const rowPos = ref<HandleRect | null>(null)

  function clear(): void {
    target.value = null
    colPos.value = null
    rowPos.value = null
  }

  function place(cell: HTMLTableCellElement, table: HTMLTableElement): void {
    const cellBox = cell.getBoundingClientRect()
    const tableBox = table.getBoundingClientRect()

    target.value = { cell, table }

    // 列把手：贴表格上沿，水平居中于该列
    colPos.value = {
      x: cellBox.left + cellBox.width / 2 - LONG / 2,
      y: tableBox.top - SHORT - GAP,
    }

    // 行把手：贴表格左沿，垂直居中于该行
    rowPos.value = {
      x: tableBox.left - SHORT - GAP,
      y: cellBox.top + cellBox.height / 2 - LONG / 2,
    }
  }

  /** 鼠标是否仍在「表格 + 外扩一圈」的范围内——把手就落在这圈里 */
  function nearTable(table: HTMLTableElement, event: PointerEvent): boolean {
    const box = table.getBoundingClientRect()
    return (
      event.clientX >= box.left - HOVER_PADDING &&
      event.clientX <= box.right + HOVER_PADDING &&
      event.clientY >= box.top - HOVER_PADDING &&
      event.clientY <= box.bottom + HOVER_PADDING
    )
  }

  function onPointerMove(event: PointerEvent): void {
    // 表格被增删行列后会整体重渲染，此前记下的单元格会脱离文档。
    // 继续拿它去算行列号只会得到 null（表现为菜单项莫名全部置灰），
    // 因此先丢弃失效引用，让下面的逻辑重新解析。
    const stale = target.value
    if (stale && !stale.cell.isConnected) clear()

    const element = document.elementFromPoint(event.clientX, event.clientY)

    // 鼠标停在把手上：保持现状，否则一移过去它就消失了
    if (element?.closest('.light-table-handle')) return

    const cell = element?.closest('td, th')
    const table = cell?.closest('table')

    if (cell instanceof HTMLTableCellElement && table instanceof HTMLTableElement) {
      // 只对编辑器内的表格生效
      if (table.closest('.milkdown-table-block')) {
        place(cell, table)
        return
      }
    }

    // 离开了单元格，但只要还在表格附近就保留把手，给鼠标留出移动过去的余地
    const current = target.value
    if (current && nearTable(current.table, event)) return

    clear()
  }

  /** 挂载全局监听，返回卸载函数 */
  function install(): () => void {
    document.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => document.removeEventListener('pointermove', onPointerMove)
  }

  return { target, colPos, rowPos, install, clear }
}

export { LONG as HANDLE_LONG, SHORT as HANDLE_SHORT, GAP as HANDLE_GAP }
