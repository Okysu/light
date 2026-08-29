/**
 * 附件命名与路径规则。
 *
 * 属于模块 7 的底层——附件面板（7.1）与孤立附件检测（7.2）都要先有可靠的
 * 命名与路径规则才谈得上。
 *
 * 纯函数单独成层：文件名冲突、扩展名推断、相对路径判定这些规则一旦出错，
 * 后果是覆盖用户已有的附件或产生打不开的链接——都属于事后很难察觉的那类。
 */

/** MIME → 扩展名。覆盖编辑器允许导入的图片、音频与视频。 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
}

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'oga', 'flac', 'aac'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v'])

export type EmbeddableKind = 'image' | 'audio' | 'video'

export function extensionForMime(mime: string): string {
  return EXTENSION_BY_MIME[mime.toLowerCase()] ?? 'bin'
}

export function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/')
}

/**
 * 浏览器拖放文件时 MIME 偶尔为空（Windows 上尤其常见），因此同时检查扩展名。
 * 这里只认编辑器能直接渲染的三类文件，其它附件仍可由附件面板管理。
 */
export function embeddableKind(mime: string, name = ''): EmbeddableKind | null {
  const normalized = mime.toLowerCase()
  if (normalized.startsWith('image/')) return 'image'
  if (normalized.startsWith('audio/')) return 'audio'
  if (normalized.startsWith('video/')) return 'video'

  const extension = extensionOf(name)
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return null
}

/**
 * 生成不与既有文件冲突的附件名。
 *
 * 用「日期-序号」而不是随机串或哈希：粘贴的图片没有语义化的名字，
 * 而日期至少让用户在文件管理器里能按时间找回来。哈希则完全不可读。
 *
 * @param taken 已被占用的文件名（不含目录）
 * @param at 由调用方传入，纯函数才好测
 */
export function attachmentFileName(
  mime: string,
  at: Date,
  taken: ReadonlySet<string>,
  originalName?: string,
): string {
  const extension = originalName ? extensionOf(originalName) || extensionForMime(mime) : extensionForMime(mime)
  const stamp = [
    at.getFullYear(),
    pad(at.getMonth() + 1),
    pad(at.getDate()),
    pad(at.getHours()),
    pad(at.getMinutes()),
    pad(at.getSeconds()),
  ].join('')

  // 有原名就保留它（拖入的文件通常有意义的名字），只在冲突时才加后缀
  const base = originalName ? sanitize(stripExtension(originalName)) : `粘贴-${stamp}`

  let candidate = `${base}.${extension}`
  let index = 2
  while (taken.has(candidate)) {
    candidate = `${base}-${index}.${extension}`
    index += 1
  }

  return candidate
}

/**
 * 附件链接是否指向工作区内部。
 *
 * 外部链接（http、data、file 等）一律原样保留：那是用户自己写进去的，
 * 我们没有理由去改写它，也无从把它解析成工作区里的文件。
 */
export function isInternalAttachment(src: string): boolean {
  if (!src) return false
  // 绝对 URL 与协议相对 URL 都算外部
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return false
  // 站内绝对路径（以 / 开头）在工作区里没有意义
  return !src.startsWith('/')
}

/**
 * 把相对于某篇笔记的链接解析成工作区路径。
 *
 * 笔记在子目录里时，`![](attachments/x.png)` 指的是**相对该笔记**的位置，
 * 与 Markdown 的一贯语义一致；写死成从根目录找会让子目录里的笔记全部断链。
 */
export function resolveAttachmentPath(src: string, notePath: string): string {
  const decoded = safeDecode(src)
  if (decoded.startsWith('/')) return decoded.slice(1)

  const dir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
  const segments = dir ? dir.split('/') : []

  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }

  return segments.join('/')
}

/** 从笔记出发写进 Markdown 的相对链接 */
export function attachmentHref(attachmentPath: string, notePath: string): string {
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
  if (!noteDir) return encodePath(attachmentPath)

  const fromParts = noteDir.split('/')
  const toParts = attachmentPath.split('/')

  let common = 0
  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) {
    common += 1
  }

  const up = Array.from({ length: fromParts.length - common }, () => '..')
  return encodePath([...up, ...toParts.slice(common)].join('/'))
}

/** 空格等字符在 Markdown 链接里会截断，必须编码 */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    // 半个百分号编码之类的坏串，原样用，总好过抛错
    return value
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function extensionOf(name: string): string {
  const at = name.lastIndexOf('.')
  return at === -1 ? '' : name.slice(at + 1).toLowerCase()
}

function stripExtension(name: string): string {
  const at = name.lastIndexOf('.')
  return at === -1 ? name : name.slice(0, at)
}

/** 与笔记命名同一套清洗规则：路径分隔符与 Windows 非法字符 */
function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '附件'
}
