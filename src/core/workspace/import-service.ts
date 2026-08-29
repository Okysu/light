import { basename, dirname, extname, joinPath, sanitizeFileName, segments, stem } from '../path'
import type { StorageAdapter } from '../storage'
import { uniquePath } from './unique-path'

/**
 * 导入外部文件与文件夹。
 *
 * 迁移是「换个工具继续用」的第一步，也是最容易劝退人的一步。这里的取舍：
 *
 * - **绝不覆盖**。同名一律避让成 `名称 (2).md`。导入是批量动作，用户不可能
 *   逐个确认；覆盖掉一篇同名旧笔记，损失是不可逆的，而多一个副本只是碍眼。
 * - **单个失败不中断整批**。导入几百个文件时因为其中一个读不了就全部回滚，
 *   比少一个文件糟得多。失败的记进 `skipped` 让用户知道是哪些。
 * - **跳过隐藏项**。从 Obsidian 库导入会带上 `.obsidian/`、`.git/`，
 *   那些是别的工具的内部状态，搬过来只会污染文件树。
 */

/** 待导入的一个文件。`path` 是相对导入根的 POSIX 路径，目录结构靠它保留 */
export interface ImportFile {
  path: string
  bytes: Uint8Array
}

export interface ImportResult {
  /** 成功写入的文件数 */
  imported: number
  /** 被跳过的原始路径（隐藏项、读失败、类型不支持） */
  skipped: string[]
}

/** 文本类扩展名用 writeText 走，其余按二进制处理 */
const TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.csv',
  '.yml',
  '.yaml',
  '.board',
  '.canvas',
])

/**
 * 把一批文件写进目标目录。
 *
 * 目录结构保留：`a/b/c.md` 导入到 `笔记` 下就是 `笔记/a/b/c.md`。
 * 避让只作用在**文件**上，不作用在中间目录——否则同一次导入里的
 * `a/1.md` 与 `a/2.md` 会被拆进 `a` 和 `a (2)` 两个目录里。
 */
export async function importFiles(
  storage: StorageAdapter,
  targetDir: string,
  files: readonly ImportFile[],
): Promise<ImportResult> {
  const skipped: string[] = []
  let imported = 0

  // 同一次导入内，同一个源目录只解析一次目标目录，保证结构不被拆散
  const resolvedDirs = new Map<string, string>([['', targetDir]])

  for (const file of files) {
    if (isHidden(file.path)) {
      skipped.push(file.path)
      continue
    }

    try {
      const dir = await resolveDir(storage, dirname(file.path), resolvedDirs, targetDir)
      const name = basename(file.path)
      const destination = await uniquePath(storage, dir, stem(name), extname(name))
      await write(storage, destination, file.bytes)
      imported += 1
    } catch {
      skipped.push(file.path)
    }
  }

  return { imported, skipped }
}

/**
 * 逐级解析源目录对应的目标目录，结果缓存。
 *
 * 目标已有同名目录就直接合并进去，不避让：用户把一个 `项目/` 导入到已有的
 * `项目/` 旁边，期待的是内容汇合，不是多出一个 `项目 (2)`。
 */
async function resolveDir(
  storage: StorageAdapter,
  sourceDir: string,
  cache: Map<string, string>,
  root: string,
): Promise<string> {
  const cached = cache.get(sourceDir)
  if (cached !== undefined) return cached

  let current = root
  for (const part of segments(sourceDir)) {
    current = joinPath(current, sanitizeFileName(part) || '未命名文件夹')
    if (!(await storage.exists(current))) await storage.mkdir(current)
  }

  cache.set(sourceDir, current)
  return current
}

async function write(storage: StorageAdapter, path: string, bytes: Uint8Array): Promise<void> {
  if (TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
    await storage.writeText(path, new TextDecoder().decode(bytes))
    return
  }
  await storage.writeBinary(path, bytes)
}

/** 路径上任何一段以 `.` 开头即视为隐藏 */
function isHidden(path: string): boolean {
  return segments(path).some((part) => part.startsWith('.'))
}
