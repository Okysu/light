import { describe, expect, it } from 'vitest'
import { parseJson, parseSseData } from './sse'

/** 把若干段文本做成一个 ReadableStream，每段是网络给到的一个 chunk */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

/** 按字节切分，用来构造「多字节字符被拆开」的情形 */
function byteStreamOf(text: string, at: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, at))
      controller.enqueue(bytes.slice(at))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = []
  for await (const payload of parseSseData(stream)) out.push(payload)
  return out
}

describe('parseSseData', () => {
  it('取出 data 载荷，忽略其它字段', async () => {
    const result = await collect(
      streamOf(['event: message\ndata: {"a":1}\n\nid: 7\ndata: {"a":2}\n\n']),
    )

    expect(result).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('一条消息被拆在两个 chunk 里也能完整还原', async () => {
    // 断点刻意落在 JSON 中间——不留缓冲区的话这里会丢字
    const result = await collect(streamOf(['data: {"text":"前', '半后半"}\n\n']))

    expect(result).toEqual(['{"text":"前半后半"}'])
  })

  it('一个 chunk 里挤了多条消息', async () => {
    const result = await collect(streamOf(['data: 1\n\ndata: 2\n\ndata: 3\n\n']))

    expect(result).toEqual(['1', '2', '3'])
  })

  it('汉字被拆在两个 chunk 的字节边界上不会解成乱码', async () => {
    // 「好」是 3 字节，切在第 2 个字节处
    const text = 'data: 你好\n\n'
    const cut = new TextEncoder().encode('data: 你').length + 2

    expect(await collect(byteStreamOf(text, cut))).toEqual(['你好'])
  })

  it('遇到 [DONE] 立即结束，其后的内容不再产出', async () => {
    const result = await collect(streamOf(['data: 1\n\ndata: [DONE]\n\ndata: 2\n\n']))

    expect(result).toEqual(['1'])
  })

  it('末尾没有空行的最后一条也不会被吞掉', async () => {
    expect(await collect(streamOf(['data: 只此一条']))).toEqual(['只此一条'])
  })

  it('多行 data 按换行拼接', async () => {
    expect(await collect(streamOf(['data: 第一行\ndata: 第二行\n\n']))).toEqual(['第一行\n第二行'])
  })

  it('心跳注释行不产生载荷', async () => {
    expect(await collect(streamOf([': ping\n\ndata: 内容\n\n']))).toEqual(['内容'])
  })

  it('调用方提前 break 时不会卡住', async () => {
    const stream = streamOf(['data: 1\n\ndata: 2\n\ndata: 3\n\n'])
    const out: string[] = []

    for await (const payload of parseSseData(stream)) {
      out.push(payload)
      break
    }

    expect(out).toEqual(['1'])
  })
})

describe('parseJson', () => {
  it('解析正常 JSON', () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
  })

  it('坏掉的一条返回 null，而不是让整个流断掉', () => {
    expect(parseJson('{不是 JSON')).toBeNull()
  })
})
