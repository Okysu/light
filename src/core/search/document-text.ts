import type { Board } from '../board/types'
import type { CanvasDoc } from '../canvas/types'
import { stem } from '../path'

/**
 * 把看板与画板抽成可检索的纯文本（需求 11.1）。
 *
 * 不能直接把 JSON 原文丢进索引：那样 `id`、`x`、`strokeWidth`、几百个手绘坐标点
 * 全都成了「正文」，搜「设计」会命中一堆无关文档，而摘要片段里显示的是
 * `"id":"a3f...","x":120` 这种谁也读不懂的东西。
 *
 * 抽取只保留**人写下的字**：列名、卡片标题与描述、标签、负责人、图形上的文字。
 * 坐标、颜色、id 一律丢掉——它们不是用户会去搜的内容。
 */

export interface ExtractedText {
  content: string
  tags: string[]
}

/**
 * 看板。
 *
 * 列名放在它自己的卡片之前，这样片段里出现的上下文是
 * 「进行中 / 修复导出乱码」而不是孤零零一个卡片标题。
 */
export function boardText(board: Board): ExtractedText {
  const lines: string[] = []
  const tags = new Set<string>()

  for (const column of board.columns) {
    lines.push(column.title)

    for (const card of column.cards) {
      // 归档卡片照样索引：它没被删除，用户仍然会去找它
      lines.push(card.title)
      if (card.description) lines.push(card.description)
      if (card.assignee) lines.push(card.assignee)
      // 关联笔记只收文件名——完整路径会把目录名混进正文，干扰相关度
      if (card.notePath) lines.push(stem(card.notePath))
      for (const item of card.checklist) lines.push(item.text)
      for (const tag of card.tags) tags.add(tag)
    }
  }

  return { content: lines.filter(Boolean).join('\n'), tags: [...tags] }
}

/**
 * 画板。
 *
 * 图形按从上到下、从左到右排序后再拼接：画板上的文字没有天然顺序，
 * 而用户对「哪句话在哪句话上面」是有空间记忆的，用 JSON 里的数组顺序
 * （等于图形的创建顺序）拼出来的片段会读着莫名其妙。
 */
export function canvasText(canvas: CanvasDoc): ExtractedText {
  const lines = [...canvas.shapes]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((shape) => {
      if (shape.kind === 'noteRef') return shape.path ? stem(shape.path) : ''
      return 'text' in shape ? shape.text : ''
    })
    .filter(Boolean)

  return { content: lines.join('\n'), tags: [] }
}
