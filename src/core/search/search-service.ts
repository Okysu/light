import MiniSearch from 'minisearch'
import { BoardService } from '../board/board-service'
import { CanvasService } from '../canvas/canvas-service'
import { parseDocument, readString, readStringArray } from '../markdown/frontmatter'
import type { StorageAdapter } from '../storage'
import { flattenTree, kindOf, scanTree, type FileKind } from '../workspace/tree'
import { stem } from '../path'
import { boardText, canvasText } from './document-text'
import { tokenize } from './tokenizer'
import { readProtectedText } from '../security/local-vault'

/**
 * 全文搜索（需求 11.1 / S8）。
 *
 * 索引建在内存里、由磁盘内容推导，因此**不需要与磁盘做状态同步**——
 * 这与「文件即真源」是一致的：索引随时可以丢弃重建，永远不会成为第二份真相。
 *
 * 三种检索方式各有分工：
 * - 普通查询走 MiniSearch 的倒排索引，前缀 + 模糊匹配，速度与相关度都由它负责；
 * - 正则查询绕开索引直接扫描正文——正则无法用倒排加速，且用户用正则时通常
 *   就是要精确控制匹配，走索引反而会因分词而漏；
 * - 高亮由 `locateMatches` 在原文里定位，返回字符区间交给 UI 渲染。
 */

export interface SearchDocument {
  /** 相对数据目录根的路径，同时是索引主键 */
  path: string
  title: string
  content: string
  tags: string[]
  /** 笔记 / 看板 / 画板。搜索结果要靠它显示对应图标并说明来源 */
  kind: FileKind
}

export interface MatchRange {
  start: number
  end: number
}

export interface SearchHit {
  path: string
  title: string
  kind: FileKind
  /** 命中位置附近的正文片段 */
  snippet: string
  /** 片段内的高亮区间，坐标相对 snippet */
  ranges: MatchRange[]
  tags: string[]
  score: number
}

export interface SearchOptions {
  /** 按正则匹配，绕开索引直接扫描 */
  regex?: boolean
  /** 正则是否区分大小写 */
  caseSensitive?: boolean
  /** 只搜索该目录下的内容 */
  scope?: string
  limit?: number
}

/** 片段在命中位置前后各取多少字符 */
const SNIPPET_PADDING = 36
const DEFAULT_LIMIT = 50

export class SearchService {
  private index: MiniSearch<SearchDocument>
  /** 保留原文用于生成片段与正则扫描；MiniSearch 内部只存倒排表 */
  private readonly documents = new Map<string, SearchDocument>()
  private ready = false

  /**
   * 看板与画板复用各自模块的归一化读取，而不是在这里重新解析 JSON。
   * 自己解析等于把「文件长什么样」这件事再实现一遍，两处迟早会分叉。
   */
  private readonly boards: BoardService
  private readonly canvases: CanvasService

  constructor(private readonly storage: StorageAdapter) {
    this.index = SearchService.createIndex()
    this.boards = new BoardService(storage)
    this.canvases = new CanvasService(storage)
  }

  private static createIndex(): MiniSearch<SearchDocument> {
    return new MiniSearch<SearchDocument>({
      idField: 'path',
      fields: ['title', 'content', 'tags'],
      storeFields: ['path', 'title', 'tags', 'kind'],
      // 标题命中比正文更能说明相关性
      searchOptions: {
        boost: { title: 3, tags: 2 },
        prefix: true,
        fuzzy: 0.2,
      },
      tokenize,
      processTerm: (term) => term.toLowerCase(),
    })
  }

  get isReady(): boolean {
    return this.ready
  }

  get size(): number {
    return this.documents.size
  }

  /** 全量重建。首次搜索前调用，或在外部大幅改动文件后手动触发。 */
  async build(): Promise<void> {
    // 三种文档一视同仁。看板卡片和画板便利贴上的字同样是用户写下的内容，
    // 「搜不到」在用户看来就是丢了
    const nodes = flattenTree(await scanTree(this.storage)).filter((node) => node.kind !== 'folder')

    this.index = SearchService.createIndex()
    this.documents.clear()

    const documents: SearchDocument[] = []
    for (const node of nodes) {
      const document = await this.read(node.path)
      if (!document) continue
      this.documents.set(document.path, document)
      documents.push(document)
    }

    this.index.addAll(documents)
    this.ready = true
  }

  /** 单篇更新：保存笔记后调用，避免为一次编辑重建整个索引 */
  async update(path: string): Promise<void> {
    if (!this.ready) return

    this.remove(path)
    const document = await this.read(path)
    if (!document) return

    this.documents.set(path, document)
    this.index.add(document)
  }

  remove(path: string): void {
    if (!this.documents.has(path)) return
    // discard 允许删除不存在的文档而不抛错，比 remove 更适合这里的调用时机
    this.index.discard(path)
    this.documents.delete(path)
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const keyword = query.trim()
    if (!keyword) return []

    return options.regex ? this.searchByRegex(keyword, options) : this.searchByIndex(keyword, options)
  }

  // --- 内部 ---------------------------------------------------------------

  private async read(path: string): Promise<SearchDocument | null> {
    const kind = kindOf(path)
    if (!kind) return null

    try {
      if (kind === 'board') {
        return { path, title: stem(path), kind, ...boardText(await this.boards.read(path)) }
      }
      if (kind === 'canvas') {
        return { path, title: stem(path), kind, ...canvasText(await this.canvases.read(path)) }
      }

      const { data, content } = parseDocument(await readProtectedText(await this.storage.readText(path)))
      return {
        path,
        title: readString(data, 'title') ?? stem(path),
        content,
        tags: readStringArray(data, 'tags'),
        kind,
      }
    } catch {
      // 单篇读失败不应让整个索引建不起来
      return null
    }
  }

  private inScope(path: string, scope?: string): boolean {
    if (!scope) return true
    return path === scope || path.startsWith(`${scope}/`)
  }

  private searchByIndex(keyword: string, options: SearchOptions): SearchHit[] {
    const results = this.index.search(keyword)
    const hits: SearchHit[] = []

    for (const result of results) {
      const document = this.documents.get(String(result.id))
      if (!document || !this.inScope(document.path, options.scope)) continue

      hits.push({
        path: document.path,
        title: document.title,
        kind: document.kind,
        tags: document.tags,
        score: result.score,
        ...this.buildSnippet(document.content, (text) => locateQuery(text, keyword)),
      })

      if (hits.length >= (options.limit ?? DEFAULT_LIMIT)) break
    }

    return hits
  }

  private searchByRegex(pattern: string, options: SearchOptions): SearchHit[] {
    let regex: RegExp
    try {
      regex = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi')
    } catch {
      // 正则写到一半必然是非法的，此时返回空结果而不是抛错
      return []
    }

    const hits: SearchHit[] = []
    for (const document of this.documents.values()) {
      if (!this.inScope(document.path, options.scope)) continue

      const matches = locateRegex(document.content, regex)
      if (matches.length === 0) continue

      hits.push({
        path: document.path,
        title: document.title,
        kind: document.kind,
        tags: document.tags,
        // 正则没有相关度概念，用命中次数替代，多者靠前
        score: matches.length,
        ...this.buildSnippet(document.content, () => matches),
      })

      if (hits.length >= (options.limit ?? DEFAULT_LIMIT)) break
    }

    return hits.sort((a, b) => b.score - a.score)
  }

  /** 截取匹配最密集处的片段，并把高亮区间换算到片段坐标系 */
  private buildSnippet(
    content: string,
    locate: (text: string) => MatchRange[],
  ): { snippet: string; ranges: MatchRange[] } {
    const matches = locate(content)
    if (matches.length === 0) {
      return { snippet: content.slice(0, SNIPPET_PADDING * 2).trim(), ranges: [] }
    }

    // 取匹配最密集的一段，而不是第一个匹配：查询词的某个片段可能在正文开头
    // 偶然出现一次，只看第一处会把用户带到毫不相关的位置
    const anchor = densestMatch(matches, SNIPPET_PADDING * 2)
    const start = Math.max(0, anchor.start - SNIPPET_PADDING)
    const end = Math.min(content.length, anchor.end + SNIPPET_PADDING)

    const prefix = start > 0 ? '…' : ''
    const suffix = end < content.length ? '…' : ''
    const slice = content.slice(start, end)

    // 只保留落在片段内的区间，并平移到片段坐标
    const ranges = matches
      .filter((match) => match.start >= start && match.end <= end)
      .map((match) => ({
        start: match.start - start + prefix.length,
        end: match.end - start + prefix.length,
      }))

    return { snippet: `${prefix}${slice}${suffix}`, ranges }
  }
}

/**
 * 定位查询在正文中的位置，用于高亮。
 *
 * **分层**而不是把完整串与词元混在一起找：
 * 混着找时，某个短词元可能命中比完整串更靠前的位置，片段就被带偏了
 * （搜「启动持久化」却定位到正文开头某个「化」字）。
 *
 * 因此先只用完整查询串——命中即用，这是最精确的结果；
 * 完整串不出现时（多词查询、模糊匹配命中的近似词）才退到分词词元，
 * 且丢弃单字词元，它们在正文里遍地都是、没有区分度。
 */
export function locateQuery(text: string, query: string): MatchRange[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return []

  const exact = locateTerms(text, [keyword])
  if (exact.length > 0) return exact

  const meaningful = tokenize(keyword).filter((token) => token.length >= 2)
  return meaningful.length > 0 ? locateTerms(text, meaningful) : []
}

/** 在给定窗口内包含匹配最多的那一处 */
function densestMatch(matches: MatchRange[], window: number): MatchRange {
  let best = matches[0]!
  let bestCount = 0

  for (let i = 0; i < matches.length; i += 1) {
    const head = matches[i]!
    let count = 0
    for (let j = i; j < matches.length && matches[j]!.start - head.start <= window; j += 1) count += 1

    if (count > bestCount) {
      bestCount = count
      best = head
    }
  }

  return best
}

/** 在原文中定位各词元的出现位置，用于高亮 */
export function locateTerms(text: string, terms: string[]): MatchRange[] {
  if (terms.length === 0) return []

  const haystack = text.toLowerCase()
  const ranges: MatchRange[] = []

  for (const term of terms) {
    let from = 0
    while (from < haystack.length) {
      const index = haystack.indexOf(term, from)
      if (index === -1) break
      ranges.push({ start: index, end: index + term.length })
      from = index + term.length
    }
  }

  return mergeRanges(ranges)
}

export function locateRegex(text: string, regex: RegExp): MatchRange[] {
  const ranges: MatchRange[] = []
  regex.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    // 零宽匹配（如 `a*`）会让 exec 原地打转，必须手动推进
    if (match[0].length === 0) {
      regex.lastIndex += 1
      continue
    }
    ranges.push({ start: match.index, end: match.index + match[0].length })
    if (ranges.length > 500) break
  }

  return mergeRanges(ranges)
}

/** 合并重叠区间，避免高亮标签相互嵌套 */
export function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return ranges

  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: MatchRange[] = [sorted[0]!]

  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]!
    if (range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push(range)
  }

  return merged
}
