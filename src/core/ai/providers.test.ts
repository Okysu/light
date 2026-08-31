import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { anthropicProvider, openAiProvider, providerFor } from './providers'
import { AiError, type ProviderConfig, type StreamChunk, type StreamRequest } from './types'

function sse(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
}

function request(config: Partial<ProviderConfig> = {}): StreamRequest {
  return {
    config: { kind: 'openai', baseUrl: '', model: '', ...config },
    apiKey: 'sk-test',
    messages: [
      { role: 'system', content: '规则' },
      { role: 'user', content: '你好' },
    ],
    signal: new AbortController().signal,
  }
}

/** 只收正文，思考单独用 collectAll 取 */
async function collect(iterable: AsyncIterable<StreamChunk>): Promise<string> {
  let out = ''
  for await (const chunk of iterable) if (chunk.kind === 'text') out += chunk.text
  return out
}

async function collectAll(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

/** 最近一次 fetch 的参数，用来断言请求本身长什么样 */
let lastCall: { url: string; init: RequestInit }

function mockFetch(response: Response): void {
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    lastCall = { url, init }
    return Promise.resolve(response)
  })
}

function body(): Record<string, unknown> {
  return JSON.parse(String(lastCall.init.body))
}

function headers(): Record<string, string> {
  return lastCall.init.headers as Record<string, string>
}

beforeEach(() => {
  lastCall = { url: '', init: {} }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openAiProvider', () => {
  it('把增量拼成完整回复', async () => {
    mockFetch(
      new Response(
        sse([
          'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    )

    expect(await collect(openAiProvider.stream(request()))).toBe('你好')
  })

  it('没填端点时用官方默认地址', async () => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    await collect(openAiProvider.stream(request()))

    expect(lastCall.url).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('自定义端点末尾多余的斜杠会被去掉，不会拼出双斜杠', async () => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    await collect(openAiProvider.stream(request({ kind: 'custom', baseUrl: 'http://localhost:11434/v1/' })))

    expect(lastCall.url).toBe('http://localhost:11434/v1/chat/completions')
  })

  it('带 Bearer 认证并要求流式', async () => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    await collect(openAiProvider.stream(request()))

    expect(headers()['authorization']).toBe('Bearer sk-test')
    expect(body()['stream']).toBe(true)
  })

  it('system 消息留在 messages 里', async () => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    await collect(openAiProvider.stream(request()))

    expect(body()['messages']).toHaveLength(2)
  })

  it('401 给出「Key 不对」而不是原样的英文报错', async () => {
    mockFetch(new Response('unauthorized', { status: 401 }))

    await expect(collect(openAiProvider.stream(request()))).rejects.toMatchObject({
      name: 'AiError',
      hint: expect.stringContaining('API Key'),
    })
  })

  it('429 提示额度与速率', async () => {
    mockFetch(new Response('rate limited', { status: 429 }))

    await expect(collect(openAiProvider.stream(request()))).rejects.toMatchObject({
      hint: expect.stringContaining('余额'),
    })
  })

  it('连不上时提示 CORS 这条最常见的原因', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))

    await expect(collect(openAiProvider.stream(request()))).rejects.toMatchObject({
      hint: expect.stringContaining('CORS'),
    })
  })

  it('中断信号原样抛出 AbortError，不被包装成 AiError', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('aborted', 'AbortError')))

    // 包装成 AiError 的话，上层就分不清「用户主动停了」和「真的出错了」，
    // 于是每次点停止都会弹一个错误提示
    await expect(collect(openAiProvider.stream(request()))).rejects.toThrow(DOMException)
  })
})

describe('anthropicProvider', () => {
  it('拼接 content_block_delta 的文本', async () => {
    mockFetch(
      new Response(
        sse([
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ]),
      ),
    )

    expect(await collect(anthropicProvider.stream(request({ kind: 'anthropic' })))).toBe('你好')
  })

  it('system 提示提到独立字段，不留在 messages 里', async () => {
    mockFetch(new Response(sse(['data: {"type":"message_stop"}\n\n'])))
    await collect(anthropicProvider.stream(request({ kind: 'anthropic' })))

    expect(body()['system']).toBe('规则')
    expect(body()['messages']).toEqual([{ role: 'user', content: '你好' }])
  })

  it('带上浏览器直连所需的请求头——少了它服务端会拒绝', async () => {
    mockFetch(new Response(sse(['data: {"type":"message_stop"}\n\n'])))
    await collect(anthropicProvider.stream(request({ kind: 'anthropic' })))

    expect(headers()['x-api-key']).toBe('sk-test')
    expect(headers()['anthropic-dangerous-direct-browser-access']).toBe('true')
  })

  it('流中途的 error 事件会抛出，而不是静静停在半句话上', async () => {
    mockFetch(
      new Response(
        sse([
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"开头"}}\n\n',
          'data: {"type":"error","error":{"message":"overloaded"}}\n\n',
        ]),
      ),
    )

    await expect(collect(anthropicProvider.stream(request({ kind: 'anthropic' })))).rejects.toThrow(
      AiError,
    )
  })
})

describe('providerFor', () => {
  it('anthropic 走自己的协议，其余都走 OpenAI 协议', () => {
    expect(providerFor('anthropic')).toBe(anthropicProvider)
    expect(providerFor('openai')).toBe(openAiProvider)
    expect(providerFor('custom')).toBe(openAiProvider)
  })
})

describe('图片消息（6.3 的 OCR / 图片描述）', () => {
  const IMAGE = { mime: 'image/png', base64: 'aGVsbG8=' }

  function imageRequest(kind: 'openai' | 'anthropic'): StreamRequest {
    return {
      ...request({ kind }),
      messages: [{ role: 'user', content: '提取文字', images: [IMAGE] }],
    }
  }

  it('OpenAI 用 image_url 与 data URI', async () => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    await collect(openAiProvider.stream(imageRequest('openai')))

    const content = (body()['messages'] as Array<{ content: unknown[] }>)[0]!.content
    expect(content).toEqual([
      { type: 'text', text: '提取文字' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
    ])
  })

  it('Anthropic 用独立的 image block 并拆出 media_type', async () => {
    mockFetch(new Response(sse(['data: {"type":"message_stop"}\n\n'])))
    await collect(anthropicProvider.stream(imageRequest('anthropic')))

    const content = (body()['messages'] as Array<{ content: unknown[] }>)[0]!.content
    expect(content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
      { type: 'text', text: '提取文字' },
    ])
  })

  it('没有图片的消息保持字符串 content——有些兼容端点不认数组', async () => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    await collect(openAiProvider.stream(request()))

    expect(body()['messages']).toEqual([
      { role: 'system', content: '规则' },
      { role: 'user', content: '你好' },
    ])
  })

  it.each(['openai', 'anthropic', 'custom'] as const)('%s 保留多张图片的顺序，不丢失第二张图', async (kind) => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    const images = [IMAGE, { mime: 'image/jpeg', base64: 'c2Vjb25k' }]
    await collect(providerFor(kind).stream({ ...request({ kind }), messages: [{ role: 'user', content: '对比两张图', images }] }))
    const content = (body()['messages'] as Array<{ content: unknown[] }>)[0]!.content
    expect(content).toEqual(kind === 'anthropic' ? [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: IMAGE.base64 } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'c2Vjb25k' } },
      { type: 'text', text: '对比两张图' },
    ] : [
      { type: 'text', text: '对比两张图' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${IMAGE.base64}` } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,c2Vjb25k' } },
    ])
  })
})

describe('思考流（reasoning）', () => {
  it('OpenAI 协议的 reasoning_content 单独成一类，不混进正文', async () => {
    mockFetch(
      new Response(
        sse([
          'data: {"choices":[{"delta":{"reasoning_content":"先想想"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    )

    expect(await collectAll(openAiProvider.stream(request()))).toEqual([
      { kind: 'reasoning', text: '先想想' },
      { kind: 'text', text: '答案' },
    ])
  })

  it('也认 reasoning 这个字段名——各家兼容端点没有统一', async () => {
    mockFetch(
      new Response(sse(['data: {"choices":[{"delta":{"reasoning":"想"}}]}\n\n', 'data: [DONE]\n\n'])),
    )

    expect(await collectAll(openAiProvider.stream(request()))).toEqual([
      { kind: 'reasoning', text: '想' },
    ])
  })

  it('Anthropic 的 thinking_delta 归为思考', async () => {
    mockFetch(
      new Response(
        sse([
          'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"推理"}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"结论"}}\n\n',
        ]),
      ),
    )

    expect(await collectAll(anthropicProvider.stream(request({ kind: 'anthropic' })))).toEqual([
      { kind: 'reasoning', text: '推理' },
      { kind: 'text', text: '结论' },
    ])
  })
})

describe('maxTokens', () => {
  it('没配置时 OpenAI 请求体里不出现 max_tokens——写死一个数等于给所有模型加天花板', async () => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    await collect(openAiProvider.stream(request()))

    expect(body()).not.toHaveProperty('max_tokens')
  })

  it('配置了就带上', async () => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    await collect(openAiProvider.stream({ ...request(), maxTokens: 2048 }))

    expect(body()['max_tokens']).toBe(2048)
  })

  it('Anthropic 必须有这个字段，没配也给一个够用的默认值', async () => {
    mockFetch(new Response(sse(['data: {"type":"message_stop"}\n\n'])))
    await collect(anthropicProvider.stream(request({ kind: 'anthropic' })))

    expect(body()['max_tokens']).toBe(8192)
  })
})

describe('extraBody（自定义请求体参数）', () => {
  it('合并进 OpenAI 请求体', async () => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    await collect(
      openAiProvider.stream({ ...request(), extraBody: { reasoning_effort: 'high' } }),
    )

    expect(body()['reasoning_effort']).toBe('high')
    expect(body()['stream']).toBe(true)
  })

  it('合并进 Anthropic 请求体，嵌套对象原样带上', async () => {
    mockFetch(new Response(sse(['data: {"type":"message_stop"}\n\n'])))
    await collect(
      anthropicProvider.stream({
        ...request({ kind: 'anthropic' }),
        extraBody: { thinking: { type: 'enabled', budget_tokens: 4000 } },
      }),
    )

    expect(body()['thinking']).toEqual({ type: 'enabled', budget_tokens: 4000 })
  })

  it('用户的字段覆盖我们的默认值——这正是它存在的意义', async () => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    await collect(
      openAiProvider.stream({ ...request(), maxTokens: 100, extraBody: { max_tokens: 9999 } }),
    )

    expect(body()['max_tokens']).toBe(9999)
  })

  it('没配置时请求体与原来完全一致', async () => {
    mockFetch(new Response(sse(['data: [DONE]\n\n'])))
    await collect(openAiProvider.stream(request()))

    expect(Object.keys(body()).sort()).toEqual(['messages', 'model', 'stream'])
  })
})
