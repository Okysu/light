import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { $Command } from '@milkdown/kit/utils'
import {
  createCodeBlockCommand,
  insertHrCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand } from '@milkdown/kit/preset/gfm'
import { Image as ImageIcon, Music, Video, Columns3, Palette, Puzzle } from 'lucide-vue-next'
import { insertMathBlockCommand } from '../extensions/math'
import { insertDocumentEmbedCommand } from '../extensions/document-embed'
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Sigma,
  Sparkles,
  Table,
  Text,
  Workflow,
  type LucideIcon,
} from 'lucide-vue-next'

import { useEditorStore } from '@/stores/editor'
import { useExtensionsStore } from '@/stores/extensions'
import type { ExtensionSlashItem } from '@/core/extensions/types'

export interface SlashItem {
  id: string
  label: string
  /** 分组标题，用于菜单分节 */
  group: string
  icon: LucideIcon
  /** 附加匹配词：英文名与拼音首字母，让中英文输入都能命中 */
  keywords: string[]
  run: (ctx: Ctx) => void
}

/**
 * 转发给 Milkdown 命令。
 *
 * 必须传**命令对象**而不是 `cmd.key`：`$command` 的实现是
 * `plugin.key = cmdKey` 写在插件被 use 后执行的回调里，
 * 因此模块加载阶段 `cmd.key` 还是 `undefined`。
 * 若在这里提前解构 key，下面的数组字面量求值时就会把 undefined 固化进闭包，
 * 点击时报 `Cannot read properties of undefined (reading 'id')`。
 * 传对象则把读取推迟到运行时，那时插件已就绪。
 */
function command<T>(cmd: $Command<T>, payload?: T) {
  return (ctx: Ctx) => {
    ctx.get(commandsCtx).call(cmd.key, payload)
  }
}

/**
 * 待办事项没有现成命令：gfm 用 list_item 的 `checked` 属性表达任务项
 * （`null` 是普通列表项，`false`/`true` 是未勾选/已勾选）。
 * 因此先转成无序列表，再把光标所在的列表项标记为未勾选。
 */
function insertTaskItem(ctx: Ctx): void {
  ctx.get(commandsCtx).call(wrapInBulletListCommand.key)

  const view = ctx.get(editorViewCtx)
  const { state } = view
  const { $from } = state.selection

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name !== 'list_item') continue
    view.dispatch(
      state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked: false }),
    )
    return
  }
}

/** 系统选择器选中的文件复用编辑器粘贴管线，存储、命名与插入逻辑只有一份。 */
function pickAttachments(ctx: Ctx, accept: string): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.multiple = true

  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])]
    if (files.length === 0) return

    const view = ctx.get(editorViewCtx)
    const transfer = new DataTransfer()
    for (const file of files) transfer.items.add(file)
    view.dom.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    )
  })

  input.click()
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'text',
    label: '正文',
    group: '基础',
    icon: Text,
    keywords: ['text', 'paragraph', 'zhengwen', 'zw'],
    run: command(turnIntoTextCommand),
  },
  {
    id: 'h1',
    label: '一级标题',
    group: '基础',
    icon: Heading1,
    keywords: ['h1', 'heading1', 'title', 'biaoti', 'bt'],
    run: command(wrapInHeadingCommand, 1),
  },
  {
    id: 'h2',
    label: '二级标题',
    group: '基础',
    icon: Heading2,
    keywords: ['h2', 'heading2', 'biaoti', 'bt'],
    run: command(wrapInHeadingCommand, 2),
  },
  {
    id: 'h3',
    label: '三级标题',
    group: '基础',
    icon: Heading3,
    keywords: ['h3', 'heading3', 'biaoti', 'bt'],
    run: command(wrapInHeadingCommand, 3),
  },
  {
    id: 'bullet-list',
    label: '无序列表',
    group: '列表',
    icon: List,
    keywords: ['ul', 'bullet', 'list', 'liebiao', 'lb'],
    run: command(wrapInBulletListCommand),
  },
  {
    id: 'ordered-list',
    label: '有序列表',
    group: '列表',
    icon: ListOrdered,
    keywords: ['ol', 'ordered', 'number', 'liebiao', 'lb'],
    run: command(wrapInOrderedListCommand),
  },
  {
    id: 'task-list',
    label: '待办事项',
    group: '列表',
    icon: ListChecks,
    keywords: ['todo', 'task', 'check', 'daiban', 'db'],
    run: insertTaskItem,
  },
  {
    id: 'blockquote',
    label: '引用',
    group: '块',
    icon: Text,
    keywords: ['quote', 'blockquote', 'yinyong', 'yy'],
    run: command(wrapInBlockquoteCommand),
  },
  {
    id: 'code-block',
    label: '代码块',
    group: '块',
    icon: Code,
    keywords: ['code', 'pre', 'daima', 'dm'],
    run: command(createCodeBlockCommand),
  },
  {
    id: 'table',
    label: '表格',
    group: '块',
    icon: Table,
    keywords: ['table', 'grid', 'biaoge', 'bg'],
    run: command(insertTableCommand),
  },
  {
    id: 'hr',
    label: '分割线',
    group: '块',
    icon: Minus,
    keywords: ['hr', 'divider', 'line', 'fengexian', 'fgx'],
    run: command(insertHrCommand),
  },
  {
    id: 'math',
    label: '数学公式',
    group: '块',
    icon: Sigma,
    keywords: ['math', 'latex', 'formula', 'katex', 'gongshi', 'gs'],
    run: command(insertMathBlockCommand),
  },
  {
    id: 'mermaid',
    label: 'Mermaid 图表',
    group: '块',
    icon: Workflow,
    keywords: ['mermaid', 'diagram', 'flowchart', 'tubiao', 'tb', 'liuchengtu'],
    // 走标准的 ```mermaid 代码块，而不是私有节点：
    // 这样文件在 GitHub、Obsidian 里同样能渲染（预览由代码块的 renderPreview 提供）
    run: (ctx: Ctx) => {
      ctx.get(commandsCtx).call(createCodeBlockCommand.key, 'mermaid')
    },
  },
  {
    id: 'image',
    label: '图片',
    group: '媒体',
    icon: ImageIcon,
    keywords: ['image', 'img', 'picture', 'tupian', 'tp', 'photo'],
    /**
     * 弹系统文件选择框，选中的图片走与粘贴同一条路径存进附件目录。
     *
     * 用 `<input type=file>` 而不是自己做拖放区：系统对话框是用户已经熟悉的
     * 交互，也免得再实现一套文件类型过滤。
     */
    run: (ctx: Ctx) => pickAttachments(ctx, 'image/*'),
  },
  {
    id: 'audio',
    label: '音频',
    group: '媒体',
    icon: Music,
    keywords: ['audio', 'music', 'sound', 'yinpin', 'yp', 'yinyue'],
    run: (ctx: Ctx) => pickAttachments(ctx, 'audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac'),
  },
  {
    id: 'video',
    label: '视频',
    group: '媒体',
    icon: Video,
    keywords: ['video', 'movie', 'shipin', 'sp'],
    run: (ctx: Ctx) => pickAttachments(ctx, 'video/*,.mp4,.webm,.ogv,.mov,.m4v'),
  },
  {
    id: 'embed-board',
    label: '内嵌看板',
    group: '嵌入',
    icon: Columns3,
    keywords: ['embed', 'board', 'kanban', 'neiqian', 'nq', 'kanban'],
    run: command(insertDocumentEmbedCommand, { kind: 'board' }),
  },
  {
    id: 'embed-canvas',
    label: '内嵌画板',
    group: '嵌入',
    icon: Palette,
    keywords: ['embed', 'canvas', 'whiteboard', 'neiqian', 'nq', 'huaban', 'hb'],
    run: command(insertDocumentEmbedCommand, { kind: 'canvas' }),
  },
]

/**
 * AI 相关的斜杠命令（模块 6）。
 *
 * 与其它条目分开定义、按开关拼进列表：AI 关掉时它们必须从菜单里消失。
 * 留一个点了会说「请先启用 AI」的条目，等于给一个不存在的功能占位——
 * 用户每次输 `/` 都要跳过它。
 */
export const AI_SLASH_ITEMS: SlashItem[] = [
  {
    id: 'ai-write',
    label: 'AI 写作',
    group: 'AI',
    icon: Sparkles,
    keywords: ['ai', 'write', 'xiezuo', 'xz', 'shengcheng', 'sc'],
    // 真正的动作在 AiSelectionBar 里：它要在光标处画一个输入框，
    // 那是视图层的事，塞进这个纯数据模块只会把编辑器组件耦合进来
    run: () => useEditorStore().requestAiPrompt(),
  },
]

/**
 * 按标签与关键词过滤；空查询返回全部。
 *
 * @param includeAi AI 未启用时不列出 AI 条目
 */
export function filterSlashItems(
  query: string,
  includeAi = false,
  contributions: readonly ExtensionSlashItem[] = [],
): SlashItem[] {
  const extensionItems: SlashItem[] = contributions.map((item) => ({
    id: `extension:${item.id}`,
    label: item.title,
    group: item.group,
    icon: Puzzle,
    keywords: item.keywords,
    run: () => { void useExtensionsStore().invoke(item.extensionId, item.command) },
  }))
  const all = includeAi
    ? [...AI_SLASH_ITEMS, ...SLASH_ITEMS, ...extensionItems]
    : [...SLASH_ITEMS, ...extensionItems]
  const keyword = query.trim().toLowerCase()
  if (!keyword) return all

  return all.filter(
    (item) =>
      item.label.toLowerCase().includes(keyword) ||
      item.keywords.some((word) => word.includes(keyword)),
  )
}
