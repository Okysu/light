import { serializerCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

/**
 * 所有正文变更都必须保存，包括不进入撤销历史的附件本地化与 AI 流式更新。
 * Milkdown 的默认 listener 会跳过 addToHistory=false；撤销策略不能决定是否落盘。
 */
export function markdownListener(onUpdated: (markdown: string) => void) {
  return $prose((ctx) => new Plugin({
    key: new PluginKey('LIGHT_MARKDOWN_LISTENER'),
    view: (view) => {
      const serialize = ctx.get(serializerCtx)
      let previous = serialize(view.state.doc)
      let timer: ReturnType<typeof setTimeout> | undefined
      return {
        update: (current, oldState) => {
          if (current.state.doc.eq(oldState.doc)) return
          clearTimeout(timer)
          timer = setTimeout(() => {
            // 读取当前文档，不能让较早的粘贴快照覆盖随后完成的本地化。
            const markdown = serialize(current.state.doc)
            if (markdown === previous) return
            previous = markdown
            onUpdated(markdown)
          }, 200)
        },
        destroy: () => clearTimeout(timer),
      }
    },
  }))
}
