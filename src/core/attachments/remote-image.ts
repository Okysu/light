import { extensionForMime } from './attachment'

export const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024

export class RemoteImageError extends Error {
  constructor(readonly reason: 'url' | 'http' | 'type' | 'size' | 'read') {
    super(`remote image: ${reason}`)
    this.name = 'RemoteImageError'
  }
}

export interface DownloadedRemoteImage {
  data: Uint8Array
  mime: string
  name?: string
}

/**
 * 下载用户粘贴的 HTTP(S) 图片。凭据与来源页地址都不发送，且在分配完整缓冲区前限流。
 */
export async function downloadRemoteImage(
  source: string,
  signal?: AbortSignal,
): Promise<DownloadedRemoteImage> {
  let url: URL
  try {
    url = new URL(source)
  } catch {
    throw new RemoteImageError('url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new RemoteImageError('url')

  let response: Response
  try {
    response = await fetch(url.href, {
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new RemoteImageError('read')
  }
  if (!response.ok || !response.body) throw new RemoteImageError('http')

  const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const extension = extensionForMime(mime)
  if (!mime.startsWith('image/') || extension === 'bin') {
    await response.body.cancel().catch(() => {})
    throw new RemoteImageError('type')
  }
  const name = fileName(url, extension)

  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_REMOTE_IMAGE_BYTES) {
    await response.body.cancel().catch(() => {})
    throw new RemoteImageError('size')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_REMOTE_IMAGE_BYTES) throw new RemoteImageError('size')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }

  const data = new Uint8Array(size)
  if (size === 0) throw new RemoteImageError('read')
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { data, mime, ...(name ? { name } : {}) }
}

function fileName(url: URL, extension: string): string | undefined {
  const encoded = url.pathname.split('/').filter(Boolean).at(-1)
  if (!encoded) return undefined
  try {
    const decoded = decodeURIComponent(encoded)
    const stem = decoded.replace(/\.[^.]*$/, '')
    return `${stem || 'image'}.${extension}`
  } catch {
    return `image.${extension}`
  }
}
