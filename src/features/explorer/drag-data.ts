/** Light 文件树内部拖拽的首选 MIME。 */
export const TREE_DRAG_TYPE = 'application/x-light-path'

/**
 * WebView2 会在 drop 阶段丢弃自定义 MIME，但会保留 text/plain。
 * 前缀用于区分内部路径与从其它应用拖进来的普通文本。
 */
const TEXT_FALLBACK_PREFIX = 'light-tree-path:'

type DragTransfer = Pick<DataTransfer, 'getData' | 'setData' | 'types'>

export function writeTreeDrag(transfer: DragTransfer, path: string): void {
  transfer.setData(TREE_DRAG_TYPE, path)
  transfer.setData('text/plain', `${TEXT_FALLBACK_PREFIX}${path}`)
}

export function hasTreeDrag(transfer: Pick<DataTransfer, 'types'> | null | undefined): boolean {
  if (!transfer) return false
  return transfer.types.includes(TREE_DRAG_TYPE) || transfer.types.includes('text/plain')
}

export function readTreeDrag(transfer: Pick<DataTransfer, 'getData'> | null | undefined): string {
  if (!transfer) return ''

  const custom = transfer.getData(TREE_DRAG_TYPE)
  if (custom) return custom

  const fallback = transfer.getData('text/plain')
  return fallback.startsWith(TEXT_FALLBACK_PREFIX) ? fallback.slice(TEXT_FALLBACK_PREFIX.length) : ''
}
