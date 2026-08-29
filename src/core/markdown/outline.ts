export interface OutlineHeading {
  level: number
  text: string
  /** 文档中的第几个标题（从 0 起），用于和渲染出的标题元素一一对应 */
  index: number
}

/** 围栏代码块的起止行，例如 ``` 或 ~~~~ 开头 */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/

/**
 * 从 Markdown 正文提取标题大纲。
 *
 * 放在 core 而非组件里，是因为「哪些 `#` 才算标题」有真实的边界情况——
 * 代码块里的注释、setext 下划线式标题、行尾的收尾井号——这些值得被单测锁住，
 * 而不是塞进一个渲染函数里凭感觉写。
 */
export function parseOutline(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = []
  const lines = markdown.split(/\r?\n/)

  let fence: string | null = null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''

    // 代码块内的一切都不算标题
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]!
      if (fence === null) fence = marker[0] ?? null
      else if (marker[0] === fence) fence = null
      continue
    }
    if (fence !== null) continue

    const atx = ATX_HEADING.exec(line)
    if (atx) {
      headings.push({
        level: atx[1]!.length,
        text: cleanText(stripClosingHashes(atx[2] ?? '')),
        index: headings.length,
      })
      continue
    }

    // setext：正文行下面跟一整行 === 或 ---，分别是一级、二级标题
    const next = lines[i + 1]
    if (next && line.trim() && /^\s{0,3}(=+|-+)\s*$/.test(next)) {
      // 前一行若是空行才成立，否则 --- 只是分割线
      headings.push({
        level: next.trim().startsWith('=') ? 1 : 2,
        text: cleanText(line),
        index: headings.length,
      })
      i += 1
    }
  }

  return headings
}

/** ATX 标题允许以任意个 # 收尾，如 `## 标题 ##` */
function stripClosingHashes(text: string): string {
  return text.replace(/\s+#+\s*$/, '')
}

/** 去掉行内标记，大纲里显示纯文本 */
function cleanText(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/([*_~])\1?([^*_~]*)\1?\1/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
}
