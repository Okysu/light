<script setup lang="ts">
import {
  AlignLeft,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  Hash,
  List,
  Plus,
  Star,
  Tag,
  type LucideIcon,
} from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import TagInput from '@/components/TagInput.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PropertyDefinition } from '@/core/workspace/properties'
import { cn } from '@/lib/utils'
import { useCollectionsStore } from '@/stores/collections'
import { useEditorStore } from '@/stores/editor'
import { usePropertiesStore } from '@/stores/properties'
import { usePrompt } from '@/composables/use-prompt'
import { useI18nStore } from '@/stores/i18n'

/**
 * 文档属性表单（需求 S9）。
 *
 * 显示在标题下方，值直接写进笔记的 frontmatter——文件仍是标准 Markdown，
 * 其它工具照样读得懂。定义来自工作区配置，随同步扩散到多设备。
 */
const editor = useEditorStore()
const properties = usePropertiesStore()
const i18n = useI18nStore()

/**
 * 「未设置」的哨兵值。
 * reka-ui 的 SelectItem 不接受空字符串作为 value（空值用来表示「无选中」），
 * 因此用一个不可能与真实候选项冲突的标记，读写时再翻译回 undefined。
 */
const UNSET = '__unset__'
const collections = useCollectionsStore()
const { prompt } = usePrompt()

const collapsed = ref(false)

/** 待展示的属性：已登记的（未隐藏）+ 本篇里出现过但未登记的 */
const visible = computed(() => properties.definitionsFor(editor.note?.frontmatter ?? {}))

watch(
  () => editor.activePath,
  () => {
    if (editor.note) void properties.ensureLoaded()
  },
  { immediate: true },
)

/**
 * 每种属性都配图标——只给标签一个图标会让这一列看起来像漏做了。
 * 少数几个内置属性用更贴切的专属图标，其余按类型取。
 */
const TYPE_ICONS: Record<string, LucideIcon> = {
  text: AlignLeft,
  number: Hash,
  checkbox: CheckSquare,
  date: CalendarDays,
  select: List,
  multiSelect: Tag,
}

const KEY_ICONS: Record<string, LucideIcon> = {
  tags: Tag,
  favorite: Star,
}

function iconFor(definition: PropertyDefinition): LucideIcon {
  return KEY_ICONS[definition.key] ?? TYPE_ICONS[definition.type] ?? AlignLeft
}

function valueOf(definition: PropertyDefinition): unknown {
  return editor.note?.frontmatter[definition.key]
}

function textOf(definition: PropertyDefinition): string {
  const value = valueOf(definition)
  return value === undefined || value === null ? '' : String(value)
}

function listOf(definition: PropertyDefinition): string[] {
  const value = valueOf(definition)
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return typeof value === 'string' && value ? [value] : []
}

async function set(definition: PropertyDefinition, value: unknown): Promise<void> {
  await editor.setProperty(definition.key, value)
}

async function addListItem(definition: PropertyDefinition, value: string): Promise<void> {
  const current = listOf(definition)
  if (current.includes(value)) return
  await set(definition, [...current, value])
}

async function removeListItem(definition: PropertyDefinition, item: string): Promise<void> {
  const next = listOf(definition).filter((value) => value !== item)
  // 空数组仍写回，而不是删字段：用户可能只是清空了标签，字段本身应保留
  await set(definition, next)
}

/**
 * 多值属性的候选来源。
 * 标签直接用全库已有标签；其它多值属性暂用定义里的 options。
 */
function suggestionsFor(definition: PropertyDefinition): string[] {
  if (definition.key === 'tags') return collections.tags.map((entry) => entry.tag)
  return definition.options ?? []
}

async function addProperty(): Promise<void> {
  const label = await prompt({
    title: i18n.t('properties.newTitle'),
    description: i18n.t('properties.newDescription'),
    defaultValue: '',
    confirmLabel: i18n.t('common.create'),
  })
  if (!label) return
  await properties.addDefinition(label)
}

/** 日期类属性由系统维护，显示为易读格式 */
function formatDate(value: string): string {
  const time = Date.parse(value)
  return Number.isNaN(time) ? value : new Date(time).toLocaleString(i18n.locale)
}
</script>

<template>
  <section v-if="editor.note" class="light-print-hide border-b border-border pb-3">
    <button
      type="button"
      class="flex items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
      @click="collapsed = !collapsed"
    >
      <ChevronRight class="size-3.5 transition-transform" :class="!collapsed && 'rotate-90'" />
      {{ i18n.t('properties.title') }}
      <span v-if="collapsed" class="ml-1">（{{ visible.length }}）</span>
    </button>

    <div v-if="!collapsed" class="mt-2 space-y-1.5">
      <div
        v-for="definition in visible"
        :key="definition.key"
        class="grid grid-cols-[7rem_1fr] items-start gap-2 text-sm"
      >
        <span class="flex items-center gap-1.5 truncate pt-1 text-xs text-muted-foreground">
          <component :is="iconFor(definition)" class="size-3.5 shrink-0" />
          {{ definition.label }}
        </span>

        <!-- 只读：由系统维护的时间戳 -->
        <span v-if="definition.readonly" class="pt-1 text-xs text-muted-foreground">
          {{ textOf(definition) ? formatDate(textOf(definition)) : '—' }}
        </span>

        <!-- 多值：输入与选择合一，占满剩余宽度 -->
        <TagInput
          v-else-if="definition.type === 'multiSelect'"
          :values="listOf(definition)"
          :suggestions="suggestionsFor(definition)"
          :placeholder="definition.key === 'tags' ? i18n.t('properties.tagsPlaceholder') : i18n.t('properties.choose', { name: definition.label })"
          @add="addListItem(definition, $event)"
          @remove="removeListItem(definition, $event)"
        />

        <!-- 布尔 -->
        <Checkbox
          v-else-if="definition.type === 'checkbox'"
          class="mt-1"
          :model-value="valueOf(definition) === true"
          @update:model-value="set(definition, $event === true)"
        />

        <!-- 单选：候选来自定义或全库已有取值 -->
        <Select
          v-else-if="definition.type === 'select'"
          :model-value="textOf(definition) || UNSET"
          @update:model-value="set(definition, $event === UNSET ? undefined : ($event as string))"
        >
          <SelectTrigger class="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="UNSET">{{ i18n.t('properties.unset') }}</SelectItem>
            <SelectItem v-for="option in definition.options ?? []" :key="option" :value="option">
              {{ option }}
            </SelectItem>
          </SelectContent>
        </Select>

        <!-- 数值 / 日期 / 文本。
             正文区里的属性表单要尽量安静，因此边框平时透明、悬停或聚焦才显形（S2） -->
        <Input
          v-else
          :type="definition.type === 'number' ? 'number' : definition.type === 'date' ? 'date' : 'text'"
          :model-value="textOf(definition)"
          :placeholder="i18n.t('properties.unset')"
          :class="
            cn(
              'h-7 border-transparent bg-transparent px-1.5 text-sm shadow-none',
              'hover:border-input focus-visible:border-input',
            )
          "
          @change="
            set(
              definition,
              ($event.target as HTMLInputElement).value === ''
                ? undefined
                : definition.type === 'number'
                  ? Number(($event.target as HTMLInputElement).value)
                  : ($event.target as HTMLInputElement).value,
            )
          "
        />
      </div>

      <Button variant="ghost" size="sm" class="mt-1 text-xs text-muted-foreground" @click="addProperty">
        <Plus />
        {{ i18n.t('properties.addProperty') }}
      </Button>
    </div>
  </section>
</template>
