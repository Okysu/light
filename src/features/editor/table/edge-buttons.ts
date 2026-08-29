import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { addColAfterCommand, addRowAfterCommand } from '@milkdown/kit/preset/gfm'
import { TextSelection } from '@milkdown/kit/prose/state'

/**
 * 表格边缘的常驻「+」按钮（右侧加列、底部加行、右下角同时加）。
 *
 * 官方组件的加号只在鼠标悬停到行/列的具体边界时才出现，需要瞄准；
 * 需求要的是 Affine 那种「表格最边上始终有一条可点的加号带」，更直观。
 *
 * 实现上不走 ProseMirror 装饰器：装饰器会进入文档流并参与位置映射，
 * 而这几个按钮纯属界面附件、不该影响文档结构与光标位置。
 * 因此用 MutationObserver 观察表格节点的增减，向其容器注入绝对定位的按钮。
 */

const MARKER = 'lightEdgeButtons'

interface EdgeButtonsHandle {
  destroy: () => void
}

/** 把选区移到表格最后一个单元格——增行增列的命令都作用于当前选区所在行列 */
function focusLastCell(ctx: Ctx, tableBlock: HTMLElement): boolean {
  const view = ctx.get(editorViewCtx)
  const cells = tableBlock.querySelectorAll('td, th')
  const lastCell = cells[cells.length - 1]
  if (!lastCell) return false

  try {
    const pos = view.posAtDOM(lastCell, 0)
    if (pos < 0) return false
    // near 而非 create：posAtDOM 返回节点位置，未必是合法的文本位置
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))))
    return true
  } catch {
    // 表格刚被删除等边界情况下 posAtDOM 会抛错，此时忽略即可
    return false
  }
}

function runOnTable(ctx: Ctx, tableBlock: HTMLElement, commandKey: unknown): void {
  if (!focusLastCell(ctx, tableBlock)) return
  ctx.get(commandsCtx).call(commandKey as never)
  ctx.get(editorViewCtx).focus()
}

function createButton(className: string, title: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.title = title
  button.textContent = '+'
  // 不可编辑，否则 ProseMirror 会把它当作文档内容处理
  button.contentEditable = 'false'
  return button
}

function decorate(tableBlock: HTMLElement, getCtx: () => Ctx | null): void {
  if (tableBlock.dataset[MARKER]) return
  tableBlock.dataset[MARKER] = 'true'

  const addCol = createButton('light-table-edge light-table-edge-col', '在右侧添加一列')
  const addRow = createButton('light-table-edge light-table-edge-row', '在下方添加一行')
  const addBoth = createButton('light-table-edge light-table-edge-both', '同时添加一行一列')

  addCol.addEventListener('mousedown', (event) => {
    // 阻止默认行为，避免点击时先把选区移到别处
    event.preventDefault()
    const ctx = getCtx()
    if (ctx) runOnTable(ctx, tableBlock, addColAfterCommand.key)
  })

  addRow.addEventListener('mousedown', (event) => {
    event.preventDefault()
    const ctx = getCtx()
    if (ctx) runOnTable(ctx, tableBlock, addRowAfterCommand.key)
  })

  addBoth.addEventListener('mousedown', (event) => {
    event.preventDefault()
    const ctx = getCtx()
    if (!ctx) return
    runOnTable(ctx, tableBlock, addColAfterCommand.key)
    runOnTable(ctx, tableBlock, addRowAfterCommand.key)
  })

  tableBlock.append(addCol, addRow, addBoth)
}

/**
 * 在给定容器内为所有表格装配边缘按钮，并持续跟进后续新增的表格。
 * @returns 解除观察的句柄；编辑器销毁时必须调用，否则观察者会随笔记切换累积
 */
export function installTableEdgeButtons(root: HTMLElement, getCtx: () => Ctx | null): EdgeButtonsHandle {
  const scan = () => {
    root.querySelectorAll<HTMLElement>('.milkdown-table-block').forEach((block) => decorate(block, getCtx))
  }

  scan()

  const observer = new MutationObserver(scan)
  observer.observe(root, { childList: true, subtree: true })

  return { destroy: () => observer.disconnect() }
}
