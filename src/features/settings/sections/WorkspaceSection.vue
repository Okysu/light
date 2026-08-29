<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { currentDataPath, hasCustomDataPath } from '@/core/storage'
import { dailyNotePath } from '@/core/workspace/daily-note'
import { useWorkspaceStore } from '@/stores/workspace'
import { usePreferencesStore } from '@/stores/preferences'
import { useI18nStore } from '@/stores/i18n'
import { SHORTCUT_BINDINGS } from '@/core/keyboard/bindings'
import { formatShortcut, isMacPlatform, resolveShortcut } from '@/core/keyboard/shortcut'
import SettingRow from '../SettingRow.vue'

const workspace = useWorkspaceStore()
const preferences = usePreferencesStore()
const i18n = useI18nStore()
const dailyBinding = SHORTCUT_BINDINGS.find((binding) => binding.id === 'daily-note')!
const dailyShortcut = computed(() => formatShortcut(resolveShortcut(dailyBinding, preferences.shortcutOverrides), isMacPlatform()))

/**
 * 库配置写在 `.light/workspace.json` 里，随数据目录走。
 * 每个字段单独一个 computed setter：一次只改一项，避免把整份配置回写
 * 时顺带覆盖掉别处刚改过的字段。
 */
function field<K extends 'dailyNoteFolder' | 'dailyNoteFormat'>(key: K) {
  return computed({
    get: () => workspace.config[key],
    set: (value: string) => {
      void workspace.saveConfig({ ...workspace.config, [key]: value })
    },
  })
}

const dailyNoteFolder = field('dailyNoteFolder')
const dailyNoteFormat = field('dailyNoteFormat')

/** 拿今天当样例，让用户看到格式串的实际效果而不用先去猜 */
const dailyNotePreview = computed(() =>
  dailyNotePath(new Date(), dailyNoteFolder.value, dailyNoteFormat.value),
)

/** 当前数据目录。异步取，因为默认值要问系统「文档目录在哪」 */
const dataPath = ref('')
const customized = ref(false)

async function refreshPath(): Promise<void> {
  if (workspace.runtime !== 'desktop') return
  dataPath.value = await currentDataPath()
  customized.value = hasCustomDataPath()
}

onMounted(refreshPath)

async function change(): Promise<void> {
  try {
    if (await workspace.changeDataPath()) await refreshPath()
  } catch (cause) {
    workspace.error = cause instanceof Error ? cause.message : String(cause)
  }
}

async function reset(): Promise<void> {
  try {
    await workspace.resetDataPath()
    await refreshPath()
  } catch (cause) {
    workspace.error = cause instanceof Error ? cause.message : String(cause)
  }
}
</script>

<template>
  <div class="space-y-6">
    <!--
      数据位置放在最前面：这是用户唯一需要知道的「我的东西在哪」。
      不叫「工作区」——那是实现细节，用户想的是保存路径。
    -->
    <SettingRow
      v-if="workspace.runtime === 'desktop'"
      :label="i18n.t('workspace.dataPath')"
      :description="i18n.t('workspace.dataPathHint')"
    >
      <div class="flex w-full flex-col gap-2">
        <code class="break-all rounded-md bg-muted px-2 py-1.5 text-xs">{{ dataPath || i18n.t('workspace.loading') }}</code>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" @click="change">{{ i18n.t('workspace.change') }}</Button>
          <!-- 没改过就不显示「恢复默认」：一个点了什么也不会变的按钮只会让人怀疑自己 -->
          <Button v-if="customized" variant="ghost" size="sm" @click="reset">{{ i18n.t('workspace.reset') }}</Button>
        </div>
      </div>
    </SettingRow>

    <SettingRow
      v-else
      :label="i18n.t('workspace.dataPath')"
      :description="i18n.t('workspace.webPathHint')"
    >
      <code class="rounded-md bg-muted px-2 py-1.5 text-xs">{{ i18n.t('workspace.browserStorage') }}</code>
    </SettingRow>

    <SettingRow
      :label="i18n.t('workspace.daily')"
      :description="i18n.t('workspace.dailyHint', { shortcut: dailyShortcut })"
    >
      <div class="flex w-full flex-col gap-2">
        <Input v-model="dailyNoteFolder" class="w-full font-mono" :placeholder="i18n.t('workspace.dailyFolder')" />
        <Input v-model="dailyNoteFormat" class="w-full font-mono" placeholder="YYYY-MM-DD" />
        <p class="text-xs text-muted-foreground">
          {{ i18n.t('workspace.dailyPreview') }} <code class="rounded bg-muted px-1">{{ dailyNotePreview }}</code>
        </p>
      </div>
    </SettingRow>
  </div>
</template>
