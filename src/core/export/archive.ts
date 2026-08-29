import { zip, type Zippable } from 'fflate'
import type { StorageAdapter } from '../storage'
import { flattenTree, scanTree } from '../workspace/tree'

/**
 * 把工作区打包成 ZIP（需求 10.2，并兑现 10.3「数据完全可迁移」）。
 *
 * 这个功能对**网页版尤其要紧**：数据存在 OPFS 里，用户在文件管理器中根本
 * 看不到那些文件。没有导出，「本地优先」就只是一句口号——数据在你的设备上，
 * 但你拿不走。
 *
 * 导出的是**原始字节**，不做任何转换：Markdown 还是那份 Markdown，
 * frontmatter 原样保留，附件按原路径归档。解压出来就是一个可以直接用
 * Obsidian 打开的 Vault。
 */

export interface ArchiveEntry {
  /** ZIP 内的路径，使用正斜杠 */
  path: string
  data: Uint8Array
}

export interface ArchiveOptions {
  /** 只导出这些路径（含目录）；为空表示整个工作区 */
  include?: readonly string[]
  /** 是否带上 `.light/` 里的工作区配置与属性定义 */
  includeConfig?: boolean
}

/** 工作区内部目录，存放配置而非用户内容 */
const INTERNAL_DIR = '.light/'
/** 回收站属于已删除内容，导出时一律排除——用户要的是「现在的库」 */
const TRASH_DIR = '.light/trash/'

/**
 * 收集要打包的条目。
 *
 * 与压缩分开，是为了让「选了哪些文件」这件事能脱离 fflate 单测——
 * 排除规则（回收站、内部目录、前缀匹配）才是真正容易出错的部分。
 */
export async function collectArchiveEntries(
  storage: StorageAdapter,
  options: ArchiveOptions = {},
): Promise<ArchiveEntry[]> {
  const { include, includeConfig = true } = options

  const nodes = flattenTree(await scanTree(storage)).filter((node) => node.kind !== 'folder')
  const entries: ArchiveEntry[] = []

  for (const node of nodes) {
    if (!shouldInclude(node.path, include)) continue

    try {
      entries.push({ path: node.path, data: await storage.readBinary(node.path) })
    } catch {
      // 单个文件读不出来不该让整包导不出去——宁可少一篇，也别让用户一无所获
      continue
    }
  }

  if (includeConfig && !include) {
    for (const path of await configPaths(storage)) {
      try {
        entries.push({ path, data: await storage.readBinary(path) })
      } catch {
        continue
      }
    }
  }

  return entries
}

/**
 * 路径是否应当进入压缩包。
 *
 * `include` 里既可能是文件也可能是目录，因此目录要按**路径前缀**匹配，
 * 且必须带上分隔符——否则导出「笔记」会把「笔记归档」也一并带走。
 */
function shouldInclude(path: string, include?: readonly string[]): boolean {
  if (path.startsWith(TRASH_DIR)) return false
  if (path.startsWith(INTERNAL_DIR)) return false

  if (!include || include.length === 0) return true

  return include.some((item) => path === item || path.startsWith(`${item}/`))
}

/** `.light/` 下值得一并带走的配置：换台设备解压后属性定义与设置都还在 */
async function configPaths(storage: StorageAdapter): Promise<string[]> {
  // sync.json 只有公开的远端位置与策略；本机凭据和 sync-state 都不在 Vault，
  // 因此导出它不会泄露密钥，也不会把某台设备的同步基线带到另一台。
  const candidates = ['.light/workspace.json', '.light/properties.json', '.light/themes.json', '.light/sync.json']
  const existing: string[] = []

  for (const path of candidates) {
    if (await storage.exists(path)) existing.push(path)
  }

  // 扩展代码与非敏感配置本就是 Vault 的一部分。设备授权、启用状态和 secret
  // 存在应用本地存储中，不会被这里带走。
  if (await storage.exists('.light/extensions')) {
    await collectInternalFiles(storage, '.light/extensions', existing)
  }

  return existing
}

async function collectInternalFiles(storage: StorageAdapter, dir: string, output: string[]): Promise<void> {
  for (const entry of await storage.list(dir)) {
    if (entry.isDirectory) await collectInternalFiles(storage, entry.path, output)
    else output.push(entry.path)
  }
}

/** 打包成 ZIP 字节流 */
export function createArchive(entries: readonly ArchiveEntry[]): Promise<Uint8Array> {
  const payload: Zippable = {}
  for (const entry of entries) payload[entry.path] = entry.data

  return new Promise((resolve, reject) => {
    // level 6 是体积与耗时的常见折中；Markdown 本身压缩率很高，再往上收益甚微
    zip(payload, { level: 6 }, (error, data) => {
      if (error) reject(error)
      else resolve(data)
    })
  })
}

/**
 * 生成压缩包文件名。
 *
 * 带上日期，因为导出往往是「阶段性备份」，同一个工作区会导好几次，
 * 文件名一样只会让人分不清哪份是新的。
 * @param at 由调用方传入，纯函数才好测
 */
export function archiveFileName(workspaceName: string, at: Date): string {
  const safe = workspaceName.trim().replace(/[\\/:*?"<>|]/g, '_') || 'workspace'
  const stamp = [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, '0'),
    String(at.getDate()).padStart(2, '0'),
  ].join('')

  return `${safe}-${stamp}.zip`
}
