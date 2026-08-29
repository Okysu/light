import type { Ctx } from '@milkdown/kit/ctx'
import { SlashProvider, slashFactory } from '@milkdown/kit/plugin/slash'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { computed, ref, type ComputedRef, type Ref } from 'vue'

/**
 * 编辑器内「打字触发的候选菜单」的通用骨架。
 *
 * 斜杠命令（`/`）与双向链接补全（`[[`）除了三件事之外完全一样：
 * 什么时候触发、候选项从哪来、选中后做什么。其余的——挂载点、SlashProvider 的
 * 装配与定位、上下键与回车的拦截、高亮索引的边界处理——各写一份就是一百行的重复，
 * 而这类重复最容易长歪：一边修了键盘边界，另一边没修。
 *
 * 因此把那三件事参数化，其余共用。菜单的**渲染**不共用：斜杠菜单显示图标与命令名，
 * 链接菜单显示标题与路径，硬凑成一个组件只会让两边都别扭。
 */

export interface AutocompleteTrigger {
  /** 触发符之后、光标之前的查询词 */
  query: string
  /** 连同触发符一共占了多少个字符，执行时要整段抹掉 */
  length: number
}

export interface AutocompleteOptions<T> {
  /** ProseMirror 插件 key，需全局唯一 */
  key: string
  /** 挂载点的类名，供样式定位 */
  className: string
  /** 判断当前是否处于触发状态，并给出查询词 */
  detect: (view: EditorView) => AutocompleteTrigger | null
  /** 按查询词给出候选项。在 computed 中调用，可直接读响应式数据源 */
  items: (query: string) => T[]
  /** 选中后的动作。调用时触发文本已被抹掉，光标停在原处 */
  apply: (ctx: Ctx, view: EditorView, item: T) => void
}

export interface AutocompleteController<T> {
  /** 菜单挂载点，Vue 侧用 Teleport 渲染进来，定位交给 SlashProvider */
  contentEl: HTMLElement
  visible: Ref<boolean>
  query: Ref<string>
  activeIndex: Ref<number>
  items: ComputedRef<T[]>
  /** Milkdown 插件，需由 createLightEditor 注册 */
  plugin: ReturnType<typeof slashFactory>
  configure: (ctx: Ctx) => void
  move: (delta: number) => void
  runActive: () => void
  runItem: (item: T) => void
  close: () => void
}

/**
 * 每个编辑器实例配一个 controller，不用模块级单例，避免多编辑器场景互相串状态。
 */
export function createAutocomplete<T>(options: AutocompleteOptions<T>): AutocompleteController<T> {
  // SlashProvider 会自行把它挂到编辑器容器下，并通过 data-show 与绝对定位控制显隐
  const contentEl = document.createElement('div')
  contentEl.className = options.className

  const visible = ref(false)
  const query = ref('')
  const activeIndex = ref(0)
  const items = computed(() => options.items(query.value))

  const plugin = slashFactory(options.key)

  let ctx: Ctx | null = null
  let view: EditorView | null = null
  let provider: SlashProvider | null = null

  function configure(editorCtx: Ctx): void {
    ctx = editorCtx

    editorCtx.set(plugin.key, {
      view: (editorView: EditorView) => {
        view = editorView
        provider = new SlashProvider({
          content: contentEl,
          shouldShow: (target) => options.detect(target) !== null,
          offset: 8,
        })

        return {
          update: (updatedView: EditorView, prevState?: EditorState) => {
            view = updatedView
            const next = options.detect(updatedView)

            // 查询词变了就把高亮拉回首项，否则用户翻到第 3 项后继续打字会选错
            if (next !== null && next.query !== query.value) activeIndex.value = 0
            query.value = next?.query ?? ''
            visible.value = next !== null

            provider?.update(updatedView, prevState)
          },
          destroy: () => {
            provider?.destroy()
            provider = null
            view = null
            visible.value = false
          },
        }
      },

      props: {
        // 菜单打开时接管上下键与回车，否则这些键会落到编辑器里去移动光标
        handleKeyDown: (_: EditorView, event: KeyboardEvent) => handleKeyDown(event),
      },
    })
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    if (!visible.value || items.value.length === 0) return false

    switch (event.key) {
      case 'ArrowDown':
        move(1)
        return true
      case 'ArrowUp':
        move(-1)
        return true
      case 'Enter':
        runActive()
        return true
      case 'Escape':
        close()
        return true
      default:
        return false
    }
  }

  function move(delta: number): void {
    const total = items.value.length
    if (total === 0) return
    activeIndex.value = (activeIndex.value + delta + total) % total
  }

  function runActive(): void {
    const item = items.value[activeIndex.value]
    if (item !== undefined) runItem(item)
  }

  /** 先抹掉已输入的触发文本，再执行动作，否则产出的内容里会残留这段文本 */
  function runItem(item: T): void {
    if (!ctx || !view) return

    const trigger = options.detect(view)
    if (trigger !== null) {
      const { $from } = view.state.selection
      view.dispatch(view.state.tr.delete($from.pos - trigger.length, $from.pos))
    }

    close()
    view.focus()
    options.apply(ctx, view, item)
  }

  function close(): void {
    visible.value = false
    provider?.hide()
  }

  return {
    contentEl,
    visible,
    query,
    activeIndex,
    items,
    plugin,
    configure,
    move,
    runActive,
    runItem,
    close,
  }
}

/**
 * 读取光标前的文本，供 `detect` 实现使用。
 * 代码块内一律返回 null——在代码里打 `/` 或 `[[` 是正常内容，不该弹菜单。
 */
export function textBeforeCursor(view: EditorView): string | null {
  const { selection } = view.state
  if (!selection.empty) return null

  const { $from } = selection
  if ($from.parent.type.spec.code) return null

  return $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
}
