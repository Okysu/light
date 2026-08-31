<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { CircleStop, Code2, Copy, CornerDownLeft, Sparkles, X } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { findScenario } from '@/core/ai/scenarios'
import { isScenarioEnabled } from '@/core/ai/settings'
import { useAiStore } from '@/stores/ai'
import { useEditorStore } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'
import { documentHtml, writeToClipboard } from '@/core/clipboard/copy-document'
import { useI18nStore } from '@/stores/i18n'
import { useAiScenarioI18n } from '@/composables/use-ai-scenario-i18n'
import { positionInScrollContainer } from './selection-position'

/**
 * 划词 AI 工具条。
 *
 * 选中文字后浮在选区上方，提供几个高频动作与一个自由输入框；
 * `/ai` 斜杠命令则在光标处唤起同一个输入框。
 *
 * 结果**流式直接写进编辑器**，不经过面板——划词改写是个连贯动作，
 * 中间弹一个对话框会打断它；而且这些动作（翻译、润色、扩缩写）的结果
 * 本来就是要替换原文的，先看一遍再点「应用」是多余的一步。
 *
 * 需要慢慢看结果的场景（摘要、标题建议）留在 AI 面板里，那里才需要预览。
 */

const props = defineProps<{ container: HTMLElement | null }>()

const editor = useEditorStore()
const workspace = useWorkspaceStore()
const ai = useAiStore()
const i18n = useI18nStore()
const scenarioI18n = useAiScenarioI18n()

/** 工具条相对编辑器容器的位置；null 表示不显示 */
const anchor = ref<{ left: number; top: number } | null>(null)
const instruction = ref('')
const input = ref<HTMLInputElement | null>(null)
const bar = ref<HTMLElement | null>(null)
/** 展开自由输入框。默认收起——多数时候用户点的是预设 */
const expanded = ref(false)
/** 有没有选中内容。决定要不要显示那排预设动作 */
const hasSelection = ref(false)

/** 划词工具条上的高频动作。顺序按使用频率，不按字典序 */
const QUICK_IDS = ['polish', 'translate', 'expand', 'shorten', 'summarize', 'continue'] as const

const quick = computed(() =>
  QUICK_IDS.map((id) => findScenario(id)).filter(
    (scenario): scenario is NonNullable<typeof scenario> =>
      !!scenario && isScenarioEnabled(ai.settings, scenario.id),
  ),
)

/** 工具条与容器边缘至少留这么多，免得贴边被裁掉 */
const EDGE_PADDING = 8

/**
 * 定位。
 *
 * 位置来自 `bridge.anchorRect()`（即 ProseMirror 的 `coordsAtPos`），
 * 不用 `window.getSelection().getBoundingClientRect()`——**折叠的选区
 * 在多数浏览器里返回全零矩形**，工具条会被摆到屏幕外，
 * 表现就是「`/ai` 点了没反应」。
 *
 * 算完还要按容器宽度收拢：选区靠近边缘时，居中的工具条会有一截
 * 被容器的 overflow 裁掉，用户只看得到一半按钮。
 */
async function place(): Promise<void> {
  const rect = editor.selectionBridge?.anchorRect()
  if (!rect || !props.container) {
    anchor.value = null
    return
  }

  const base = props.container.getBoundingClientRect()
  const { left: center, top } = positionInScrollContainer(
    rect,
    base,
    props.container.scrollLeft,
    props.container.scrollTop,
  )

  // 先摆上去再量宽度：工具条要渲染出来才知道自己多宽
  anchor.value = { left: center, top }
  await nextTick()

  const width = bar.value?.offsetWidth ?? 0
  if (width === 0) return

  const half = width / 2
  const min = props.container.scrollLeft + half + EDGE_PADDING
  // 容器比工具条还窄时 max 会小于 min，此时以 min 为准，宁可右边溢出
  const max = Math.max(min, props.container.scrollLeft + base.width - half - EDGE_PADDING)

  anchor.value = { left: Math.min(Math.max(center, min), max), top }
}

function updateAnchor(): void {
  if (!props.container) {
    anchor.value = null
    return
  }

  const text = editor.selectionBridge?.selection() ?? ''
  if (!text.trim()) {
    // 生成过程中不要因为选区消失就把工具条收掉——那会把「停止」按钮一起收走。
    // 输入框展开时同理：用户正在里面打字，光标已经不在正文里了
    if (!ai.busy && !expanded.value) anchor.value = null
    return
  }

  hasSelection.value = true
  void place()
}

async function copySelection(rich: boolean): Promise<void> {
  const markdown = editor.selectionBridge?.selection() ?? ''
  if (!markdown) return
  await writeToClipboard(markdown, rich ? await documentHtml(markdown) : undefined)
  dismiss()
}

// 交给下一帧：selectionchange 在 ProseMirror 更新自己的 state 之前就会触发。
// useEventListener 会在组件卸载时自己摘掉监听——切换笔记会重建编辑器，
// 手写 addEventListener 而忘了对称的 remove，监听器会一次次累积上去
useEventListener(document, 'selectionchange', () => requestAnimationFrame(updateAnchor))

async function expand(): Promise<void> {
  expanded.value = true
  await nextTick()
  await place()
  input.value?.focus()
}

/** `/ai` 斜杠命令：在光标处唤起输入框，没有选区也能用 */
watch(
  () => editor.aiPromptRequests,
  async () => {
    if (!ai.ready) return
    hasSelection.value = !!editor.selectionBridge?.selection().trim()
    await expand()
  },
)

/** 收起工具条 */
function dismiss(): void {
  expanded.value = false
  instruction.value = ''
  anchor.value = null
}

/**
 * 跑一个动作，流式写进编辑器。
 *
 * 选区在发起时就定格进 `beginStream`——请求飞行期间用户可能点了别处，
 * 那时再去读选区就写到别的地方了。
 */
async function run(scenarioId: string | null): Promise<void> {
  const bridge = editor.selectionBridge
  if (!bridge) return

  const scenario = scenarioId ? findScenario(scenarioId) : null
  const text = bridge.selection()
  if (!text.trim() && !instruction.value.trim()) return

  const stream = bridge.beginStream(scenario?.apply === 'insert' ? 'after' : 'replace')
  // 与选区同时捕获，不能在异步读图后再从当前标签页推断相对路径。
  const imageContext = { storage: workspace.storage, notePath: editor.activePath ?? '' }

  try {
    if (scenario) {
      await ai.run(scenario.id, text, scenario.parameter?.options[0], (chunk) => stream.push(chunk), imageContext)
    } else {
      await ai.runInstruction(instruction.value, text, (chunk) => stream.push(chunk), imageContext)
    }
    stream.commit()
    dismiss()
  } catch {
    // 一个字都没写出来就失败：撤掉那个空区间，别在正文里留个坑
    if (ai.output) stream.commit()
    else stream.cancel()
  }
}

/**
 * 按下鼠标时保住编辑器里的选区。
 *
 * 但**输入框除外**：整块都 preventDefault 的话，点进输入框永远拿不到焦点，
 * 于是「有个框却打不了字」。按钮不需要焦点，输入框需要。
 */
function keepSelection(event: MouseEvent): void {
  if ((event.target as HTMLElement | null)?.closest('input')) return
  event.preventDefault()
}
</script>

<template>
  <div
    v-if="anchor"
    ref="bar"
    class="light-print-hide absolute z-30 -translate-x-1/2 -translate-y-full pb-1.5"
    :style="{ left: `${anchor.left}px`, top: `${anchor.top}px` }"
    contenteditable="false"
    @mousedown="keepSelection"
  >
    <div class="flex flex-col gap-1 rounded-lg border border-border bg-popover p-1 shadow-md">
      <!-- 生成中：只留「停止」。此时点别的动作会顶掉当前请求，那不是用户想要的 -->
      <div v-if="ai.busy" class="flex items-center gap-2 px-2 py-1">
        <Sparkles class="size-3.5 animate-pulse text-muted-foreground" />
        <span class="text-xs text-muted-foreground">{{ i18n.t('ai.writing') }}</span>
        <Button size="sm" variant="ghost" class="h-6 px-2" @click="ai.stop()">
          <CircleStop class="size-3.5" />
          {{ i18n.t('ai.stop') }}
        </Button>
      </div>

      <template v-else>
        <!-- 没有选中内容（/ai 唤起）时不列预设：那些动作都要有原文才成立 -->
        <div v-if="hasSelection" class="flex items-center gap-0.5">
          <Button size="sm" variant="ghost" class="h-7 shrink-0 px-2 text-xs" :title="i18n.t('ai.copySelectionMarkdown')" @click="copySelection(false)"><Code2 class="size-3.5" /> Markdown</Button>
          <Button size="sm" variant="ghost" class="h-7 shrink-0 px-2 text-xs" :title="i18n.t('ai.copySelectionRich')" @click="copySelection(true)"><Copy class="size-3.5" /> Rich text</Button>
          <span v-if="ai.ready" class="mx-0.5 h-4 w-px bg-border" />
          <Button
            v-for="scenario in ai.ready ? quick : []"
            :key="scenario.id"
            size="sm"
            variant="ghost"
            class="h-7 shrink-0 px-2 text-xs"
            @click="run(scenario.id)"
          >
            {{ scenarioI18n.label(scenario) }}
          </Button>

          <Button
            v-if="ai.ready"
            size="sm"
            variant="ghost"
            class="h-7 shrink-0 px-2 text-xs"
            :title="i18n.t('ai.customAction')"
            @click="expand"
          >
            <Sparkles class="size-3.5" />
          </Button>

          <span class="mx-0.5 h-4 w-px bg-border" />

          <Button size="icon-sm" variant="ghost" class="size-7 shrink-0" :title="i18n.t('common.close')" @click="dismiss">
            <X class="size-3.5" />
          </Button>
        </div>

        <div v-if="ai.ready && (expanded || !hasSelection)" class="flex items-center gap-1 px-1 pb-0.5">
          <input
            ref="input"
            v-model="instruction"
            type="text"
            class="h-7 w-64 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            :placeholder="hasSelection ? i18n.t('ai.selectionPlaceholder') : i18n.t('ai.writePlaceholder')"
            @keydown.enter.prevent="run(null)"
            @keydown.esc="dismiss"
          />
          <Button
            size="icon-sm"
            variant="ghost"
            :disabled="!instruction.trim()"
            :title="i18n.t('ai.run')"
            @click="run(null)"
          >
            <CornerDownLeft />
          </Button>
          <!-- 没有选区时上面那排按钮不显示，关闭入口得在这一行补上 -->
          <Button v-if="!hasSelection" size="icon-sm" variant="ghost" :title="i18n.t('common.close')" @click="dismiss">
            <X />
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>
