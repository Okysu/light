/**
 * 双向链接 `[[目标]]`（需求 2.3，并支撑 11.2 知识图谱）。
 *
 * 语法遵循 Obsidian 惯例而不是自创一套：`[[路径/名称#锚点|显示文本]]`。
 * 理由有二——需求 10.1 要求能导入 Obsidian Vault，语法一致才谈得上「导入即可用」；
 * 用户从 Obsidian 迁移过来，肌肉记忆也是这一套。
 *
 * 这里是**只读扫描**，用于建立全库链接索引；编辑器内的解析与序列化交给
 * micromark/mdast 的上游实现（见 features/editor/extensions/wikilink.ts），
 * 两者不共用代码但共用同一套语法约定，因此测试对两边用同样的边界用例。
 *
 * 之所以不在这里也走 remark：索引要扫描**每一篇**笔记，为此拉起完整的
 * unified 管道开销显著，而扫描规则本身（跳过代码、处理转义）边界清晰、可测。
 * `core/markdown/outline.ts` 已经是同样的取舍。
 */

export interface WikilinkRef {
  /** `[[ ]]` 中 `|` 之前、`#` 之前的部分，即链接目标 */
  target: string
  /** `#` 之后的段内锚点；没有则为空串 */
  hash: string
  /** 界面上显示的文本：有别名用别名，否则用目标原文 */
  label: string
  /** 是否是嵌入语法 `![[...]]`——目前只识别，不渲染 */
  embed: boolean
  /** 整个链接在原文中的偏移，`[start, end)`，含 `![[` 的感叹号 */
  start: number
  end: number
  /**
   * 目标部分在原文中的偏移。
   * 单独记下来是为了让改名能**只替换目标**——别名、锚点、嵌入前缀原样保留，
   * 重新拼一遍 `[[...]]` 则会在无意间抹掉用户写的别名。
   */
  targetStart: number
  targetEnd: number
}

/** 围栏代码块的起止行，与 outline.ts 保持同一套判定 */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * 从 Markdown 中提取全部 wikilink。
 *
 * 顺序敏感的三件事，缺一都会产生假匹配：
 * 1. 围栏代码块内整段跳过
 * 2. 行内代码 `` `...` `` 内跳过——反引号按**数量配对**，因为 ``` `` [[x]] `` ``` 是合法写法
 * 3. `\[[` 这样的转义不算链接
 */
export function extractWikilinks(markdown: string): WikilinkRef[] {
  const refs: WikilinkRef[] = []
  // 按 \n 切而不是 /\r?\n/：偏移量必须能还原到原文，切掉 \r 会让位置整体前移。
  // 残留的 \r 落在行尾，既不影响围栏判定，也不影响链接扫描。
  const lines = markdown.split('\n')

  let fence: string | null = null
  let lineStart = 0

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]!
      if (fence === null) fence = marker[0] ?? null
      else if (marker[0] === fence) fence = null
    } else if (fence === null) {
      collectFromLine(line, lineStart, refs)
    }

    lineStart += line.length + 1 // +1 是被切掉的换行符
  }

  return refs
}

function collectFromLine(line: string, lineStart: number, refs: WikilinkRef[]): void {
  let i = 0

  while (i < line.length) {
    const char = line[i]!

    // 反引号：跳到同长度的收尾反引号，中间一律不解析
    if (char === '`') {
      const open = countRun(line, i, '`')
      const close = findClosingRun(line, i + open, '`', open)
      i = close === -1 ? line.length : close + open
      continue
    }

    // 反斜杠转义：连同被转义的字符一起跳过
    if (char === '\\') {
      i += 2
      continue
    }

    if (char === '[' && line[i + 1] === '[') {
      const end = line.indexOf(']]', i + 2)
      if (end === -1) {
        i += 2
        continue
      }

      const inner = line.slice(i + 2, end)
      // 内层再出现 `[[` 说明外层那对不成立，从内层重新开始扫
      if (!inner.includes('[[')) {
        const embed = line[i - 1] === '!'
        const ref = parseInner(inner, embed, lineStart + i + 2)
        if (ref) {
          // start 要含上 `!`，否则改写时会把嵌入前缀留在外面
          refs.push({ ...ref, start: lineStart + i - (embed ? 1 : 0), end: lineStart + end + 2 })
        }
      }
      i = end + 2
      continue
    }

    i += 1
  }
}

/**
 * 把 `路径#锚点|别名` 拆开。
 * @param innerStart inner 在原文中的起始偏移，用来算出 target 的精确位置
 */
function parseInner(
  inner: string,
  embed: boolean,
  innerStart: number,
): Omit<WikilinkRef, 'start' | 'end'> | null {
  if (inner.trim() === '') return null

  const pipe = inner.indexOf('|')
  const alias = pipe === -1 ? '' : inner.slice(pipe + 1).trim()
  const beforeAlias = pipe === -1 ? inner : inner.slice(0, pipe)

  const hashAt = beforeAlias.indexOf('#')
  const rawTarget = hashAt === -1 ? beforeAlias : beforeAlias.slice(0, hashAt)
  const target = rawTarget.trim()
  const hash = hashAt === -1 ? '' : beforeAlias.slice(hashAt + 1).trim()

  // `[[#锚点]]` 是指向本篇内部的跳转，target 为空但依然合法
  if (target === '' && hash === '') return null

  // 目标两侧可能有空格（`[[ 笔记 ]]`），替换时只覆盖非空白的那一段
  const leading = rawTarget.length - rawTarget.trimStart().length
  const targetStart = innerStart + leading

  return {
    target,
    hash,
    label: alias || (target || `#${hash}`),
    embed,
    targetStart,
    targetEnd: targetStart + target.length,
  }
}

function countRun(line: string, from: number, char: string): number {
  let count = 0
  while (line[from + count] === char) count += 1
  return count
}

/** 找到长度**恰好**为 length 的下一段连续 char，返回起始下标 */
function findClosingRun(line: string, from: number, char: string, length: number): number {
  let i = from
  while (i < line.length) {
    if (line[i] !== char) {
      i += 1
      continue
    }
    const run = countRun(line, i, char)
    if (run === length) return i
    i += run
  }
  return -1
}

/**
 * 把链接目标解析成工作区里的实际路径。
 *
 * 与 Obsidian 一致的三级匹配：
 * 1. 当作完整路径（可省略 `.md`）
 * 2. 当作文件名，在全库范围内找
 * 3. 找不到就是「尚未创建」——不是错误，允许先写链接后建笔记
 *
 * 同名文件多于一个时取路径字典序最小的那个。这不见得总是用户想要的，
 * 但**可预测**比「看起来聪明」更重要：换个顺序扫描就跳到另一篇，才是真的难查。
 */
export function resolveWikilink(target: string, paths: readonly string[]): string | null {
  const wanted = target.trim().replace(/^\.\//, '')
  if (!wanted) return null

  const withExt = wanted.toLowerCase().endsWith('.md') ? wanted : `${wanted}.md`

  const exact = paths.find((path) => path === withExt || path === wanted)
  if (exact) return exact

  const wantedBase = basename(withExt).toLowerCase()
  const candidates = paths.filter((path) => basename(path).toLowerCase() === wantedBase)

  return candidates.length > 0 ? [...candidates].sort()[0]! : null
}

function basename(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? path : path.slice(at + 1)
}

/** 从路径反推出写进 `[[ ]]` 的目标：优先用不带扩展名的文件名，重名时才带上路径 */
export function wikilinkTargetFor(path: string, paths: readonly string[]): string {
  const base = basename(path).replace(/\.md$/i, '')
  const sameName = paths.filter((item) => basename(item).replace(/\.md$/i, '') === base)

  return sameName.length > 1 ? path.replace(/\.md$/i, '') : base
}

/**
 * 按目标改写链接，用于笔记改名 / 移动后让引用跟上。
 *
 * 只替换**目标那一段**：别名、锚点、嵌入前缀、目标两侧的空格全部原样保留。
 * 重新拼一遍 `[[...]]` 看似更简单，但会在无意间抹掉用户写的别名——
 * 而别名往往是正文语句的一部分，抹掉就读不通了。
 *
 * @param rename 收到一条链接，返回新目标；返回 null 表示不动它
 * @returns 改写后的 Markdown；没有任何改动时返回原字符串本身
 */
export function rewriteWikilinks(
  markdown: string,
  rename: (ref: WikilinkRef) => string | null,
): string {
  const refs = extractWikilinks(markdown)
  if (refs.length === 0) return markdown

  // 从后往前替换：先改前面的会让后面所有偏移失效
  let result = markdown
  let changed = false

  for (let i = refs.length - 1; i >= 0; i -= 1) {
    const ref = refs[i]!
    const next = rename(ref)
    if (next === null || next === ref.target) continue

    result = result.slice(0, ref.targetStart) + next + result.slice(ref.targetEnd)
    changed = true
  }

  return changed ? result : markdown
}
