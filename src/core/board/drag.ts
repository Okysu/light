const BOARD_CARD_MIME = 'application/x-light-board-card'

/**
 * Linux WebKit 只有在 dragstart 写入实际载荷后才会启动 HTML5 拖放。
 * 同时写 text/plain，兼容不保留自定义 MIME 的桌面 WebView。
 */
export function writeBoardCardDrag(data: DataTransfer, cardId: string): void {
  // text/plain 先写：有些 Linux WebKit 不接受自定义 MIME，但只要有标准载荷
  // 就会真正启动拖拽。
  data.setData('text/plain', cardId)
  try { data.setData(BOARD_CARD_MIME, cardId) } catch { /* 标准载荷已足够 */ }
  data.effectAllowed = 'move'
}

export function readBoardCardDrag(data: DataTransfer | null): string | null {
  if (!data) return null
  return data.getData(BOARD_CARD_MIME) || data.getData('text/plain') || null
}

export function isBoardCardDrag(data: DataTransfer | null): boolean {
  if (!data) return false
  return [...data.types].includes(BOARD_CARD_MIME)
}
