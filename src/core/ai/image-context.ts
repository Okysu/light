import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { StorageAdapter } from '../storage/types'
import type { ChatImage, ChatMessage } from './types'

/** 由调用入口显式授权读取图片。扩展的纯文本 AI 调用不会因此获得附件读取权限。 */
export interface ImageContext {
  storage: Pick<StorageAdapter, 'readBinary' | 'stat'> | null
  notePath: string
}

export class ImageContextError extends Error {
  constructor(readonly reason: 'read' | 'format' | 'size') {
    super(`AI image context: ${reason}`)
    this.name = 'ImageContextError'
  }
}

const parser = unified().use(remarkParse).use(remarkGfm)
/** 本地内存保护：一条请求的图片原始字节总量，不是服务商限制。 */
export const MAX_IMAGE_CONTEXT_BYTES = 20 * 1024 * 1024

/** 用语法树区分图片、普通链接和代码示例；包含表格及引用式图片。 */
export function imageSources(markdown: string): string[] {
  const tree = parser.parse(markdown)
  const definitions = new Map<string, string>()
  visit(tree, 'definition', (node) => {
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url)
  })
  const sources = new Set<string>()
  visit(tree, (node) => {
    const src = node.type === 'image' ? node.url
      : node.type === 'imageReference' ? definitions.get(node.identifier) : undefined
    if (src !== undefined) sources.add(src)
  })
  return [...sources]
}

/** 相对的是发起操作时的笔记；不允许越过库根或借协议读取任意本机文件。 */
function localPath(src: string, notePath: string): string {
  let decoded: string
  try { decoded = decodeURIComponent(src) } catch { throw new ImageContextError('read') }
  decoded = decoded.replaceAll('\\', '/')
  if (!decoded || decoded.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(decoded)) {
    throw new ImageContextError('read')
  }
  const parts = notePath.split('/').slice(0, -1)
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new ImageContextError('read')
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}

/** 不信扩展名或 HTTP Content-Type：避免把登录页/错误页当作图片发给模型。 */
function imageMime(bytes: Uint8Array): string {
  const starts = (...prefix: number[]) => prefix.every((value, index) => bytes[index] === value)
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png'
  if (starts(255, 216, 255)) return 'image/jpeg'
  if (starts(71, 73, 70, 56) && [55, 57].includes(bytes[4] ?? 0) && bytes[5] === 97) return 'image/gif'
  if (starts(82, 73, 70, 70) && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  throw new ImageContextError('format')
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

async function readUrl(src: string, signal: AbortSignal, remaining: number): Promise<Uint8Array> {
  const response = await fetch(src, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!response.ok || !response.body) throw new ImageContextError('read')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    if (Number(response.headers.get('content-length')) > remaining) throw new ImageContextError('size')
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > remaining) throw new ImageContextError('size')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength }
  return bytes
}

export async function resolveImageContext(
  markdown: string,
  context: ImageContext,
  signal: AbortSignal,
): Promise<ChatImage[]> {
  const images: ChatImage[] = []
  const seen = new Set<string>()
  let size = 0
  try {
    for (const src of imageSources(markdown)) {
      signal.throwIfAborted()
      const remote = /^(https?:\/\/|data:image\/|blob:)/i.test(src)
      const path = remote ? src : localPath(src, context.notePath)
      if (seen.has(path)) continue
      seen.add(path)
      // data URI 本身已包含全部字节，先限制长度，避免 fetch 解码巨大的字符串。
      if (/^data:/i.test(src) && src.length > MAX_IMAGE_CONTEXT_BYTES * 4 / 3 + 256) {
        throw new ImageContextError('size')
      }
      if (!remote && !context.storage) throw new ImageContextError('read')
      if (!remote) {
        const stat = await context.storage!.stat(path)
        signal.throwIfAborted()
        if (stat.size > MAX_IMAGE_CONTEXT_BYTES - size) throw new ImageContextError('size')
      }
      const bytes = remote
        ? await readUrl(src, signal, MAX_IMAGE_CONTEXT_BYTES - size)
        : await context.storage!.readBinary(path)
      signal.throwIfAborted()
      size += bytes.byteLength
      if (size > MAX_IMAGE_CONTEXT_BYTES) throw new ImageContextError('size')
      images.push({ mime: imageMime(bytes), base64: toBase64(bytes) })
    }
    return images
  } catch (cause) {
    signal.throwIfAborted()
    if (cause instanceof ImageContextError) throw cause
    throw new ImageContextError('read')
  }
}

export function withImages(messages: ChatMessage[], images: ChatImage[]): ChatMessage[] {
  if (!images.length) return messages
  const index = messages.findLastIndex((message) => message.role === 'user')
  return messages.map((message, at) => at === index ? { ...message, images } : message)
}
