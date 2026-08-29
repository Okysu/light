import { defineStore } from 'pinia'
import { ref } from 'vue'
import { archiveFileName, collectArchiveEntries, createArchive } from '@/core/export/archive'
import { saveFile } from '@/core/export/download'
import { stem } from '@/core/path'
import { useWorkspaceStore } from './workspace'

const EXPORT_NAME = 'Light'

/**
 * 导出（需求 10.2 / 10.3）。
 *
 * 状态很少，但值得单独成 store：导出是**耗时**操作（整库要读一遍所有文件再压缩），
 * 界面需要在此期间给出反馈，而触发点分散在设置面板、命令面板与右键菜单三处。
 */
export const useExportStore = defineStore('export', () => {
  const workspace = useWorkspaceStore()

  const exporting = ref(false)
  const error = ref<string | null>(null)
  /** 上一次导出的结果描述，供界面给出「已保存到…」这类反馈 */
  const lastResult = ref<string | null>(null)

  const ZIP_FILTERS = [{ name: 'ZIP 压缩包', extensions: ['zip'] }]

  /**
   * 导出整个工作区。
   * @returns 是否真的产出了文件（用户取消保存对话框时为 false）
   */
  async function exportWorkspace(): Promise<boolean> {
    return run(async () => {
      const entries = await collectArchiveEntries(requireStorage())
      const archive = await createArchive(entries)
      const name = archiveFileName(EXPORT_NAME, new Date())

      const result = await saveFile(name, archive, { filters: ZIP_FILTERS })
      if (result.cancelled) return null

      return `已导出 ${entries.length} 个文件（含库配置）${result.path ? ` 到 ${result.path}` : ''}`
    })
  }

  /**
   * 导出选定的笔记或目录。
   *
   * 单篇也走 ZIP 而不是直接给 `.md`：路径结构、同名文件、将来的附件都需要容器，
   * 为「只有一篇」再开一条分支只会让两条路各自演化。
   */
  async function exportPaths(paths: readonly string[]): Promise<boolean> {
    if (paths.length === 0) return false

    return run(async () => {
      const entries = await collectArchiveEntries(requireStorage(), { include: paths })
      if (entries.length === 0) {
        throw new Error('选中的范围里没有可导出的文件')
      }

      const archive = await createArchive(entries)
      const base = paths.length === 1 ? stem(paths[0]!) : EXPORT_NAME
      const name = archiveFileName(base, new Date())

      const result = await saveFile(name, archive, { filters: ZIP_FILTERS })
      if (result.cancelled) return null

      return `已导出 ${entries.length} 个文件${result.path ? ` 到 ${result.path}` : ''}`
    })
  }

  /**
   * 导出为静态 HTML 站点。
   *
   * 渲染管线（unified + katex）动态 import：它有几百 KB，
   * 而绝大多数会话不会用到导出。
   */
  async function exportSite(): Promise<boolean> {
    return run(async () => {
      const { buildSite } = await import('@/core/export/site')
      const { entries, pageCount } = await buildSite(requireStorage(), EXPORT_NAME)

      const archive = await createArchive(entries)
      const name = archiveFileName(`${EXPORT_NAME}-站点`, new Date())

      const result = await saveFile(name, archive, { filters: ZIP_FILTERS })
      if (result.cancelled) return null

      return `已生成 ${pageCount} 个页面的站点，解压后打开 index.html 即可${result.path ? ` · ${result.path}` : ''}`
    })
  }

  /** 统一处理进行中标记与错误，避免每个导出各写一遍 try/finally */
  async function run(task: () => Promise<string | null>): Promise<boolean> {
    if (exporting.value) return false

    exporting.value = true
    error.value = null
    lastResult.value = null
    try {
      const message = await task()
      lastResult.value = message
      return message !== null
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      exporting.value = false
    }
  }

  function requireStorage() {
    if (!workspace.storage) throw new Error('数据目录尚未就绪')
    return workspace.storage
  }

  return { exporting, error, lastResult, exportWorkspace, exportPaths, exportSite }
})
