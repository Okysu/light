import { joinPath, sanitizeFileName } from '../path'
import { StorageError, type StorageAdapter } from '../storage/types'

/**
 * 求一个当前不存在的路径：`名称.md`、`名称 (2).md`、`名称 (3).md` …
 *
 * 依赖 `storage.exists` 而非内存中的树，避免树缓存过期导致覆盖磁盘上的文件。
 * 这是「新建 / 重命名 / 复制 / 导入」共用的避让规则——**任何**会产生新文件的
 * 操作都必须走这里，否则总有一条路径会悄悄覆盖用户已有的内容。
 */
export async function uniquePath(
  storage: StorageAdapter,
  dir: string,
  rawName: string,
  ext: string,
): Promise<string> {
  const base = sanitizeFileName(rawName) || '未命名'
  for (let index = 1; index < 1000; index += 1) {
    const name = index === 1 ? base : `${base} (${index})`
    const candidate = joinPath(dir, `${name}${ext}`)
    if (!(await storage.exists(candidate))) return candidate
  }
  throw new StorageError('ALREADY_EXISTS', joinPath(dir, base), '同名条目过多，无法生成唯一名称')
}
