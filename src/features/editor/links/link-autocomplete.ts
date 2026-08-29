import type { Ctx } from '@milkdown/kit/ctx'
import type { EditorView } from '@milkdown/kit/prose/view'
import { fuzzyScore } from '@/core/fuzzy'
import { stem } from '@/core/path'
import {
  createAutocomplete,
  textBeforeCursor,
  type AutocompleteController,
  type AutocompleteTrigger,
} from '../autocomplete/controller'
import { wikilinkSchema } from '../extensions/wikilink'

/**
 * 输入 `[[` 后补全笔记名。
 *
 * 没有它双向链接基本不可用——用户得凭记忆敲出笔记标题，敲错就成了指向
 * 不存在笔记的「幽灵链接」。
 *
 * 候选来源由外部注入而不是直接 import store：这一层属于编辑器，
 * 让它去读 Pinia 会把编辑器和应用状态绑死，测试时也没法只给几条假数据。
 */

export interface LinkCandidate {
  /** 笔记的完整路径 */
  path: string
  /** 写进 `[[ ]]` 的目标，重名时带路径 */
  target: string
  /** 显示用的标题 */
  title: string
}

export type LinkAutocompleteController = AutocompleteController<LinkCandidate>

export interface LinkAutocompleteSource {
  /** 当前工作区的全部笔记路径 */
  paths: () => string[]
  /** 为某个路径生成链接目标（重名时带上路径） */
  targetFor: (path: string) => string
}

/**
 * `[[` 之后、`]]` 之前的部分即查询词。
 *
 * 允许查询词里出现空格与斜杠（笔记名常有），但遇到 `]` 就停——
 * 那说明这对括号已经闭合，不该再弹菜单。
 */
function detect(view: EditorView): AutocompleteTrigger | null {
  const text = textBeforeCursor(view)
  if (text === null) return null

  const match = /\[\[([^[\]]*)$/.exec(text)
  if (!match) return null

  const query = match[1] ?? ''
  // 加 2 是两个左方括号
  return { query, length: query.length + 2 }
}

const MAX_CANDIDATES = 12

export function createLinkAutocomplete(source: LinkAutocompleteSource): LinkAutocompleteController {
  return createAutocomplete<LinkCandidate>({
    key: 'LIGHT_LINK_AUTOCOMPLETE',
    className: 'light-link-autocomplete-root',
    detect,

    items: (query) => {
      const candidates = source.paths().map((path) => ({
        path,
        target: source.targetFor(path),
        title: stem(path),
      }))

      const keyword = query.trim()
      // 刚敲下 `[[` 还没输入时给出全部（截断），让用户直接挑
      const matched = keyword
        ? candidates.filter(
            (item) => fuzzyScore(item.title, keyword) !== null || fuzzyScore(item.path, keyword) !== null,
          )
        : candidates

      return matched.slice(0, MAX_CANDIDATES)
    },

    apply: (ctx: Ctx, view: EditorView, item: LinkCandidate) => {
      const type = wikilinkSchema.type(ctx)
      const node = type.create({ url: item.target, hash: '', value: item.target })

      view.dispatch(view.state.tr.replaceSelectionWith(node, false))
    },
  })
}
