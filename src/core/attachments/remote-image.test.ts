import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadRemoteImage, MAX_REMOTE_IMAGE_BYTES } from './remote-image'

afterEach(() => vi.unstubAllGlobals())

describe('网络图片下载', () => {
  it('只发送无凭据、无来源页的请求，并保留可读文件名', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/png' },
    }))
    vi.stubGlobal('fetch', fetch)
    const result = await downloadRemoteImage('https://cdn.example/%E6%88%91%E7%9A%84%E5%9B%BE.png?token=x')
    expect(fetch).toHaveBeenCalledWith('https://cdn.example/%E6%88%91%E7%9A%84%E5%9B%BE.png?token=x', {
      signal: undefined,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    expect(result).toEqual({ data: new Uint8Array([1, 2, 3]), mime: 'image/png', name: '我的图.png' })
  })

  it.each(['file:///tmp/a.png', 'data:image/png;base64,eA==', 'javascript:alert(1)', '/a.png'])('拒绝非 HTTP(S) 地址：%s', async (source) => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(downloadRemoteImage(source)).rejects.toMatchObject({ reason: 'url' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('拒绝服务端错误和伪装成图片路径的 HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })))
    await expect(downloadRemoteImage('https://example.com/a.png')).rejects.toMatchObject({ reason: 'http' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } })))
    await expect(downloadRemoteImage('https://example.com/a.png')).rejects.toMatchObject({ reason: 'type' })
  })

  it('动态图片地址按实际 MIME 命名，不保留 php 等错误扩展名', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
      headers: { 'content-type': 'image/webp; charset=binary' },
    })))
    expect((await downloadRemoteImage('https://example.com/picture.php?id=1')).name).toBe('picture.webp')
  })

  it('根据响应头在读取前拒绝超大图片', async () => {
    const body = new ReadableStream<Uint8Array>()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      headers: { 'content-type': 'image/png', 'content-length': String(MAX_REMOTE_IMAGE_BYTES + 1) },
    })))
    await expect(downloadRemoteImage('https://example.com/a.png')).rejects.toMatchObject({ reason: 'size' })
  })

  it('流式读取时也限制累计大小，并支持取消', async () => {
    const tooLarge = new Uint8Array(MAX_REMOTE_IMAGE_BYTES + 1)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(tooLarge, { headers: { 'content-type': 'image/png' } })))
    await expect(downloadRemoteImage('https://example.com/a.png')).rejects.toMatchObject({ reason: 'size' })

    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))
    await expect(downloadRemoteImage('https://example.com/a.png', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
