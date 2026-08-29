import { createCard, createEmptyBoard, type Board } from '@/core/board/types'
import { createEmptyCanvas, type CanvasDoc, type NoteShape, type Shape } from '@/core/canvas/types'

function cleanLine(value: string): string {
  return value
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s*)/, '')
    .trim()
}

/** 把模型给出的逐行任务变成真正可编辑的看板，而不是让用户手工复制。 */
export function boardFromTaskLines(source: string, newId: () => string): Board {
  const board = createEmptyBoard(newId)
  const cards = source.split(/\r?\n/).map(cleanLine).filter(Boolean)
  board.columns[0]!.cards = cards.map((title) => createCard(newId, title))
  return board
}

interface MindmapLine {
  depth: number
  text: string
}

function mindmapLines(source: string): MindmapLine[] {
  return source.split(/\r?\n/).flatMap((raw) => {
    const whitespace = raw.match(/^\s*/)?.[0] ?? ''
    const text = cleanLine(raw)
    if (!text) return []
    const spaces = whitespace.replace(/\t/g, '  ').length
    return [{ depth: Math.min(2, Math.floor(spaces / 2)), text }]
  })
}

/**
 * 把缩进脑图落成画板节点与连接线。布局确定、无随机抖动，便于同步与测试。
 * 遇到模型漏掉中间层级时，连接到最近的上级节点，结果仍然可用。
 */
export function canvasFromMindmap(source: string, newId: () => string): CanvasDoc {
  const document = createEmptyCanvas()
  const latestAtDepth: Array<NoteShape | undefined> = []
  const rowsAtDepth = [0, 0, 0]

  for (const item of mindmapLines(source)) {
    const width = 200
    const height = 82
    const node: NoteShape = {
      id: newId(), kind: 'note',
      x: 80 + item.depth * 300,
      y: 70 + rowsAtDepth[item.depth]! * 120,
      width, height,
      stroke: 'var(--border)', fill: item.depth === 0 ? 'var(--accent)' : 'var(--card)',
      strokeWidth: 1, locked: false, groupId: '', text: item.text,
    }
    rowsAtDepth[item.depth]! += 1

    let parent: NoteShape | undefined
    for (let depth = item.depth - 1; depth >= 0 && !parent; depth -= 1) parent = latestAtDepth[depth]
    if (parent) {
      const connector: Shape = {
        id: newId(), kind: 'arrow',
        x: 0, y: 0, width: 0, height: 0,
        stroke: 'var(--muted-foreground)', fill: '', strokeWidth: 1.5,
        locked: false, groupId: '',
        from: { x: parent.x + parent.width, y: parent.y + parent.height / 2 },
        to: { x: node.x, y: node.y + node.height / 2 },
        fromId: parent.id, toId: node.id,
      }
      document.shapes.push(connector)
    }
    document.shapes.push(node)
    latestAtDepth[item.depth] = node
    latestAtDepth.length = item.depth + 1
  }
  return document
}
