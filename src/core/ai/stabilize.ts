/**
 * 补全流式输出里未闭合的 Markdown 标记。
 *
 * 边收边渲染时，最后几个字符常常处在「写了一半」的状态：`**加粗` 还没配对、
 * 围栏代码块只开了头。直接丢给渲染器，`**` 会原样显示成星号，
 * 读起来像是模型输出坏了；下一段到达时又突然变成粗体，页面跟着跳一下。
 *
 * 这里**只补不删**：补错了最多是某几个字暂时带上格式，下一帧就修正；
 * 而删掉未闭合的标记会让用户看到内容忽有忽无。
 */

/** 行内标记。顺序要紧：先长后短，否则 `**` 会被 `*` 的规则先拆掉 */
const INLINE_MARKERS = ['```', '**', '~~', '`', '*', '_'] as const

export function stabilize(markdown: string): string {
  let text = markdown

  // 围栏代码块单独先处理：它内部的 * 与 ` 不该参与配对计数
  const fences = (text.match(/^ {0,3}```/gm) ?? []).length
  if (fences % 2 === 1) text += '\n```'

  for (const marker of INLINE_MARKERS) {
    // ``` 已经在上面处理过，这里跳过，免得重复补
    if (marker === '```') continue
    if (countOccurrences(text, marker) % 2 === 1) text += marker
  }

  return text
}

/**
 * 数不重叠的出现次数。
 *
 * 用 `split().length - 1` 而不是正则：标记里含 `*` 这类元字符，
 * 拼正则要转义，而转义漏一个就成了完全不同的匹配规则。
 */
function countOccurrences(text: string, marker: string): number {
  return text.split(marker).length - 1
}
