<script setup lang="ts">
import { ref, watch } from 'vue'
import { Dialog } from '@/components/ui/dialog'
import { countWords } from '@/stores/editor'
import { kindOf } from '@/core/workspace/tree'
import { formatBytes } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18nStore } from '@/stores/i18n'

const ui = useUiStore()
const workspace = useWorkspaceStore()
const i18n = useI18nStore()

interface Details {
  path: string
  kind: string
  size: string
  created: string
  modified: string
  words: number | null
  tags: string[]
}

const details = ref<Details | null>(null)
const error = ref<string | null>(null)

const KIND_KEYS = { note: 'properties.note', board: 'properties.board', canvas: 'properties.canvas', folder: 'properties.folder' } as const

/**
 * 打开时才读取。属性不进笔记树的常驻数据结构——
 * 树只承载导航所需的最小信息，避免为了显示一次属性而在每次扫描时多做 N 次 stat。
 */
watch(
  () => ui.propertiesPath,
  async (path) => {
    details.value = null
    error.value = null
    if (!path || !workspace.storage) return

    try {
      const stat = await workspace.storage.stat(path)
      const kind = stat.isDirectory ? 'folder' : (kindOf(path) ?? 'note')

      let words: number | null = null
      let tags: string[] = []
      let created = stat.createdAt
      let modified = stat.modifiedAt

      // 笔记的时间以 frontmatter 为准：跨设备同步时它比文件系统时间更可信
      if (kind === 'note' && workspace.notes) {
        const note = await workspace.notes.read(path)
        words = countWords(note.content)
        tags = note.tags
        created = note.createdAt || created
        modified = note.updatedAt || modified
      }

      details.value = {
        path,
        kind: i18n.t(KIND_KEYS[kind as keyof typeof KIND_KEYS] ?? 'properties.note'),
        size: stat.isDirectory ? '—' : formatBytes(stat.size),
        created: formatTime(created),
        modified: formatTime(modified),
        words,
        tags,
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  },
)

function formatTime(timestamp: number | null): string {
  if (!timestamp) return i18n.t('properties.unknown')
  return new Date(timestamp).toLocaleString(i18n.locale)
}

function close(open: boolean): void {
  if (!open) ui.propertiesPath = null
}
</script>

<template>
  <Dialog :open="ui.propertiesPath !== null" :title="i18n.t('properties.title')" class="w-[min(28rem,calc(100vw-2rem))]" @update:open="close">
    <div class="px-5 pb-5 pt-3 text-sm">
      <p v-if="error" class="text-destructive">{{ error }}</p>
      <p v-else-if="!details" class="text-muted-foreground">{{ i18n.t('common.loading') }}</p>

      <dl v-else class="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2">
        <dt class="text-muted-foreground">{{ i18n.t('properties.type') }}</dt>
        <dd>{{ details.kind }}</dd>

        <dt class="text-muted-foreground">{{ i18n.t('properties.location') }}</dt>
        <dd class="break-all font-mono text-xs">{{ details.path }}</dd>

        <dt class="text-muted-foreground">{{ i18n.t('properties.size') }}</dt>
        <dd>{{ details.size }}</dd>

        <template v-if="details.words !== null">
          <dt class="text-muted-foreground">{{ i18n.t('properties.words') }}</dt>
          <dd>{{ i18n.t('properties.wordCount', { count: details.words }) }}</dd>
        </template>

        <dt class="text-muted-foreground">{{ i18n.t('properties.created') }}</dt>
        <dd>{{ details.created }}</dd>

        <dt class="text-muted-foreground">{{ i18n.t('properties.updated') }}</dt>
        <dd>{{ details.modified }}</dd>

        <template v-if="details.tags.length > 0">
          <dt class="text-muted-foreground">{{ i18n.t('properties.tags') }}</dt>
          <dd class="flex flex-wrap gap-1">
            <span v-for="tag in details.tags" :key="tag" class="rounded bg-muted px-1.5 py-0.5 text-xs">
              {{ tag }}
            </span>
          </dd>
        </template>
      </dl>
    </div>
  </Dialog>
</template>
