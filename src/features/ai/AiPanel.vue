<script setup lang="ts">
import { Brain, ChevronRight, CircleStop, Settings2, Sparkles } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AiScenario } from '@/core/ai/scenarios'
import { boardFromTaskLines, canvasFromMindmap } from '@/core/ai/artifacts'
import { useAiStore } from '@/stores/ai'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import StreamedMarkdown from './StreamedMarkdown.vue'
import { useI18nStore } from '@/stores/i18n'
import { useAiScenarioI18n } from '@/composables/use-ai-scenario-i18n'

/**
 * AI 面板（6.3 / 6.5）。
 *
 * 结果**不自动落笔**。模型的输出是建议，不是编辑——先看到、再决定要不要用，
 * 这是能安心用它的前提。自动替换选中内容意味着每次不满意都要撤销一次，
 * 而撤销一段流式写入的历史往往不干净。
 */

const ui = useUiStore()
const ai = useAiStore()
const editor = useEditorStore()
const workspace = useWorkspaceStore()
const i18n = useI18nStore()
const scenarioI18n = useAiScenarioI18n()

/** 打开面板时定格的选中内容。之后编辑器失焦、选区消失也不影响这次操作 */
const captured = ref('')
const parameter = ref('')
const chosen = ref<AiScenario | null>(null)

const hasSelection = computed(() => captured.value.trim().length > 0)

/** 有选中就先给选区类场景，没有就只剩整篇类——避免列一堆点了报错的按钮 */
const scenarios = computed(() =>
  ai.availableScenarios.filter(
    (scenario) => scenario.target === 'document' || hasSelection.value,
  ),
)

watch(
  () => ui.aiOpen,
  (open) => {
    if (!open) {
      ai.stop()
      return
    }
    captured.value = editor.selectionBridge?.selection() ?? ''
    chosen.value = null
    parameter.value = ''
    ai.reset()
  },
)

function inputFor(scenario: AiScenario): string {
  return scenario.target === 'document' ? editor.fullContent : captured.value
}

async function start(scenario: AiScenario): Promise<void> {
  chosen.value = scenario
  parameter.value = parameter.value || scenario.parameter?.options[0] || ''

  try {
    await ai.run(scenario.id, inputFor(scenario), parameter.value)
  } catch {
    // 错误已经进了 store 的 error/hint，模板会展示；这里不重复处理
  }
}

/** 换个参数重跑（换一种语气、换一门语言） */
async function rerun(value: string): Promise<void> {
  parameter.value = value
  if (chosen.value) await start(chosen.value)
}

function apply(): void {
  const bridge = editor.selectionBridge
  const scenario = chosen.value
  if (!bridge || !scenario || !ai.output) return

  if (scenario.apply === 'insert') bridge.insertAfter(`\n\n${ai.output.trim()}`)
  else bridge.replace(ai.output.trim())

  ui.aiOpen = false
}

async function createArtifact(): Promise<void> {
  if (!chosen.value || !ai.output) return
  const newId = () => crypto.randomUUID()
  let path = ''
  if (chosen.value.id === 'breakdown') {
    const board = boardFromTaskLines(ai.output, newId)
      path = await workspace.createNote('', i18n.t('ai.taskBoardTitle'), 'board', JSON.stringify(board, null, 2))
  } else if (chosen.value.id === 'mindmap') {
    const canvas = canvasFromMindmap(ai.output, newId)
      path = await workspace.createNote('', i18n.t('ai.mindMapTitle'), 'canvas', JSON.stringify(canvas, null, 2))
  }
  if (path) {
    await editor.openNote(path)
    ui.aiOpen = false
  }
}

/**
 * 复制反馈。
 *
 * 与代码块的复制按钮同一套做法：按钮文字变成「已复制」，两秒后自己变回去。
 * 不弹 toast——一个只为了确认「点到了」的提示，不值得在屏幕角落
 * 盖住别的东西两秒钟。
 */
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copy(): Promise<void> {
  await navigator.clipboard.writeText(ai.output.trim())

  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copied.value = false
  }, 2000)
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

/** 思考默认折叠。它常常比答案长好几倍，摊开来会把结果挤到屏幕外 */
const reasoningOpen = ref(false)

/** suggest 类的结果不该直接写回正文，只提供复制 */
const canApply = computed(
  () => !!chosen.value && chosen.value.apply !== 'suggest' && !!editor.selectionBridge,
)
const canCreateArtifact = computed(
  () => chosen.value?.id === 'breakdown' || chosen.value?.id === 'mindmap',
)
</script>

<template>
  <Dialog v-model:open="ui.aiOpen" :title="i18n.t('app.ai')" hide-header class="h-[70vh] max-h-[40rem]">
    <div class="flex items-center gap-2 border-b border-border px-4 py-3">
      <Sparkles class="size-4 text-muted-foreground" />
      <span class="text-sm font-medium">{{ i18n.t('app.ai') }}</span>
      <span v-if="chosen" class="text-xs text-muted-foreground">· {{ scenarioI18n.label(chosen) }}</span>

      <Button
        size="icon-sm"
        variant="ghost"
        class="ml-auto"
        :title="i18n.t('ai.settings')"
        @click="((ui.aiOpen = false), (ui.settingsOpen = true))"
      >
        <Settings2 />
      </Button>
    </div>

    <!-- 未配置：直接说清楚缺什么，而不是给一个点了没反应的界面 -->
    <div v-if="!ai.ready" class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p class="text-sm text-muted-foreground">
        {{ ai.settings.enabled ? i18n.t('ai.noKey') : i18n.t('ai.disabled') }}
      </p>
      <p class="max-w-sm text-xs text-muted-foreground">
        {{ i18n.t('ai.bringKey') }}
      </p>
      <Button size="sm" @click="((ui.aiOpen = false), (ui.settingsOpen = true))">{{ i18n.t('ai.goSettings') }}</Button>
    </div>

    <template v-else>
      <!-- 场景选择 -->
      <div v-if="!chosen" class="min-h-0 flex-1">
        <ScrollArea class="h-full" viewport-class="p-2">
          <p v-if="!hasSelection" class="px-2 pb-2 text-xs text-muted-foreground">
            {{ i18n.t('ai.noSelection') }}
          </p>

          <button
            v-for="scenario in scenarios"
            :key="scenario.id"
            type="button"
            class="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-accent"
            @click="start(scenario)"
          >
            <span class="text-sm">{{ scenarioI18n.label(scenario) }}</span>
            <span class="text-xs text-muted-foreground">{{ scenarioI18n.description(scenario) }}</span>
          </button>

          <p v-if="scenarios.length === 0" class="px-3 py-8 text-center text-sm text-muted-foreground">
            {{ i18n.t('ai.noScenarios') }}
          </p>
        </ScrollArea>
      </div>

      <!-- 结果 -->
      <template v-else>
        <div v-if="chosen.parameter" class="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
          <span class="text-xs text-muted-foreground">{{ scenarioI18n.parameter(chosen) }}</span>
          <Button
            v-for="option in chosen.parameter.options"
            :key="option"
            size="sm"
            :variant="parameter === option ? 'default' : 'outline'"
            :disabled="ai.busy"
            @click="rerun(option)"
          >
            {{ scenarioI18n.option(option) }}
          </Button>
        </div>

        <div class="min-h-0 flex-1">
          <ScrollArea class="h-full" viewport-class="px-4 py-3">
            <p v-if="ai.error" class="text-sm text-destructive">{{ ai.error }}</p>
            <p v-if="ai.hint" class="mt-1 text-xs text-muted-foreground">{{ ai.hint }}</p>

            <!-- 思考过程：默认折叠，点标题展开。
                 推理模型的思考往往比答案长几倍，摊开来用户会以为程序卡住了 -->
            <div v-if="ai.reasoning" class="mb-3 rounded-md border border-border bg-muted/40">
              <button
                type="button"
                class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                @click="reasoningOpen = !reasoningOpen"
              >
                <ChevronRight
                  class="size-3.5 transition-transform"
                  :class="reasoningOpen && 'rotate-90'"
                />
                <Brain class="size-3.5" :class="ai.busy && !ai.output && 'animate-pulse'" />
                <span>{{ i18n.t('ai.reasoning') }}</span>
                <span class="ml-auto tabular-nums">{{ i18n.t('ai.characters', { count: ai.reasoning.length }) }}</span>
              </button>

              <p
                v-if="reasoningOpen"
                class="max-h-52 overflow-y-auto whitespace-pre-wrap break-words border-t border-border px-2.5 py-2 text-xs leading-relaxed text-muted-foreground"
              >
                {{ ai.reasoning }}
              </p>
            </div>

            <!-- 结果按 Markdown 渲染。列表、表格、公式都是模型常给的东西，
                 让用户对着一堆星号和竖线读，等于把渲染工作推给了他 -->
            <StreamedMarkdown v-if="ai.output" :source="ai.output" />

            <p v-else-if="ai.busy && !ai.reasoning" class="text-sm text-muted-foreground">{{ i18n.t('ai.generating') }}</p>
          </ScrollArea>
        </div>

        <div class="flex items-center gap-2 border-t border-border px-4 py-3">
          <Button size="sm" variant="ghost" :disabled="ai.busy" @click="chosen = null">{{ i18n.t('ai.back') }}</Button>

          <!-- 中断（6.5）：真的取消请求，不是只停止显示 -->
          <Button v-if="ai.busy" size="sm" variant="outline" class="ml-auto" @click="ai.stop()">
            <CircleStop />
            {{ i18n.t('ai.stop') }}
          </Button>

          <template v-else-if="ai.output">
            <Button size="sm" variant="ghost" class="ml-auto" @click="copy">
              {{ copied ? i18n.t('ai.copied') : i18n.t('ai.copy') }}
            </Button>
            <Button v-if="canApply" size="sm" @click="apply">
              {{ chosen.apply === 'insert' ? i18n.t('ai.insert') : i18n.t('ai.replace') }}
            </Button>
            <Button v-if="canCreateArtifact" size="sm" @click="createArtifact">
              {{ chosen.id === 'breakdown' ? i18n.t('ai.createBoard') : i18n.t('ai.createCanvas') }}
            </Button>
          </template>
        </div>
      </template>
    </template>
  </Dialog>
</template>
