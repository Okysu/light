<script setup lang="ts">
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PropertyDefinition, PropertyType } from '@/core/workspace/properties'
import { usePropertiesStore } from '@/stores/properties'
import { useI18nStore } from '@/stores/i18n'
import SettingRow from '../SettingRow.vue'

const properties = usePropertiesStore()
const i18n = useI18nStore()

const TYPES = computed<Array<{ value: PropertyType; label: string }>>(() => [
  { value: 'text', label: i18n.t('properties.text') }, { value: 'number', label: i18n.t('properties.number') },
  { value: 'checkbox', label: i18n.t('properties.checkbox') }, { value: 'date', label: i18n.t('properties.date') },
  { value: 'select', label: i18n.t('properties.select') }, { value: 'multiSelect', label: i18n.t('properties.multiSelect') },
])

const newLabel = ref('')

onMounted(() => {
  void properties.ensureLoaded()
})

/** 笔记里出现过、但尚未登记的字段。第三方工具写入的键也在此浮现 */
const unregistered = computed(() =>
  [...properties.discovered.entries()].filter(
    ([key]) => !properties.definitions.some((definition) => definition.key === key),
  ),
)

function needsOptions(definition: PropertyDefinition): boolean {
  return definition.type === 'select' || definition.type === 'multiSelect'
}

function optionsText(definition: PropertyDefinition): string {
  return (definition.options ?? []).join(', ')
}

function writeOptions(key: string, raw: string): void {
  const options = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  void properties.updateDefinition(key, { options })
}

async function add(): Promise<void> {
  const label = newLabel.value.trim()
  if (!label) return

  await properties.addDefinition(label)
  newLabel.value = ''
}
</script>

<template>
  <div class="space-y-6">
    <SettingRow :label="i18n.t('properties.definitions')" :description="i18n.t('properties.definitionsHint')">
      <ul class="space-y-2">
        <li v-for="(definition, index) in properties.definitions" :key="definition.key"
          class="space-y-2 rounded-md border border-border p-3">
          <div class="flex items-center gap-2">
            <!-- 顺序就是笔记里属性表单的排列顺序，因此调整入口放在每一项上 -->
            <div class="flex shrink-0 flex-col">
              <button
                class="rounded-sm px-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                :title="i18n.t('properties.moveUp')"
                :disabled="index === 0"
                @click="properties.moveDefinition(definition.key, -1)"
              >
                <ChevronUp class="size-3.5" />
              </button>
              <button
                class="rounded-sm px-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                :title="i18n.t('properties.moveDown')"
                :disabled="index === properties.definitions.length - 1"
                @click="properties.moveDefinition(definition.key, 1)"
              >
                <ChevronDown class="size-3.5" />
              </button>
            </div>

            <span class="min-w-0 flex-1 truncate font-mono text-sm">{{ definition.key }}</span>

            <Select :model-value="definition.type" :disabled="definition.readonly" @update:model-value="
              properties.updateDefinition(definition.key, { type: $event as PropertyType })
              ">
              <SelectTrigger class="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="type in TYPES" :key="type.value" :value="type.value">
                  {{ type.label }}
                </SelectItem>
              </SelectContent>
            </Select>

            <Label class="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <Checkbox :model-value="definition.hidden === true"
                @update:model-value="properties.updateDefinition(definition.key, { hidden: $event === true })" />
              {{ i18n.t('properties.hidden') }}
            </Label>

            <!-- 内置属性删掉会让已有笔记的字段失去定义，只允许隐藏 -->
            <Button size="icon-sm" variant="ghost" :disabled="definition.builtin"
              :title="definition.builtin ? i18n.t('properties.builtinDelete') : i18n.t('properties.delete')"
              @click="properties.removeDefinition(definition.key)">
              <Trash2 />
            </Button>
          </div>

          <div v-if="needsOptions(definition)" class="space-y-1">
            <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('properties.options') }}</Label>
            <Input :model-value="optionsText(definition)" :placeholder="i18n.t('properties.optionsPlaceholder')"
              @change="writeOptions(definition.key, ($event.target as HTMLInputElement).value)" />
          </div>
        </li>
      </ul>

      <!-- 输入框吃满剩余宽度，按钮固定：与标签输入（TagInput）保持同一种排布 -->
      <div class="mt-2 flex w-full items-center gap-2">
        <Input v-model="newLabel" class="flex-1" :placeholder="i18n.t('properties.newName')" @keydown.enter.prevent="add" />
        <Button class="shrink-0" variant="outline" :disabled="!newLabel.trim()" @click="add">
          <Plus />
          {{ i18n.t('properties.add') }}
        </Button>
      </div>
    </SettingRow>

    <SettingRow v-if="unregistered.length > 0" :label="i18n.t('properties.unregistered')" :description="i18n.t('properties.unregisteredHint')">
      <ul class="space-y-1">
        <li v-for="[key, type] in unregistered" :key="key"
          class="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <span class="min-w-0 flex-1 truncate font-mono">{{ key }}</span>
          <span class="shrink-0 text-xs text-muted-foreground">{{ i18n.t('properties.inferred', { type }) }}</span>
          <Button size="sm" variant="ghost" @click="properties.registerDiscovered(key)">{{ i18n.t('properties.register') }}</Button>
        </li>
      </ul>
    </SettingRow>
  </div>
</template>
