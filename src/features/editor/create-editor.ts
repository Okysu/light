import { codeBlockComponent } from '@milkdown/kit/component/code-block'
import { tableBlock } from '@milkdown/kit/component/table-block'
import { Editor, defaultValueCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { history } from '@milkdown/kit/plugin/history'
import { listener } from '@milkdown/kit/plugin/listener'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { attachment, type AttachmentBridge } from './extensions/attachment'
import { configureCodeBlock } from './extensions/code-block'
import { highlight } from './extensions/highlight'
import { documentEmbed } from './extensions/document-embed'
import { math } from './extensions/math'
import { media } from './extensions/media'
import { markdownListener } from './extensions/markdown-listener'
import { sanitizePastedHtml } from './extensions/paste-sanitizer'
import { rawFallback } from './extensions/raw-node'
import { wikilink } from './extensions/wikilink'
import type { LinkAutocompleteController } from './links/link-autocomplete'
import type { SlashController } from './slash/controller'

export interface CreateEditorOptions {
  root: HTMLElement
  defaultValue: string
  onMarkdownUpdated?: (markdown: string) => void
  editable?: () => boolean
  /** 斜杠命令控制器；不传则不启用该功能（测试中通常不需要） */
  slash?: SlashController
  /** `[[` 链接补全控制器；同上 */
  linkAutocomplete?: LinkAutocompleteController
  /** 附件读写桥；不传则图片只走外部链接（测试中通常不需要） */
  attachments?: AttachmentBridge
}

/**
 * 组装 Light 的编辑器。返回**尚未 create 的 builder**：
 * Vue 侧交给 useEditor 负责创建与销毁，测试侧自行 `.create()`。
 *
 * Vue 组件与往返测试共用此工厂——测试跑的必须是线上真正的插件组合，
 * 否则「测过了」只是幻觉。
 *
 * 插件顺序有语义：rawFallback 必须最后注册，它依赖 Milkdown「首个匹配者胜出」的
 * 查找顺序来充当兜底，详见 extensions/raw-node.ts。
 */
export function createLightEditor(options: CreateEditorOptions): Editor {
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.root)
      ctx.set(defaultValueCtx, options.defaultValue)

      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        editable: options.editable ?? (() => true),
        // spellcheck 不在这里设：它是可继承属性，由外层容器统一控制（见 MarkdownEditor.vue），
        // 这样用户改设置能立刻生效，而不必重建编辑器
        attributes: { class: 'light-prose' },
        // clipboard 插件会保留并串联这里已有的转换器。放在 editorViewOptionsCtx
        // 而非普通 ProseMirror plugin：顶层 view prop 优先级更高，后者会被静默遮住。
        transformPastedHTML: (html, view) =>
          sanitizePastedHtml(prev.transformPastedHTML?.(html, view) ?? html),
      }))

      configureCodeBlock(ctx)
      options.slash?.configure(ctx)
      options.linkAutocomplete?.configure(ctx)
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(cursor)
    .use(trailing)
    // 官方组件：代码块（CodeMirror + 语言选择器 + 预览）与表格（行列操作）
    .use(codeBlockComponent)
    .use(tableBlock)
    // 公式与双向链接：从兜底节点「毕业」为真实节点，必须在 rawFallback 之前注册
    .use(math)
    .use(wikilink)
    .use(highlight)
    .use(media)
    .use(documentEmbed)
    .use(rawFallback)

  // 附件在兜底之后：只替换图片与媒体的 NodeView，不引入新 schema
  if (options.attachments) editor.use(attachment(options.attachments))
  if (options.onMarkdownUpdated) editor.use(markdownListener(options.onMarkdownUpdated))

  // 斜杠命令与链接补全注册在兜底之后：它们只挂 ProseMirror 插件，
  // 不引入 schema，因此不影响「首个匹配者胜出」的顺序
  if (options.slash) editor.use(options.slash.plugin)
  if (options.linkAutocomplete) editor.use(options.linkAutocomplete.plugin)

  return editor
}
