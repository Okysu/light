import { editorViewCtx, parserCtx, serializerCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { Slice } from '@milkdown/kit/prose/model'

/**
 * AI 与编辑器之间的桥（6.3）。
 *
 * 收发的都是 **Markdown 源码**，不是纯文本，也不是 ProseMirror 节点：
 * - 送给模型的如果是 `textBetween` 的纯文本，选中一段列表再润色，回来的
 *   结构就全没了；
 * - 而让 AI 层去认识 ProseMirror 节点，等于把编辑器实现泄漏到了一个
 *   本该只关心「一段文字进、一段文字出」的模块里。
 *
 * Markdown 恰好是两边都认的中间形态——它本来就是这个应用的真源。
 */

export interface SelectionBridge {
  /** 选中区域的 Markdown；没有选中时返回空串 */
  selection: () => string
  /** 用新内容替换选中区域 */
  replace: (markdown: string) => void
  /** 插在选中区域之后（续写用） */
  insertAfter: (markdown: string) => void
  /**
   * 当前选区（或光标）在视口中的位置，用于给浮动工具条定位。
   *
   * 不用 `window.getSelection().getBoundingClientRect()`：**折叠的选区
   * （也就是一个光标）在多数浏览器里返回的是全零矩形**，工具条会被
   * 定位到屏幕左上角外面，表现就是「点了没反应」。
   * `coordsAtPos` 由 ProseMirror 直接从布局算出，光标与选区都可靠。
   */
  anchorRect: () => { left: number; right: number; top: number } | null
  /**
   * 开始一次流式写入，返回控制句柄。
   *
   * 与反复调 `replace` 的区别在于**撤销栈**：只有第一次刷新进历史，
   * 之后全部合并进去。否则写完一段话，用户要按几十次 Ctrl+Z 才能退回原样。
   */
  beginStream: (mode: 'replace' | 'after') => StreamHandle
}

/** 流式写入的句柄 */
export interface StreamHandle {
  /** 追加一段增量。实际落笔按帧节流，不必担心调用频率 */
  push: (text: string) => void
  /** 收尾：同步补上最后一次刷新 */
  commit: () => void
  /** 放弃：撤掉已经写进去的全部内容 */
  cancel: () => void
}

export function createSelectionBridge(getCtx: () => Ctx | null): SelectionBridge {
  return {
    selection: () => withCtx(getCtx, readSelection) ?? '',
    replace: (markdown) => {
      withCtx(getCtx, (ctx) => write(ctx, markdown, 'replace'))
    },
    insertAfter: (markdown) => {
      withCtx(getCtx, (ctx) => write(ctx, markdown, 'after'))
    },
    anchorRect: () => withCtx(getCtx, readAnchorRect),
    beginStream: (mode) => createStream(getCtx, mode),
  }
}

function readAnchorRect(ctx: Ctx): { left: number; right: number; top: number } {
  const view = ctx.get(editorViewCtx)
  const { from, to } = view.state.selection

  const head = view.coordsAtPos(from)
  const tail = from === to ? head : view.coordsAtPos(to)

  return {
    left: Math.min(head.left, tail.left),
    right: Math.max(head.right, tail.right),
    // 跨行选区取最上面那一行，工具条才不会盖住正在读的内容
    top: Math.min(head.top, tail.top),
  }
}

/**
 * 流式写入。
 *
 * 每次刷新都**重新解析已收到的全部 Markdown、整段替换**，而不是往文档里
 * 追加裸文本、等结束时再一次性解析。
 *
 * 后者是最初的写法，它有一个只在真实使用中才暴露的问题：追加进去的裸文本
 * 会被编辑器就地整形——`## ` 变成标题、`- ` 变成列表，一段文本于是散成
 * 好几个块，有的还嵌在列表项里。等到收尾时按 `start..end` 这个区间去替换，
 * 区间的两端已经落在不同深度的节点上，ProseMirror 只能做 fitting，
 * 放不下的块被**静默丢弃**——流式过程中内容都在，一提交只剩第一段，而且不报错。
 *
 * 整段替换没有这个问题：区间始终由上一次替换的 mapping 得出，
 * 内容始终是完整解析出来的块序列，与 `replace()` 走的是同一条被验证过的路。
 * 代价是每帧重新解析几 KB 的 Markdown——对一次 AI 生成来说完全够用。
 */
function createStream(getCtx: () => Ctx | null, mode: 'replace' | 'after'): StreamHandle {
  const ctx = getCtx()
  if (!ctx) return { push: () => {}, commit: () => {}, cancel: () => {} }

  const view = ctx.get(editorViewCtx)
  const { from, to } = view.state.selection

  /** 这段流占据的区间。start 固定，end 由每次替换的 mapping 推出 */
  const start = mode === 'replace' ? from : to
  let end = to
  let accumulated = ''
  let rendered = ''
  let frame: number | null = null

  /** 把已收到的全部内容解析后替换进去 */
  function flush(): void {
    if (accumulated === rendered) return

    const parsed = ctx!.get(parserCtx)(accumulated.trim())
    if (!parsed) return

    const transaction = view.state.tr.replaceRange(start, end, new Slice(parsed.content, 0, 0))
    // 只有第一次进撤销栈，之后全部合并进去——用户按一次 Ctrl+Z 就能退回原样，
    // 而不是几十次
    view.dispatch(transaction.setMeta('addToHistory', rendered === ''))

    end = transaction.mapping.map(end, 1)
    rendered = accumulated
  }

  return {
    push(text) {
      if (!text) return
      accumulated += text

      // 一帧最多重排一次。模型一秒能吐几十个片段，每个都跑一遍
      // 解析 + 重排既卡顿也没有意义——肉眼分辨不出 60fps 与 200fps
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        flush()
      })
    },

    commit() {
      if (frame !== null) {
        cancelAnimationFrame(frame)
        frame = null
      }
      // 同步补最后一次：等下一帧的话，调用方紧接着读到的还是上一帧的内容
      flush()
      if (rendered) view.focus()
    },

    cancel() {
      if (frame !== null) {
        cancelAnimationFrame(frame)
        frame = null
      }
      if (!rendered) return

      view.dispatch(view.state.tr.delete(start, end).setMeta('addToHistory', false))
      view.focus()
    },
  }
}

function withCtx<T>(getCtx: () => Ctx | null, action: (ctx: Ctx) => T): T | null {
  const ctx = getCtx()
  return ctx ? action(ctx) : null
}

function readSelection(ctx: Ctx): string {
  const view = ctx.get(editorViewCtx)
  const { from, to } = view.state.selection
  if (from === to) return ''

  const slice = view.state.doc.slice(from, to)
  // 把切片装回一个临时的顶层节点再序列化：serializer 接受的是文档，不是切片
  const doc = view.state.schema.topNodeType.create(null, slice.content)
  return ctx.get(serializerCtx)(doc).trim()
}

function write(ctx: Ctx, markdown: string, mode: 'replace' | 'after'): void {
  const view = ctx.get(editorViewCtx)
  const { from, to } = view.state.selection

  const parsed = ctx.get(parserCtx)(markdown)
  if (!parsed) return

  // 用切片而不是整个 doc 节点：直接塞 doc 会在正文里嵌一层文档节点，
  // schema 不允许，ProseMirror 会静默丢弃整段内容
  const slice = new Slice(parsed.content, 0, 0)
  const start = mode === 'replace' ? from : to
  const transaction = view.state.tr.replaceRange(start, to, slice)

  view.dispatch(transaction)
  view.focus()
}
