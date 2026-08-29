import { isDesktop } from '../storage/desktop'

/**
 * 把导出结果交到用户手上。
 *
 * 两端的「交付」含义不同：网页版只能走浏览器下载（落到下载目录），
 * 客户端则应当让用户自己挑保存位置——它本来就有完整的文件系统权限，
 * 强行走下载目录反而比网页版还别扭。
 */

export interface SaveResult {
  /** 用户取消了保存对话框（仅客户端可能出现） */
  cancelled: boolean
  /** 实际保存到的路径；网页版拿不到，为 null */
  path: string | null
}

export async function saveFile(
  fileName: string,
  data: Uint8Array,
  options: { filters?: Array<{ name: string; extensions: string[] }> } = {},
): Promise<SaveResult> {
  if (isDesktop()) return saveViaDialog(fileName, data, options.filters)

  downloadInBrowser(fileName, data)
  return { cancelled: false, path: null }
}

/** 客户端：弹保存对话框，让用户决定放哪 */
async function saveViaDialog(
  fileName: string,
  data: Uint8Array,
  filters?: Array<{ name: string; extensions: string[] }>,
): Promise<SaveResult> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const target = await save({ defaultPath: fileName, ...(filters ? { filters } : {}) })
  if (!target) return { cancelled: true, path: null }

  // 走自定义命令而不是 plugin-fs：用户选的位置不在 fs 作用域内，
  // 为它放行一个目录属于过度授权（见 src-tauri/src/lib.rs 的 write_export）
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('write_export', { path: target, contents: Array.from(data) })

  return { cancelled: false, path: target }
}

/**
 * 网页版：临时 a 标签触发下载。
 *
 * 用完立刻 revoke——Blob URL 会一直占着内存直到页面关闭，
 * 而导出的整库压缩包可能有几十 MB。
 */
function downloadInBrowser(fileName: string, data: Uint8Array): void {
  // 复制进独立的 ArrayBuffer：data 可能是某个更大缓冲区的视图，
  // 直接交给 Blob 会把整块内存都算进去
  const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()

  URL.revokeObjectURL(url)
}
