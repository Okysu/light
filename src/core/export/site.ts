import type { StorageAdapter } from '../storage'
import { flattenTree, scanTree } from '../workspace/tree'
import type { ArchiveEntry } from './archive'
import { buildSiteModel, relativeHref, type SiteSource } from './site-model'
import { renderPage } from './site-render'
import { renderIndexHtml, renderPageHtml, SITE_CSS } from './site-template'
import { ATTACHMENTS_DIR } from '../workspace/types'
import { readProtectedText } from '../security/local-vault'

/**
 * 把工作区导出成一个可直接打开的静态站点（需求 10.2）。
 *
 * 整个模块由 store 动态 import：unified 一整条管线加上 katex 有几百 KB，
 * 而绝大多数会话不会用到导出，不该压在首屏上。
 */

/** 只导出笔记；看板 / 画板是 JSON，没有对应的 HTML 呈现 */
const NOTE_SUFFIX = '.md'
const TRASH_DIR = '.light/trash/'
const INTERNAL_DIR = '.light/'

export interface SiteExportResult {
  entries: ArchiveEntry[]
  pageCount: number
}

export async function buildSite(
  storage: StorageAdapter,
  siteName: string,
): Promise<SiteExportResult> {
  const sources = await collectSources(storage)
  const model = buildSiteModel(sources)

  const encoder = new TextEncoder()
  const entries: ArchiveEntry[] = [
    { path: 'style.css', data: encoder.encode(SITE_CSS) },
    { path: 'index.html', data: encoder.encode(renderIndexHtml(model.pages, siteName)) },
  ]

  for (const page of model.pages) {
    const html = await renderPage(page, model)
    const document = renderPageHtml({
      page,
      html,
      siteName,
      indexHref: relativeHref(page.href, 'index.html'),
      cssHref: relativeHref(page.href, 'style.css'),
    })

    entries.push({ path: page.href, data: encoder.encode(document) })
  }

  // 页面与源笔记保持相同目录结构，因此原 Markdown 中相对附件路径无需改写；
  // 只要把附件按原路径复制进站点即可离线显示/播放。
  if (await storage.exists(ATTACHMENTS_DIR)) {
    const assets = await collectFiles(storage, ATTACHMENTS_DIR)
    for (const path of assets) {
      try { entries.push({ path, data: await storage.readBinary(path) }) } catch { /* 单个损坏附件不阻断整站。 */ }
    }
  }

  return { entries, pageCount: model.pages.length }
}

/** scanTree 只认识三种文档扩展名；附件必须按原始文件系统递归，不能借文档树。 */
async function collectFiles(storage: StorageAdapter, directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await storage.list(directory)) {
    if (entry.isDirectory) files.push(...await collectFiles(storage, entry.path))
    else files.push(entry.path)
  }
  return files
}

async function collectSources(storage: StorageAdapter): Promise<SiteSource[]> {
  const nodes = flattenTree(await scanTree(storage)).filter(
    (node) =>
      node.kind === 'note' &&
      node.path.toLowerCase().endsWith(NOTE_SUFFIX) &&
      !node.path.startsWith(TRASH_DIR) &&
      !node.path.startsWith(INTERNAL_DIR),
  )

  const sources: SiteSource[] = []
  for (const node of nodes) {
    try {
      sources.push({ path: node.path, raw: await readProtectedText(await storage.readText(node.path)) })
    } catch {
      // 单篇读不出来不该让整站生不成——少一页好过一页都没有
      continue
    }
  }

  return sources
}
