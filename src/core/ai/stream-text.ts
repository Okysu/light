/**
 * 将不同 OpenAI 兼容服务的流式文本统一成真正的增量。
 *
 * 标准接口会依次返回 `你`、`好`；部分兼容接口却返回 `你`、`你好`、
 * `你好呀`。后者若直接追加，会得到 `你你好你好呀`。一旦观察到新片段是
 * 当前完整结果的严格扩展，就切到累计模式，之后只交付新增后缀。
 */
export function createStreamTextNormalizer(): (chunk: string) => string {
  let output = ''
  let cumulative = false

  return (chunk: string): string => {
    if (!chunk) return ''

    if (cumulative) {
      if (chunk === output || output.startsWith(chunk)) return ''
      if (chunk.startsWith(output)) {
        const delta = chunk.slice(output.length)
        output = chunk
        return delta
      }

      // 服务端中途恢复为标准增量时继续接受，不能因此吞掉正文。
      output += chunk
      return chunk
    }

    if (output && chunk.length > output.length && chunk.startsWith(output)) {
      cumulative = true
      const delta = chunk.slice(output.length)
      output = chunk
      return delta
    }

    output += chunk
    return chunk
  }
}
