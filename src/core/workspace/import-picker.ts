import { isDesktop } from '../storage/desktop'
import type { StorageAdapter } from '../storage'
import { importFiles, type ImportResult } from './import-service'

/**
 * 「把已有文档搬进来」的两端实现。
 *
 * 两端的**规则**（避让、跳过隐藏项、保留目录结构）必须一致，见 import-service.ts；
 * 差别只在数据怎么过来：
 *
 * - 客户端交给 Rust 直接复制。快，而且前端全程不需要拿到源目录的读权限——
 *   为一次性的导入换一份长期授权是不划算的买卖。
 * - 网页端只能走 `<input type="file">`：浏览器不给任意路径的访问权，
 *   用户当场选中的文件是唯一的入口。
 */

export type ImportSource = 'file' | 'folder'

/**
 * 弹出选择框并把选中的内容导入 `targetDir`。
 *
 * @param absoluteTargetDir 客户端用的绝对路径；网页端传空串即可
 * @returns 取消选择时为 null
 */
export async function pickAndImport(
  storage: StorageAdapter,
  source: ImportSource,
  targetDir: string,
  absoluteTargetDir: string,
): Promise<ImportResult | null> {
  return isDesktop()
    ? importFromDesktop(source, absoluteTargetDir)
    : importFromBrowser(storage, source, targetDir)
}

async function importFromDesktop(
  source: ImportSource,
  absoluteTargetDir: string,
): Promise<ImportResult | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    directory: source === 'folder',
    multiple: source === 'file',
    title: source === 'folder' ? '选择要导入的文件夹' : '选择要导入的文件',
  })

  const paths = normalizeSelection(selected)
  if (paths.length === 0) return null

  const { invoke } = await import('@tauri-apps/api/core')
  const total: ImportResult = { imported: 0, skipped: [] }

  // 多选文件时逐个调用：一次失败只丢那一个，其余照常进来
  for (const path of paths) {
    try {
      const outcome = await invoke<{ imported: number; skipped: number }>('import_path', {
        source: path,
        target: absoluteTargetDir,
      })
      total.imported += outcome.imported
      // Rust 侧只回条数（它不知道前端要怎么展示路径），凑成同样长度的占位
      total.skipped.push(...Array.from({ length: outcome.skipped }, () => path))
    } catch {
      total.skipped.push(path)
    }
  }

  return total
}

function normalizeSelection(selected: string | string[] | null): string[] {
  if (typeof selected === 'string') return [selected]
  return Array.isArray(selected) ? selected : []
}

/**
 * 网页端：临时的 file input。
 *
 * `webkitdirectory` 不是标准属性但三大浏览器都实现了，且没有替代品——
 * File System Access API 只有 Chromium 有，覆盖面反而更窄。
 */
async function importFromBrowser(
  storage: StorageAdapter,
  source: ImportSource,
  targetDir: string,
): Promise<ImportResult | null> {
  const files = await pickBrowserFiles(source)
  if (!files) return null

  const payload = await Promise.all(
    files.map(async (file) => ({
      // 选文件夹时 webkitRelativePath 带着结构，选文件时它是空串
      path: file.webkitRelativePath || file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  )

  return importFiles(storage, targetDir, payload)
}

function pickBrowserFiles(source: ImportSource): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (source === 'folder') input.webkitdirectory = true

    // 取消选择不触发 change，只有 cancel（较新的浏览器）——
    // 不支持 cancel 的浏览器上这个 Promise 会一直挂着，但它只挂着一个
    // 隐藏 input，不占用户任何东西，比轮询焦点那类 hack 干净
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.addEventListener(
      'change',
      () => resolve(input.files ? Array.from(input.files) : null),
      { once: true },
    )

    input.click()
  })
}
