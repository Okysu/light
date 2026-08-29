<script setup lang="ts">
import { Download, Globe, Loader2 } from 'lucide-vue-next'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { flattenTree } from '@/core/workspace/tree'
import { useExportStore } from '@/stores/export'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18nStore } from '@/stores/i18n'
import SettingRow from '../SettingRow.vue'

const workspace = useWorkspaceStore()
const exporter = useExportStore()
const i18n = useI18nStore()

/**
 * 只数笔记，不含 `.light/` 里的配置。
 * 按钮上写「N 个文件」而结果提示「已导出 N+1 个」会让人以为多打包了什么，
 * 因此这里的措辞明确是「篇」，配置由说明文字交代。
 */
const noteCount = computed(() => flattenTree(workspace.tree).filter((node) => node.kind !== 'folder').length)

/**
 * 网页版的数据在 OPFS 里，用户在文件管理器中根本看不到。
 * 对他们来说导出不是「顺便备份」，而是取回自己数据的唯一途径，说明要写清楚。
 */
const isWeb = computed(() => workspace.runtime !== 'desktop')
</script>

<template>
  <div class="space-y-6">
    <SettingRow
      :label="i18n.t('export.all')"
      :description="i18n.t('export.allHint')"
    >
      <div class="space-y-2">
        <Button class="w-full" variant="outline" :disabled="exporter.exporting || !workspace.isOpen" @click="exporter.exportWorkspace()">
          <Loader2 v-if="exporter.exporting" class="animate-spin" />
          <Download v-else />
          {{ exporter.exporting ? i18n.t('export.packing') : i18n.t('export.allCount', { count: noteCount }) }}
        </Button>

        <p v-if="exporter.error" class="text-xs text-destructive">{{ exporter.error }}</p>
        <p v-else-if="exporter.lastResult" class="text-xs text-muted-foreground">{{ exporter.lastResult }}</p>
      </div>
    </SettingRow>

    <SettingRow
      :label="i18n.t('export.site')"
      :description="i18n.t('export.siteHint')"
    >
      <Button class="w-full" variant="outline" :disabled="exporter.exporting || !workspace.isOpen" @click="exporter.exportSite()">
        <Loader2 v-if="exporter.exporting" class="animate-spin" />
        <Globe v-else />
        {{ exporter.exporting ? i18n.t('export.generating') : i18n.t('export.siteButton') }}
      </Button>
    </SettingRow>

    <SettingRow v-if="isWeb" :label="i18n.t('export.webData')">
      <p class="rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        {{ i18n.t('export.webDataHint') }}
      </p>
    </SettingRow>

    <SettingRow :label="i18n.t('export.partial')">
      <p class="text-xs leading-relaxed text-muted-foreground">
        {{ i18n.t('export.partialHint') }}
      </p>
    </SettingRow>
  </div>
</template>
