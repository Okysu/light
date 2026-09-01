<script setup lang="ts">
import { onBeforeUnmount, onMounted, computed, nextTick, ref } from 'vue'
import { Check, X } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import { normalizeTagPath } from '@/core/tags/hierarchy'
import { useI18nStore } from '@/stores/i18n'
import TagPath from './TagPath.vue'

/**
 * 标签输入：输入框与选择器的结合体。
 *
 * 点击后既能从已有标签里挑，也能直接敲新的——用户在写标签时并不区分
 * 「选一个」和「建一个」，拆成两个控件只会多一次决策。
 * 控件本身占满剩余宽度，因此已选标签多时会自然换行，不会挤成一条。
 */
const props = defineProps<{
  values: string[]
  /** 候选项，通常来自全库已用过的标签 */
  suggestions: string[]
  placeholder?: string
}>()

const emit = defineEmits<{ add: [value: string]; remove: [value: string] }>()
const i18n = useI18nStore()

const root = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const open = ref(false)
const query = ref('')
const activeIndex = ref(0)
const normalizedValues = computed(() => new Set(props.values.map(normalizeTagPath)))
const normalizedSuggestions = computed(() => [...new Set(props.suggestions.map(normalizeTagPath).filter(Boolean))])

/** 未被选中的候选，按输入过滤 */
const filtered = computed(() => {
  const keyword = normalizeTagPath(query.value).toLowerCase()
  return normalizedSuggestions.value
    .filter((item) => !normalizedValues.value.has(item))
    .filter((item) => !keyword || item.toLowerCase().includes(keyword))
})

/** 输入了新词且不在候选里时，提供「创建」这一项 */
const creatable = computed(() => {
  const keyword = normalizeTagPath(query.value)
  if (!keyword) return null
  if (normalizedValues.value.has(keyword)) return null
  return normalizedSuggestions.value.includes(keyword) ? null : keyword
})

/** 候选 + 创建项合成一个可键盘遍历的列表 */
const options = computed(() => [
  ...filtered.value.map((value) => ({ value, isNew: false })),
  ...(creatable.value ? [{ value: creatable.value, isNew: true }] : []),
])

async function activate(): Promise<void> {
  open.value = true
  activeIndex.value = 0
  await nextTick()
  input.value?.focus()
}

function choose(value: string): void {
  const normalized = normalizeTagPath(value)
  if (!normalized) return
  emit('add', normalized)
  query.value = ''
  activeIndex.value = 0
  // 保持展开：连续添加多个标签是常态
  input.value?.focus()
}

function move(delta: number): void {
  const total = options.value.length
  if (total === 0) return
  activeIndex.value = (activeIndex.value + delta + total) % total
}

function onEnter(): void {
  const option = options.value[activeIndex.value]
  if (option) choose(option.value)
  else if (query.value.trim()) choose(query.value)
}

/** 输入为空时按退格删掉最后一个标签，与常见的标签输入一致 */
function onBackspace(): void {
  if (query.value) return
  const last = props.values.at(-1)
  if (last) emit('remove', last)
}

function close(): void {
  open.value = false
  query.value = ''
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!open.value) return
  if (root.value?.contains(event.target as Node)) return
  close()
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true))
</script>

<template>
  <div ref="root" class="relative w-full">
    <!-- 整块可点：点空白处也能开始输入，不必精确点到那个小加号 -->
    <div
      :class="
        cn(
          'flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-sm',
          'cursor-text hover:border-input',
          open && 'border-input ring-1 ring-ring',
        )
      "
      @click="activate"
    >
      <span
        v-for="value in values"
        :key="value"
        class="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
      >
        <TagPath :value="value" />
        <button
          type="button"
          class="text-muted-foreground hover:text-destructive"
          :title="i18n.t('tag.remove', { name: value })"
          @click.stop="emit('remove', value)"
        >
          <X class="size-3" />
        </button>
      </span>

      <!-- 这里刻意用原生 input 而不是 ui/input：它是组合控件**内部**的裸输入，
           外层容器已经提供了边框、背景与聚焦环。套一层带边框的 Input 会出现
           框中框。shadcn 自己的 TagsInput / Combobox 内部同样是裸 input。 -->
      <input
        v-if="open"
        ref="input"
        v-model="query"
        type="text"
        class="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        :placeholder="placeholder ?? i18n.t('tag.placeholder')"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="onEnter"
        @keydown.esc.prevent="close"
        @keydown.backspace="onBackspace"
      />
      <span v-else-if="values.length === 0" class="px-0.5 text-xs text-muted-foreground">
        {{ placeholder ?? i18n.t('tag.placeholder') }}
      </span>
    </div>

    <div
      v-if="open"
      class="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-md"
    >
      <p v-if="options.length === 0" class="px-2 py-2 text-xs text-muted-foreground">
        {{ i18n.t(suggestions.length === 0 ? 'tag.empty' : 'tag.noMatch') }}
      </p>

      <button
        v-for="(option, index) in options"
        :key="option.value"
        type="button"
        :class="
          cn(
            'flex w-full items-center gap-2 rounded-sm border border-transparent px-2 py-1.5 text-left text-sm',
            index === activeIndex && 'bg-accent text-accent-foreground',
          )
        "
        @mouseenter="activeIndex = index"
        @click.stop="choose(option.value)"
      >
        <Check v-if="!option.isNew" class="size-3.5 shrink-0 opacity-0" />
        <span class="truncate">
          <template v-if="option.isNew">
            {{ i18n.t(option.value.includes('/') ? 'tag.createHierarchy' : 'tag.createValue') }}
            <TagPath :value="option.value" class="ml-1 font-medium" />
          </template>
          <TagPath v-else :value="option.value" />
        </span>
      </button>
    </div>
  </div>
</template>
