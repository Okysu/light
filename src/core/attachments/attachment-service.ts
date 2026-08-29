import type { StorageAdapter } from '../storage'
import { attachmentFileName, attachmentHref, resolveAttachmentPath } from './attachment'
import { ATTACHMENTS_DIR } from '../workspace/types'

/**
 * 附件的读写（模块 7 的底层：附件的存储与显示；管理面板与孤立检测尚未实现）。
 *
 * 附件与笔记一样落在工作区目录下，不进数据库、不做单独的元数据表——
 * 「文件即真源」这条线对二进制同样适用：用户在文件管理器里看到的
 * `attachments/` 目录就是全部内容，删掉一张图片不需要再去别处清理记录。
 */
export class AttachmentService {
  constructor(
    private readonly storage: StorageAdapter,
    /** Light 在数据目录中自动创建的固定位置。 */
    readonly directory: string = ATTACHMENTS_DIR,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * 保存一份二进制附件。
   * @returns 写进 Markdown 的相对链接
   */
  async save(
    data: Uint8Array,
    mime: string,
    notePath: string,
    originalName?: string,
  ): Promise<{ path: string; href: string }> {
    await this.storage.mkdir(this.directory)

    const taken = new Set(await this.listNames())
    const name = attachmentFileName(mime, this.now(), taken, originalName)
    const path = `${this.directory}/${name}`

    await this.storage.writeBinary(path, data)

    return { path, href: attachmentHref(path, notePath) }
  }

  /** 读出附件字节；文件不存在时返回 null 而不是抛错 */
  async read(src: string, notePath: string): Promise<{ data: Uint8Array; mime: string } | null> {
    const path = resolveAttachmentPath(src, notePath)

    try {
      return { data: await this.storage.readBinary(path), mime: mimeOf(path) }
    } catch {
      // 断链是常态（用户可能手工删了文件），不该让整篇笔记渲染失败
      return null
    }
  }

  private async listNames(): Promise<string[]> {
    try {
      const entries = await this.storage.list(this.directory)
      return entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name)
    } catch {
      // 目录还不存在
      return []
    }
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
}

/** 从扩展名反推 MIME，供 Blob 使用；认不出来就交给浏览器自己嗅探 */
function mimeOf(path: string): string {
  const at = path.lastIndexOf('.')
  const extension = at === -1 ? '' : path.slice(at + 1).toLowerCase()

  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}
