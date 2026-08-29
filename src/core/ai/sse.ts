/**
 * Server-Sent Events 解析。
 *
 * 自己解析而不是用 `EventSource`：那个 API 只支持 GET，也无法带自定义请求头，
 * 而所有服务商的流式接口都是带 `Authorization` 的 POST。
 *
 * 关键点是**跨 chunk 的粘包与拆包**。网络给到的每一块与 SSE 的消息边界毫无关系：
 * 一块可能含半条消息，也可能含三条半。不留缓冲区直接按行切，会在
 * 「正好断在 JSON 中间」时静默丢字——而那只在长回复、慢网络下偶发，
 * 事后几乎无从复现。
 */

/**
 * 把字节流切成一条条 `data:` 载荷。
 *
 * 只取 `data:` 字段：`event:` / `id:` / 注释行对这几家服务商都不承载内容。
 * 遇到 `[DONE]` 就结束——OpenAI 用它显式收尾。
 */
export async function* parseSseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      // stream: true 让解码器自己保留不完整的多字节序列——
      // 一个汉字被拆在两个 chunk 里时，少了它就会解出「�」
      buffer += decoder.decode(value, { stream: true })

      // SSE 以空行分隔事件。用 \n\n 切，最后一段留在缓冲区里等下一块
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const event of events) {
        const payload = dataOf(event)
        if (payload === null) continue
        if (payload === '[DONE]') return
        yield payload
      }
    }

    // 收尾：末尾没有空行的最后一条事件
    const payload = dataOf(buffer)
    if (payload !== null && payload !== '[DONE]') yield payload
  } finally {
    // 提前 break 出去时（用户中断）必须放掉读锁，否则连接不会被回收
    reader.releaseLock()
  }
}

/**
 * 取出一个事件块里的 data 载荷。
 *
 * 多行 `data:` 按 SSE 规范用换行拼接——Anthropic 的部分事件会这么发。
 */
function dataOf(event: string): string | null {
  const lines = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())

  return lines.length > 0 ? lines.join('\n') : null
}

/** SSE 载荷是 JSON，但坏掉的一条不该让整个流断掉 */
export function parseJson<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T
  } catch {
    return null
  }
}
