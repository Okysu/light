<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18nStore } from '@/stores/i18n'
import SettingRow from '../SettingRow.vue'

const workspace = useWorkspaceStore()
const ui = useUiStore()
const i18n = useI18nStore()

const retentionDays = computed({
  get: () => workspace.config.trashRetentionDays,
  set: (value: number) => {
    void workspace.saveConfig({ ...workspace.config, trashRetentionDays: Number(value) || 0 })
  },
})

const searchIncludesTrash = computed({
  get: () => workspace.config.searchIncludesTrash,
  set: (value: boolean) => {
    void workspace.saveConfig({ ...workspace.config, searchIncludesTrash: value })
  },
})

function openTrash(): void {
  ui.settingsOpen = false
  ui.trashOpen = true
}
</script>

<template>
  <div class="space-y-6">
    <SettingRow
      :label="i18n.t('trash.autoClean')"
      :description="i18n.t('trash.autoCleanHint')"
    >
      <div class="flex w-full items-center gap-2">
        <Input v-model="retentionDays" type="number" min="0" max="3650" class="flex-1" />
        <span class="shrink-0 text-sm text-muted-foreground">{{ i18n.t('trash.days') }}</span>
      </div>
    </SettingRow>

    <SettingRow :label="i18n.t('trash.searchScope')" :description="i18n.t('trash.searchScopeHint')">
      <div class="flex w-full items-center justify-between gap-3">
        <Label for="search-trash" class="cursor-pointer font-normal">{{ i18n.t('trash.includeSearch') }}</Label>
        <Switch id="search-trash" v-model="searchIncludesTrash" />
      </div>
    </SettingRow>

    <SettingRow :label="i18n.t('trash.current')" :description="i18n.t('trash.count', { count: workspace.trashItems.length })">
      <Button class="w-full" variant="outline" @click="openTrash">{{ i18n.t('trash.open') }}</Button>
    </SettingRow>
  </div>
</template>
