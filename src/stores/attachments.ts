import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { AttachmentService } from '@/core/attachments/attachment-service'
import { ATTACHMENTS_DIR } from '@/core/workspace/types'
import { downloadRemoteImage } from '@/core/attachments/remote-image'
import { useWorkspaceStore } from './workspace'

/**
 * 附件读写（模块 7 的底层：附件的存储与显示；管理面板与孤立检测尚未实现）。
 *
 * 解析出来的 blob URL 按**工作区路径**缓存：同一张图片可能被多篇笔记引用，
 * 也可能在同一篇里出现多次，每次都重新读文件再造一个 URL 既慢又漏内存。
 */
export const useAttachmentsStore = defineStore('attachments', () => {
  const workspace = useWorkspaceStore()

  const service = shallowRef<AttachmentService | null>(null)
  /** 工作区路径 → blob URL */
  const urls = new Map<string, string>()

  function ensureService(): AttachmentService | null {
    if (!workspace.storage) return null

    if (!service.value) service.value = new AttachmentService(workspace.storage, ATTACHMENTS_DIR)
    return service.value
  }

  /** 保存一份附件，返回写进 Markdown 的相对链接 */
  async function save(
    data: Uint8Array,
    mime: string,
    notePath: string,
    name?: string,
  ): Promise<string> {
    const instance = ensureService()
    if (!instance) throw new Error('尚未打开工作区')

    const { path, href } = await instance.save(data, mime, notePath, name)
    // 刚存进去的文件马上就要显示，顺手把 URL 备好
    urls.delete(path)
    return href
  }

  /** 下载网络图片并保存，返回替换原外链所需的相对 href。 */
  async function importRemoteImage(src: string, notePath: string, signal?: AbortSignal): Promise<string> {
    const instance = ensureService()
    if (!instance) throw new Error('尚未打开工作区')
    const downloaded = await downloadRemoteImage(src, signal)
    signal?.throwIfAborted()
    const { href } = await instance.save(downloaded.data, downloaded.mime, notePath, downloaded.name)
    return href
  }

  /**
   * 把相对链接解析成可显示的 URL。
   *
   * **这个 store 是 blob URL 唯一的生命周期主人。** 别处（比如编辑器的图片
   * NodeView）想放手时应当调 `release`，绝不能自己 `revokeObjectURL`——
   * 缓存还留着那个字符串，下次解析会把一个已经失效的 URL 再发出去，
   * 表现就是「切一次标签页图片全裂了，刷新又好了」。
   */
  async function resolve(src: string, notePath: string): Promise<string | null> {
    const instance = ensureService()
    if (!instance) return null

    // 先查缓存再读盘：命中时省掉一次完整的文件读取
    const key = `${notePath}::${src}`
    const cached = urls.get(key)
    if (cached) return cached

    const result = await instance.read(src, notePath)
    if (!result) return null

    const url = URL.createObjectURL(
      new Blob([result.data.slice().buffer as ArrayBuffer], { type: result.mime }),
    )
    urls.set(key, url)
    return url
  }

  /**
   * 交还一个不再需要的 URL。
   *
   * 必须连同缓存一起清掉，否则就退化成了 bug 本身。
   * 传进来的 URL 不在缓存里时什么也不做——那说明它已经被别处释放过了，
   * 此时去 revoke 只会误伤同名条目。
   */
  function release(url: string): void {
    for (const [key, value] of urls) {
      if (value !== url) continue
      urls.delete(key)
      URL.revokeObjectURL(url)
      return
    }
  }

  /**
   * 释放全部 blob URL。
   * 切换工作区时必须调用：那些 URL 指向的是上一个 Vault 的内容。
   */
  function invalidate(): void {
    for (const url of urls.values()) URL.revokeObjectURL(url)
    urls.clear()
    service.value = null
  }

  return { save, importRemoteImage, resolve, release, invalidate }
})
