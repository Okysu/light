import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { codeBlockConfig } from '@milkdown/kit/component/code-block'
import type { Ctx } from '@milkdown/kit/ctx'

/**
 * 代码块（需求 S6）。
 *
 * 直接使用 Milkdown 官方的 `codeBlockComponent`——它基于 CodeMirror，自带
 * 带搜索的语言选择器、复制按钮与预览开关，正是需求图示的形态；
 * 自己重写一套既无必要，也会重蹈「自建层需自行维护」的覆辙。
 *
 * 这里只做两件事：把外观接到我们的主题变量上，以及把预览钩子接到 Mermaid。
 */

/**
 * 语法高亮配色。
 *
 * CodeMirror 6 不会自动着色——必须显式提供 `syntaxHighlighting` 扩展，
 * 只配主题（背景/字体）是不够的，这是漏掉高亮的常见原因。
 *
 * 颜色全部走 CSS 变量而非写死色值：明暗主题各一套定义在 main.css，
 * 用户也能在自定义 CSS 里整体换配色，无需逐条覆盖选择器。
 */
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword], color: 'var(--light-code-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--light-code-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--light-code-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--light-code-number)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--light-code-function)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'var(--light-code-variable)' },
  { tag: [tags.typeName, tags.className, tags.tagName, tags.namespace], color: 'var(--light-code-type)' },
  { tag: [tags.operator, tags.logicOperator, tags.arithmeticOperator], color: 'var(--light-code-operator)' },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: 'var(--light-code-punctuation)' },
  { tag: [tags.definition(tags.variableName)], color: 'var(--light-code-variable)' },
  { tag: tags.invalid, color: 'var(--light-code-invalid)' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, textDecoration: 'underline' },
])

/** 让 CodeMirror 跟随应用主题：颜色一律取 CSS 变量，明暗切换与自定义 CSS 自动生效 */
const themeExtension: Extension = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
    fontSize: '0.9em',
  },
  '.cm-content': {
    fontFamily: 'var(--light-font-mono)',
    padding: '0.5em 0',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--muted-foreground)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--accent) 40%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
  },
  '&.cm-focused': { outline: 'none' },
})

/**
 * Mermaid 预览。
 *
 * 走代码块的预览钩子而不是做成独立节点：这样文件里保持标准的 ```mermaid 代码块，
 * GitHub、Obsidian、Typora 都能原样渲染，不产生只有 Light 认得的私有语法。
 *
 * mermaid 体积很大（数百 KB），因此**动态引入**——没有图表的笔记完全不会加载它，
 * 这对「轻量」的产品定位是必要的。
 */
async function renderMermaid(content: string, apply: (value: null | string | HTMLElement) => void): Promise<void> {
  if (!content.trim()) {
    apply(null)
    return
  }

  try {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
      fontFamily: 'var(--light-font-sans)',
    })

    // id 必须唯一，否则同一篇里的多张图会互相覆盖
    const id = `mermaid-${Math.floor(performance.now() * 1000)}`
    const { svg } = await mermaid.render(id, content)

    const container = document.createElement('div')
    container.className = 'light-mermaid'
    container.innerHTML = svg
    apply(container)
  } catch (error) {
    // 图表语法写错很常见，显示错误信息即可，不要影响整篇笔记
    const message = document.createElement('div')
    message.className = 'light-mermaid-error'
    message.textContent = `图表渲染失败：${error instanceof Error ? error.message : String(error)}`
    apply(message)
  }
}

/** 用 SVG 字符串提供图标，与侧边栏的 lucide 图标保持同一视觉语言 */
const ICONS = {
  search:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  clear:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  expand:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>',
  copy: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
}

/**
 * 复制反馈。
 *
 * 组件的 `onCopy` 回调不带触发它的元素，因此拿不到按钮引用去改状态；
 * 这里用一次性的文档级事件委托，给被点的按钮打上 `data-copied`，
 * 由 CSS 负责把文案从「复制」换成「已复制」并变色，1.6 秒后自动复原。
 *
 * 注册在模块级且幂等：编辑器会随笔记切换反复创建销毁，
 * 每次都挂一个监听会累积泄漏。
 */
let copyFeedbackInstalled = false

function installCopyFeedback(): void {
  if (copyFeedbackInstalled || typeof document === 'undefined') return
  copyFeedbackInstalled = true

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const button = target.closest('.milkdown-code-block .copy-button')
      if (!(button instanceof HTMLElement)) return

      button.dataset['copied'] = 'true'
      setTimeout(() => {
        delete button.dataset['copied']
      }, 1600)
    },
    true,
  )
}

export function configureCodeBlock(ctx: Ctx): void {
  installCopyFeedback()

  ctx.update(codeBlockConfig.key, (prev) => ({
    ...prev,
    // language-data 内含全部语言且按需懒加载语法包，不会一次性打进主包
    languages,
    extensions: [
      themeExtension,
      // 没有这一行就没有任何着色——CodeMirror 不会因为加载了语言包就自动高亮
      syntaxHighlighting(highlightStyle),
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    ],

    searchIcon: ICONS.search,
    clearSearchIcon: ICONS.clear,
    expandIcon: ICONS.expand,
    copyIcon: ICONS.copy,
    searchPlaceholder: '搜索语言…',
    noResultText: '没有匹配的语言',
    // 置空：按钮文案完全交给 CSS 的 ::after 输出，便于按 data-copied 切换。
    // 若在此填文案，组件会渲染成裸文本节点，和 ::after 叠成两份。
    copyText: '',
    previewLabel: '预览',
    previewLoading: '渲染中…',
    // 默认实现返回英文 "Hide"/"Show"，且是裸文本；这里给成中文
    previewToggleButton: (previewOnlyMode) => (previewOnlyMode ? '看代码' : '看图表'),

    renderPreview: (language, content, applyPreview) => {
      if (language.toLowerCase() !== 'mermaid') return null
      void renderMermaid(content, applyPreview)
      // 返回 undefined 表示异步渲染，结果通过 applyPreview 回传
      return undefined
    },
  }))
}
