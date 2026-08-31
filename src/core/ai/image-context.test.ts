import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { imageSources, MAX_IMAGE_CONTEXT_BYTES, resolveImageContext, toBase64, withImages } from './image-context'

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const JPEG = new Uint8Array([255, 216, 255, 224])
const signal = () => new AbortController().signal

afterEach(() => vi.unstubAllGlobals())

describe('AI 图片引用解析', () => {
  it('区分图片、普通链接、转义字符以及行内/块级代码', () => {
    expect(imageSources([
      '![图](attachments/a.png) ![重复](attachments/a.png)',
      '[普通链接](attachments/b.png) `![代码](attachments/c.png)`',
      '\\![转义](attachments/d.png)',
      '```md\n![示例](attachments/e.png)\n```',
    ].join('\n\n'))).toEqual(['attachments/a.png'])
  })

  it('支持引用式图片、列表、表格和带括号/空格的图片路径', () => {
    expect(imageSources([
      '![引用][PHOTO]', '[photo]: <../attachments/a (1).png>',
      '- ![列表](../attachments/b.png)',
      '| 图 |\n| --- |\n| ![表格](../attachments/c.png) |',
    ].join('\n\n'))).toEqual(['../attachments/a (1).png', '../attachments/b.png', '../attachments/c.png'])
  })

  it('从笔记所在目录读取实际字节并去重，不读取未选中的图片', async () => {
    const storage = new MemoryAdapter()
    await storage.writeBinary('attachments/图 (1).png', PNG)
    await storage.writeBinary('attachments/b.jpg', JPEG)
    const read = vi.spyOn(storage, 'readBinary')
    const images = await resolveImageContext(
      '![图](../attachments/%E5%9B%BE%20(1).png) ![同图](../attachments/./%E5%9B%BE%20(1).png) ![B](../attachments/b.jpg)',
      { storage, notePath: 'notes/a.md' }, signal(),
    )
    expect(read.mock.calls).toEqual([['attachments/图 (1).png'], ['attachments/b.jpg']])
    expect(images).toEqual([
      { mime: 'image/png', base64: toBase64(PNG) },
      { mime: 'image/jpeg', base64: toBase64(JPEG) },
    ])
  })

  it('纯文本不读取文件或网络，即使没有工作区', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await resolveImageContext('一段文字', { storage: null, notePath: '' }, signal())).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['../secret.png', 'file:///secret.png', 'C:/secret.png', '%2Fsecret.png', 'javascript:alert(1)', '//example.com/a.png'])('拒绝非法或越出库根的地址：%s', async (src) => {
    const storage = new MemoryAdapter()
    const read = vi.spyOn(storage, 'readBinary')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(resolveImageContext(`![](${src})`, { storage, notePath: 'note.md' }, signal())).rejects.toMatchObject({ reason: 'read' })
    expect(read).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('图片缺失时失败，不静默退化为只发 Markdown', async () => {
    await expect(resolveImageContext('![](missing.png)', { storage: new MemoryAdapter(), notePath: 'n.md' }, signal()))
      .rejects.toMatchObject({ reason: 'read' })
  })

  it('外链读取不携带凭据，实际类型从字节判断，不相信扩展名/响应头', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(PNG, { headers: { 'content-type': 'text/plain' } }))
    vi.stubGlobal('fetch', fetch)
    const abort = signal()
    expect(await resolveImageContext('![](https://example.com/photo)', { storage: null, notePath: '' }, abort))
      .toEqual([{ mime: 'image/png', base64: toBase64(PNG) }])
    expect(fetch).toHaveBeenCalledWith('https://example.com/photo', { signal: abort, credentials: 'omit', referrerPolicy: 'no-referrer' })
  })

  it('data URI 会读取为图片，而不是文本地址', async () => {
    const images = await resolveImageContext(`![](data:image/png;base64,${toBase64(PNG)})`, { storage: null, notePath: '' }, signal())
    expect(images).toEqual([{ mime: 'image/png', base64: toBase64(PNG) }])
  })

  it.each([new Response('login page'), new Response('missing', { status: 404 })])('外链返回非图片或 HTTP 错误时拒绝继续', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(resolveImageContext('![](https://example.com/a.png)', { storage: null, notePath: '' }, signal())).rejects.toThrow()
  })

  it('读取大文件之前检查大小', async () => {
    const storage = new MemoryAdapter()
    await storage.writeBinary('a.png', PNG)
    vi.spyOn(storage, 'stat').mockResolvedValue({ path: 'a.png', size: MAX_IMAGE_CONTEXT_BYTES + 1, isDirectory: false, createdAt: null, modifiedAt: null })
    const read = vi.spyOn(storage, 'readBinary')
    await expect(resolveImageContext('![](a.png)', { storage, notePath: 'n.md' }, signal())).rejects.toMatchObject({ reason: 'size' })
    expect(read).not.toHaveBeenCalled()
  })

  it('检查多图累计大小，外链也不能绕过内存限制', async () => {
    const chunk = new Uint8Array(MAX_IMAGE_CONTEXT_BYTES / 2 + 1)
    chunk.set(PNG)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(chunk))))
    await expect(resolveImageContext('![](https://example.com/a) ![](https://example.com/b)', { storage: null, notePath: '' }, signal()))
      .rejects.toMatchObject({ reason: 'size' })
  })

  it('不把不支持的格式或错误文本伪装成 PNG', async () => {
    const storage = new MemoryAdapter()
    await storage.writeBinary('a.png', new TextEncoder().encode('<svg></svg>'))
    await expect(resolveImageContext('![](a.png)', { storage, notePath: 'n.md' }, signal())).rejects.toMatchObject({ reason: 'format' })
  })

  it('已取消的请求不读取图片', async () => {
    const controller = new AbortController()
    controller.abort()
    const storage = new MemoryAdapter()
    const read = vi.spyOn(storage, 'readBinary')
    await expect(resolveImageContext('![](a.png)', { storage, notePath: '' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).not.toHaveBeenCalled()
  })

  it('图片附到 user 消息，不修改原有 system/文本对象', () => {
    const messages = [{ role: 'system' as const, content: '规则' }, { role: 'user' as const, content: '![图](a.png)' }]
    const images = [{ mime: 'image/png', base64: toBase64(PNG) }]
    expect(withImages(messages, images)).toEqual([messages[0], { ...messages[1], images }])
    expect(messages[1]).not.toHaveProperty('images')
    expect(withImages(messages, [])).toBe(messages)
  })
})
