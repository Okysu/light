// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryAdapter } from '@/core/storage/memory-adapter'
import { toBase64 } from '@/core/ai/image-context'
import { useAiStore } from './ai'
import { useI18nStore } from './i18n'

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function response(): Response {
  return new Response('data: {"choices":[{"delta":{"content":"图片里的内容"}}]}\n\ndata: [DONE]\n\n')
}

function cumulativeResponse(): Response {
  return new Response([
    'data: {"choices":[{"delta":{"content":"续"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"续写"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"续写完成"}}]}\n\n',
    'data: [DONE]\n\n',
  ].join(''))
}

async function setup() {
  const ai = useAiStore()
  ai.save({ ...ai.settings, enabled: true, provider: { kind: 'custom', baseUrl: 'https://model.example/v1', model: 'vision-test' } })
  const storage = new MemoryAdapter()
  await storage.writeBinary('attachments/a.png', PNG)
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(response()))
  vi.stubGlobal('fetch', fetch)
  return { ai, storage, fetch, context: { storage, notePath: 'notes/n.md' } }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

describe('AI 选区图片到真实请求载荷', () => {
  it('兼容返回累计快照的接口，续写不会重复追加', async () => {
    const { ai, fetch } = await setup()
    fetch.mockResolvedValueOnce(cumulativeResponse())
    const onText = vi.fn()

    expect(await ai.runInstruction('继续写', '开头', onText)).toBe('续写完成')
    expect(onText.mock.calls.flat()).toEqual(['续', '写', '完成'])
    expect(ai.output).toBe('续写完成')
  })

  it.each(['instruction', 'scenario', 'document'])('%s 入口发送实际图片，并保留 Markdown 和流式输出', async (kind) => {
    const { ai, fetch, context } = await setup()
    const onText = vi.fn()
    const markdown = '说明 ![图片](../attachments/a.png)'
    const result = kind === 'instruction'
      ? await ai.runInstruction('解释图片', markdown, onText, context)
      : await ai.run(kind === 'document' ? 'doc-summary' : 'summarize', markdown, undefined, onText, context)
    const body = JSON.parse(fetch.mock.calls[0]![1].body)
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: expect.stringContaining(markdown) },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${toBase64(PNG)}` } },
    ])
    expect(result).toBe('图片里的内容')
    expect(onText).toHaveBeenCalledWith('图片里的内容')
    expect(ai.busy).toBe(false)
    expect(ai.error).toBeNull()
  })

  it('未授予图片读取上下文的扩展调用仍然只发送文本', async () => {
    const { ai, fetch, storage } = await setup()
    const read = vi.spyOn(storage, 'readBinary')
    await ai.runInstruction('解释', '![图片](../attachments/a.png)')
    expect(typeof JSON.parse(fetch.mock.calls[0]![1].body).messages[1].content).toBe('string')
    expect(read).not.toHaveBeenCalled()
  })

  it('读图失败显示本地化错误并禁止模型请求，旧输出也被清空', async () => {
    const { ai, fetch, context } = await setup()
    useI18nStore().locale = 'en-US'
    ai.output = '上次的回答'
    const onText = vi.fn()
    await expect(ai.runInstruction('解释', '![](../attachments/missing.png)', onText, context)).rejects.toThrow('No AI request was sent')
    expect(ai.error).toContain('could not be read')
    expect(ai.hint).toContain('image input')
    expect(ai.output).toBe('')
    expect(ai.busy).toBe(false)
    expect(onText).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('禁用 AI 时不读取附件也不请求网络', async () => {
    const { ai, fetch, storage, context } = await setup()
    ai.settings.enabled = false
    const read = vi.spyOn(storage, 'readBinary')
    await expect(ai.runInstruction('解释', '![](../attachments/a.png)', undefined, context)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('读取图片期间立即进入 busy；停止后不能继续发送模型请求', async () => {
    const { ai, fetch, storage, context } = await setup()
    let finish!: (bytes: Uint8Array) => void
    vi.spyOn(storage, 'readBinary').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const run = ai.runInstruction('解释', '![](../attachments/a.png)', undefined, context)
    expect(ai.busy).toBe(true)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    ai.stop()
    finish(PNG)
    expect(await run).toBe('')
    expect(ai.busy).toBe(false)
    expect(ai.error).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('旧读图请求收尾不能清除新请求的运行状态或输出', async () => {
    const { ai, fetch, storage, context } = await setup()
    let finishRead!: (bytes: Uint8Array) => void
    vi.spyOn(storage, 'readBinary').mockImplementation(() => new Promise((resolve) => { finishRead = resolve }))
    const first = ai.runInstruction('旧请求', '![](../attachments/a.png)', undefined, context)
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'))
    let finishFetch!: (response: Response) => void
    fetch.mockImplementation(() => new Promise<Response>((resolve) => { finishFetch = resolve }))
    const second = ai.runInstruction('新请求', '文字')
    await vi.waitFor(() => expect(finishFetch).toBeTypeOf('function'))
    finishRead(PNG)
    expect(await first).toBe('')
    expect(ai.busy).toBe(true)
    expect(ai.running?.label).toBe('新请求')
    finishFetch(response())
    expect(await second).toBe('图片里的内容')
    expect(ai.busy).toBe(false)
  })

  it('原有 OCR 图片调用仍发送多模态消息', async () => {
    const { ai, fetch } = await setup()
    await ai.describeImage(PNG, 'image/png', 'ocr')
    expect(JSON.parse(fetch.mock.calls[0]![1].body).messages[0].content[1]).toEqual({
      type: 'image_url', image_url: { url: `data:image/png;base64,${toBase64(PNG)}` },
    })
  })
})
