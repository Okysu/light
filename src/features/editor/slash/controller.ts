import type { EditorView } from '@milkdown/kit/prose/view'
import {
  createAutocomplete,
  textBeforeCursor,
  type AutocompleteController,
  type AutocompleteTrigger,
} from '../autocomplete/controller'
import { useAiStore } from '@/stores/ai'
import { useExtensionsStore } from '@/stores/extensions'
import { filterSlashItems, type SlashItem } from './items'

export type SlashController = AutocompleteController<SlashItem>

/**
 * 斜杠命令。
 *
 * 触发规则与候选来源写在这里，菜单的显隐、定位、键盘处理共用
 * `autocomplete/controller.ts`——那部分与「补全的是命令还是笔记」无关。
 */

/**
 * 只在「行首或空白之后的 `/`」触发，避免把 `http://` 这类正常文本误判为命令。
 */
function detect(view: EditorView): AutocompleteTrigger | null {
  const text = textBeforeCursor(view)
  if (text === null) return null

  const match = /(?:^|\s)\/([^\s/]*)$/.exec(text)
  if (!match) return null

  const query = match[1] ?? ''
  // 加 1 是斜杠本身
  return { query, length: query.length + 1 }
}

export function createSlashController(): SlashController {
  return createAutocomplete<SlashItem>({
    key: 'LIGHT_SLASH',
    className: 'light-slash-root',
    detect,
    // 每次都读一遍开关而不是缓存：用户在设置里开了 AI 之后，
    // 不该还要重开一次笔记才能在 / 菜单里看到它
    items: (query) => filterSlashItems(
      query,
      useAiStore().settings.enabled,
      useExtensionsStore().slashItems,
    ),
    apply: (ctx, _view, item) => item.run(ctx),
  })
}
