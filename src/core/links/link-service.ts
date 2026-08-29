import { parseDocument } from '../markdown/frontmatter'
import type { StorageAdapter } from '../storage'
import { flattenTree, scanTree } from '../workspace/tree'
import { buildLinkGraph, type LinkGraph, type LinkSource } from './link-graph'
import { readProtectedText } from '../security/local-vault'

/**
 * 全库链接图的构建与增量维护。
 *
 * 与 SearchService 同构：懒构建、可整体丢弃重建、单篇更新走增量。
 * 差别在于链接图是**全局关系**——改一篇笔记会影响它指向的所有笔记的反向链接，
 * 所以增量更新只能替换该篇的源文本再重算图，不能像倒排索引那样只动一条记录。
 *
 * 重算的代价可以接受：图的构建是纯字符串扫描，没有分词与排序。
 */
export class LinkService {
  private sources = new Map<string, string>()
  private graph: LinkGraph = buildLinkGraph([])
  private ready = false

  constructor(private readonly storage: StorageAdapter) {}

  get isReady(): boolean {
    return this.ready
  }

  get current(): LinkGraph {
    return this.graph
  }

  get size(): number {
    return this.sources.size
  }

  async build(): Promise<void> {
    const nodes = flattenTree(await scanTree(this.storage)).filter((node) => node.kind === 'note')

    this.sources.clear()
    for (const node of nodes) {
      const content = await this.read(node.path)
      if (content !== null) this.sources.set(node.path, content)
    }

    this.rebuild()
    this.ready = true
  }

  /** 单篇更新：保存后调用。会重算整张图，因为一篇的改动会影响别人的反向链接。 */
  async update(path: string): Promise<void> {
    if (!this.ready) return

    const content = await this.read(path)
    if (content === null) this.sources.delete(path)
    else this.sources.set(path, content)

    this.rebuild()
  }

  /** 笔记被删除或移走 */
  remove(path: string): void {
    if (!this.sources.delete(path)) return
    this.rebuild()
  }

  private rebuild(): void {
    const sources: LinkSource[] = [...this.sources].map(([path, content]) => ({ path, content }))
    this.graph = buildLinkGraph(sources)
  }

  /**
   * 只取正文：frontmatter 里的值不该被当成链接来源。
   * 属性里写 `[[x]]` 是数据而非引用，混进来会让反向链接面板出现无处可点的条目。
   */
  private async read(path: string): Promise<string | null> {
    try {
      return parseDocument(await readProtectedText(await this.storage.readText(path))).content
    } catch {
      // 单篇读不出来不该让整张图建不起来
      return null
    }
  }
}
