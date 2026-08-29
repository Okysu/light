import { InputRule } from '@milkdown/kit/prose/inputrules'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { $command, $inputRule, $nodeSchema, $remark, $view } from '@milkdown/kit/utils'
import katex from 'katex'
import remarkMath from 'remark-math'

/**
 * LaTeX 数学公式（需求 2.4）。
 *
 * 不用 `@milkdown/plugin-math`——该包已废弃（npm 标记 deprecated，最后更新 2025-01）。
 * Milkdown 官方的 Crepe 编辑器同样是直接用 `remark-math` + `katex` 自建，这里跟随该做法。
 *
 * 解析与序列化交给 remark-math（产出 mdast 的 `inlineMath` / `math` 节点），
 * 我们只负责把它们映射成 ProseMirror 节点并用 KaTeX 渲染。
 * 因此文件里始终是标准的 `$…$` / `$$…$$`，Obsidian、Typora 等都能正常打开。
 *
 * 在此之前这两类节点由兜底节点（rawBlock/rawInline）承接——这正是第 2 轮
 * 「remark 认得、schema 未跟上」测试所模拟的过渡态，现在给它补上了 schema。
 */

export const MATH_INLINE = 'math_inline'
export const MATH_BLOCK = 'math_block'

/** 让 remark 能解析 `$…$`；同一实例同时供 parser 与 serializer 使用 */
export const remarkMathPlugin = $remark('remarkMath', () => remarkMath)

function render(target: HTMLElement, value: string, displayMode: boolean): void {
  try {
    katex.render(value, target, { displayMode, throwOnError: false, output: 'html' })
  } catch {
    // 公式写错不该让整篇笔记崩掉，退化为显示原始源码
    target.textContent = displayMode ? `$$${value}$$` : `$${value}$`
    target.classList.add('light-math-error')
  }
}

export const mathInlineSchema = $nodeSchema(MATH_INLINE, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: { value: { default: '' } },

  parseDOM: [
    {
      tag: 'span[data-math-inline]',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset['value'] ?? '' }),
    },
  ],

  toDOM: (node) => {
    const dom = document.createElement('span')
    dom.dataset['mathInline'] = ''
    dom.dataset['value'] = node.attrs['value'] as string
    dom.className = 'light-math-inline'
    render(dom, node.attrs['value'] as string, false)
    return dom
  },

  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => {
      state.addNode(type, { value: node['value'] as string })
    },
  },

  toMarkdown: {
    match: (node) => node.type.name === MATH_INLINE,
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, node.attrs['value'] as string)
    },
  },
}))

export const mathBlockSchema = $nodeSchema(MATH_BLOCK, () => ({
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,
  attrs: { value: { default: '' } },

  parseDOM: [
    {
      tag: 'div[data-math-block]',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset['value'] ?? '' }),
    },
  ],

  toDOM: (node) => {
    const dom = document.createElement('div')
    dom.dataset['mathBlock'] = ''
    dom.dataset['value'] = node.attrs['value'] as string
    dom.className = 'light-math-block'
    render(dom, node.attrs['value'] as string, true)
    return dom
  },

  parseMarkdown: {
    match: (node) => node.type === 'math',
    runner: (state, node, type) => {
      state.addNode(type, { value: node['value'] as string })
    },
  },

  toMarkdown: {
    match: (node) => node.type.name === MATH_BLOCK,
    runner: (state, node) => {
      state.addNode('math', undefined, node.attrs['value'] as string)
    },
  },
}))

/** 供斜杠命令插入块级公式 */
export const insertMathBlockCommand = $command('InsertMathBlock', (ctx) => () => (state, dispatch) => {
  const type = mathBlockSchema.type(ctx)
  dispatch?.(state.tr.replaceSelectionWith(type.create({ value: '' })).scrollIntoView())
  return true
})

/** 输入 `$公式$` 后自动成为行内公式 */
export const mathInlineInputRule = $inputRule((ctx) =>
  new InputRule(/(?:^|[^$])\$([^$]+)\$$/, (state, match, start, end) => {
    const [full, value] = match
    if (!value?.trim()) return null

    // 正则里包含了前一个字符，实际替换要跳过它
    const offset = full!.length - value.length - 2
    return state.tr.replaceWith(
      start + offset,
      end,
      mathInlineSchema.type(ctx).create({ value: value.trim() }),
    )
  }),
)

/** 输入 `$$` 加回车后成为块级公式 */
export const mathBlockInputRule = $inputRule((ctx) =>
  new InputRule(/^\$\$\s$/, (state, _match, start, end) =>
    state.tr.replaceWith(start, end, mathBlockSchema.type(ctx).create({ value: '' })),
  ),
)

/**
 * 公式节点视图：平时显示渲染结果，点击后就地编辑 LaTeX 源码。
 *
 * 用原生 DOM 而非 Vue 组件实现：Milkdown 的 Vue 节点视图需要额外接入
 * `@prosemirror-adapter/vue`，而这里的交互只有「切换显示/编辑」一件事，
 * 引入一整套适配层不划算。
 */
function createMathView(displayMode: boolean) {
  return () =>
    (initialNode: ProseNode, view: EditorView, getPos: () => number | undefined): NodeView => {
      const dom = document.createElement(displayMode ? 'div' : 'span')
      dom.className = displayMode ? 'light-math-block' : 'light-math-inline'

      const preview = document.createElement(displayMode ? 'div' : 'span')
      // 块级用 textarea（允许多行），行内用 input。
      // 统一按 textarea 类型使用：此处只用到两者共有的 value / focus / select，
      // 而联合类型会让 addEventListener 的重载退化，把事件参数推成基础 Event。
      const input = document.createElement(displayMode ? 'textarea' : 'input') as HTMLTextAreaElement
      input.className = 'light-math-input'
      input.hidden = true

      dom.append(preview, input)

      let node = initialNode
      let editing = false

      const paint = () => {
        preview.textContent = ''
        const value = node.attrs['value'] as string
        if (value.trim()) render(preview, value, displayMode)
        else preview.textContent = displayMode ? '点击输入公式' : '空公式'
      }

      const commit = () => {
        const pos = getPos()
        if (pos === undefined) return
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { value: input.value }))
      }

      const stopEditing = () => {
        editing = false
        input.hidden = true
        preview.hidden = false
        commit()
      }

      const startEditing = () => {
        if (!view.editable) return
        editing = true
        input.value = node.attrs['value'] as string
        input.hidden = false
        preview.hidden = true
        input.focus()
        input.select()
      }

      dom.addEventListener('click', (event) => {
        if (editing) return
        event.preventDefault()
        startEditing()
      })

      input.addEventListener('blur', stopEditing)
      input.addEventListener('keydown', (event) => {
        // 行内公式回车即完成；块级公式允许换行，用 Esc 或 Cmd/Ctrl+Enter 结束
        if (event.key === 'Escape' || (event.key === 'Enter' && (!displayMode || event.metaKey || event.ctrlKey))) {
          event.preventDefault()
          stopEditing()
          view.focus()
        }
      })

      paint()

      return {
        dom,
        // 内容由 attrs 承载，ProseMirror 不需要管理子节点
        update: (updated) => {
          if (updated.type.name !== node.type.name) return false
          node = updated
          if (!editing) paint()
          return true
        },
        selectNode: () => dom.classList.add('is-selected'),
        deselectNode: () => dom.classList.remove('is-selected'),
        stopEvent: () => editing,
        ignoreMutation: () => true,
        destroy: () => {
          input.removeEventListener('blur', stopEditing)
        },
      }
    }
}

export const mathInlineView = $view(mathInlineSchema.node, createMathView(false))
export const mathBlockView = $view(mathBlockSchema.node, createMathView(true))

/** 数学公式插件集合 */
export const math = [
  remarkMathPlugin,
  mathInlineSchema,
  mathBlockSchema,
  mathInlineInputRule,
  mathBlockInputRule,
  insertMathBlockCommand,
  mathInlineView,
  mathBlockView,
].flat()
