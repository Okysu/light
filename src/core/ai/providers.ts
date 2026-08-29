import { parseJson, parseSseData } from './sse'
import {
  AiError,
  PROVIDER_DEFAULTS,
  type AiProvider,
  type ChatMessage,
  type StreamRequest,
} from './types'

/**
 * 服务商适配（6.1）。
 *
 * 两套协议就够覆盖需求里列的三种目标：
 * - **OpenAI 协议**：OpenAI 自己，以及 Ollama / vLLM / LM Studio / 各种代理。
 *   它已经是事实标准，为「自定义端点」再发明一套配置只会让用户多填几个框。
 * - **Anthropic 协议**：消息结构与事件名都不同，硬套 OpenAI 那套会在
 *   system 消息和流式事件上出错，因此单独实现。
 *
 * 两者都只做「发请求 + 把增量文本吐出来」，不做重试、不做队列。
 * AI 调用是用户主动触发的前台操作，失败了他会自己再点一次；
 * 后台悄悄重试反而会在计费上给人惊喜。
 */

/**
 * OpenAI 的多模态消息：图片走 `image_url`，data URI 直接可用。
 * 纯文本消息保持字符串形式——有些兼容端点只认字符串，不认数组。
 */
function toOpenAiMessage(message: ChatMessage): unknown {
  if (!message.image) return { role: message.role, content: message.content }

  return {
    role: message.role,
    content: [
      { type: 'text', text: message.content },
      {
        type: 'image_url',
        image_url: { url: `data:${message.image.mime};base64,${message.image.base64}` },
      },
    ],
  }
}

/** Anthropic 的多模态消息：图片是独立的 block，且要拆出 media_type */
function toAnthropicMessage(message: ChatMessage): unknown {
  if (!message.image) return { role: message.role, content: message.content }

  return {
    role: message.role,
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: message.image.mime, data: message.image.base64 },
      },
      { type: 'text', text: message.content },
    ],
  }
}

function baseUrlOf(request: StreamRequest): string {
  const configured = request.config.baseUrl.trim()
  return (configured || PROVIDER_DEFAULTS[request.config.kind].baseUrl).replace(/\/+$/, '')
}

/** 把 HTTP 错误翻译成能指导排查的中文提示 */
async function toAiError(response: Response): Promise<AiError> {
  const body = await response.text().catch(() => '')
  const detail = body.slice(0, 300)

  if (response.status === 401 || response.status === 403) {
    return new AiError(`认证失败（${response.status}）`, 'API Key 不正确或已失效，请在设置里重新填写')
  }
  if (response.status === 404) {
    return new AiError(`接口不存在（404）`, '检查端点地址与模型名称——本地模型常见的是模型名拼错或还没 pull')
  }
  if (response.status === 429) {
    return new AiError('请求过于频繁或额度已用完（429）', '稍后再试，或到服务商后台查看余额与速率限制')
  }
  return new AiError(`请求失败（${response.status}）${detail ? `：${detail}` : ''}`)
}

/**
 * 网络层失败的翻译。
 *
 * 浏览器出于安全考虑不会告诉脚本「是 CORS 被拒还是域名解析不了」，
 * 一律是干巴巴的 `Failed to fetch`。对 BYOK 场景来说这两种原因的
 * 处理方式完全不同，因此这里把两条最可能的路都写出来。
 */
function toNetworkError(cause: unknown, url: string): AiError {
  if (cause instanceof DOMException && cause.name === 'AbortError') throw cause

  return new AiError(
    `无法连接 ${url}`,
    '可能是网络不通，也可能是对方没有放行浏览器直连（CORS）。' +
      '本地模型如 Ollama 需要设置 OLLAMA_ORIGINS 允许本应用的来源。',
    { cause },
  )
}

/** OpenAI 兼容协议 */
export const openAiProvider: AiProvider = {
  async *stream(request) {
    const url = `${baseUrlOf(request)}/chat/completions`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${request.apiKey}`,
        },
        body: JSON.stringify({
          model: request.config.model || PROVIDER_DEFAULTS[request.config.kind].model,
          messages: request.messages.map(toOpenAiMessage),
          stream: true,
          ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
          // 放在最后：用户配置的额外参数覆盖上面的默认值，这正是它的用途
          ...request.extraBody,
        }),
        signal: request.signal,
      })
    } catch (cause) {
      throw toNetworkError(cause, url)
    }

    if (!response.ok) throw await toAiError(response)
    if (!response.body) throw new AiError('服务端没有返回内容流')

    for await (const payload of parseSseData(response.body)) {
      const chunk = parseJson<{
        choices?: Array<{
          delta?: { content?: string; reasoning_content?: string; reasoning?: string }
        }>
      }>(payload)
      const delta = chunk?.choices?.[0]?.delta
      if (!delta) continue

      // 思考字段没有标准。DeepSeek / 各家兼容端点用 reasoning_content，
      // 也有用 reasoning 的；两个都认，谁先有值用谁
      const reasoning = delta.reasoning_content ?? delta.reasoning
      if (reasoning) yield { kind: 'reasoning', text: reasoning }
      if (delta.content) yield { kind: 'text', text: delta.content }
    }
  },
}

/** Anthropic Messages 协议 */
export const anthropicProvider: AiProvider = {
  async *stream(request) {
    const url = `${baseUrlOf(request)}/messages`

    // Anthropic 把 system 提示放在独立字段，而不是 messages 里的一条
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    const messages = request.messages.filter((message) => message.role !== 'system')

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': request.apiKey,
          'anthropic-version': '2023-06-01',
          // 没有这个头，浏览器直连会被服务端拒绝。BYOK 的前提就是不经过我们的服务器，
          // 因此必须显式声明「我知道这是从浏览器发出的」
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: request.config.model || PROVIDER_DEFAULTS.anthropic.model,
          // Anthropic 协议要求这个字段，没配就给一个够用的值
          max_tokens: request.maxTokens ?? 8192,
          ...(system ? { system } : {}),
          messages: messages.map(toAnthropicMessage),
          stream: true,
          ...request.extraBody,
        }),
        signal: request.signal,
      })
    } catch (cause) {
      throw toNetworkError(cause, url)
    }

    if (!response.ok) throw await toAiError(response)
    if (!response.body) throw new AiError('服务端没有返回内容流')

    for await (const payload of parseSseData(response.body)) {
      const event = parseJson<{
        type?: string
        delta?: { type?: string; text?: string; thinking?: string }
        error?: { message?: string }
      }>(payload)

      // 流中途的错误事件必须抛出去，否则用户看到的是「输出到一半停了」
      if (event?.type === 'error') {
        throw new AiError(event.error?.message ?? '服务端在生成过程中返回了错误')
      }
      if (event?.type !== 'content_block_delta' || !event.delta) continue

      if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
        yield { kind: 'reasoning', text: event.delta.thinking }
      } else if (event.delta.text) {
        yield { kind: 'text', text: event.delta.text }
      }
    }
  },
}

export function providerFor(kind: StreamRequest['config']['kind']): AiProvider {
  return kind === 'anthropic' ? anthropicProvider : openAiProvider
}
