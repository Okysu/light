<script setup lang="ts">
import { FileText, Image as ImageIcon, ScanText, Trash2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { buildAttachmentIndex, type AttachmentIndex } from '@/core/attachments/attachment-index'
import { isImageMime } from '@/core/attachments/attachment'
import { parseDocument } from '@/core/markdown/frontmatter'
import { stem } from '@/core/path'
import { flattenTree } from '@/core/workspace/tree'
import { ATTACHMENTS_DIR } from '@/core/workspace/types'
import { useConfirm } from '@/composables/use-confirm'
import { useAiStore } from '@/stores/ai'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18nStore } from '@/stores/i18n'

/**
 * 附件管理面板（需求 7.1 / 7.2）。
 *
 * 引用关系每次打开都重新扫——它必须与磁盘一致。缓存下来的话会出现
 * 「面板说没人用了，其实还有一篇在引用」，而按提示删掉就意味着某篇笔记的图裂掉。
 */

const ui = useUiStore()
const workspace = useWorkspaceStore()
const editor = useEditorStore()
const ai = useAiStore()
const i18n = useI18nStore()
const { confirm } = useConfirm()

const index = ref<AttachmentIndex>({ items: [], orphans: [] })
const scanning = ref(false)

/** 正在识别的图片路径与结果（6.3）。一次只处理一张，与 AI store 的单请求约束一致 */
const readingPath = ref<string | null>(null)
const readResult = ref<{ path: string; text: string } | null>(null)

/**
 * 提取图片里的文字。
 *
 * 结果只展示、只提供复制，不自动插进任何笔记——这张图可能被好几篇引用，
 * 「插到哪一篇」没有正确答案，替用户猜一个只会猜错。
 */
async function readImage(path: string): Promise<void> {
  readingPath.value = path
  readResult.value = null
  try {
    const bytes = await workspace.storage!.readBinary(path)
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    const text = await ai.describeImage(bytes, `image/${extension === 'jpg' ? 'jpeg' : extension}`, 'ocr')
    readResult.value = { path, text: text.trim() }
  } catch (cause) {
    readResult.value = { path, text: cause instanceof Error ? cause.message : String(cause) }
  } finally {
    readingPath.value = null
  }
}

async function copyResult(): Promise<void> {
  if (readResult.value?.text) await navigator.clipboard.writeText(readResult.value.text)
}
const showOnlyOrphans = ref(false)

watch(
  () => ui.attachmentsOpen,
  (open) => {
    if (open) void scan()
  },
)

async function scan(): Promise<void> {
  const storage = workspace.storage
  if (!storage) return

  scanning.value = true
  try {
    const nodes = flattenTree(workspace.tree)
    const notes = nodes.filter((node) => node.kind === 'note')

    const sources = []
    for (const note of notes) {
      try {
        sources.push({ path: note.path, content: parseDocument(await storage.readText(note.path)).content })
      } catch {
        // 单篇读不出来不该让整个面板打不开
        continue
      }
    }

    const attachments = await listAttachments()
    index.value = buildAttachmentIndex(sources, attachments)
  } finally {
    scanning.value = false
  }
}

/** 递归列出附件目录下的全部文件 */
async function listAttachments(): Promise<string[]> {
  const storage = workspace.storage
  const root = ATTACHMENTS_DIR
  if (!storage) return []

  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await storage.list(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory) await walk(entry.path)
      else found.push(entry.path)
    }
  }

  await walk(root)
  return found
}

const visible = computed(() =>
  showOnlyOrphans.value ? index.value.items.filter((item) => item.usedBy.length === 0) : index.value.items,
)

const totalSize = computed(() => index.value.items.length)

function isImage(path: string): boolean {
  const at = path.lastIndexOf('.')
  return at !== -1 && isImageMime(`image/${path.slice(at + 1).toLowerCase()}`)
}

async function openNote(path: string): Promise<void> {
  ui.attachmentsOpen = false
  await editor.openNote(path)
}

async function remove(path: string): Promise<void> {
  const ok = await confirm({
    title: i18n.t('attachments.deleteConfirmTitle'),
    description: i18n.t('attachments.deleteConfirmDescription', { name: stem(path) }),
    confirmLabel: i18n.t('common.delete'),
    danger: true,
  })
  if (!ok || !workspace.storage) return

  await workspace.storage.remove(path)
  await scan()
}

/** 一次性清理全部孤立附件（7.2） */
async function removeAllOrphans(): Promise<void> {
  const orphans = index.value.orphans
  const ok = await confirm({
    title: i18n.t('attachments.cleanupConfirmTitle'),
    description: i18n.t('attachments.cleanupConfirmDescription', { count: orphans.length }),
    confirmLabel: i18n.t('common.delete'),
    danger: true,
  })
  if (!ok || !workspace.storage) return

  for (const path of orphans) {
    await workspace.storage.remove(path).catch(() => undefined)
  }
  await scan()
}
</script>

<template>
  <Dialog
    v-model:open="ui.attachmentsOpen"
    :title="i18n.t('attachments.title')"
    :description="i18n.t('attachments.description')"
    class="h-[80vh] w-[44rem] max-w-[94vw]"
  >
    <div class="flex shrink-0 items-center gap-3 border-y border-border px-5 py-2">
      <span class="text-xs text-muted-foreground">
        {{ i18n.t('attachments.summary', { total: totalSize, orphans: index.orphans.length }) }}
      </span>

      <Button
        size="sm"
        :variant="showOnlyOrphans ? 'default' : 'ghost'"
        :disabled="index.orphans.length === 0"
        @click="showOnlyOrphans = !showOnlyOrphans"
      >
        {{ i18n.t('attachments.onlyOrphans') }}
      </Button>

      <Button
        v-if="index.orphans.length > 0"
        class="ml-auto"
        size="sm"
        variant="ghost"
        @click="removeAllOrphans"
      >
        <Trash2 />
        {{ i18n.t('attachments.cleanOrphans') }}
      </Button>
    </div>

    <ScrollArea class="min-h-0 flex-1" viewport-class="px-5 py-3">
      <p v-if="scanning" class="py-8 text-center text-sm text-muted-foreground">{{ i18n.t('attachments.scanning') }}</p>

      <p v-else-if="visible.length === 0" class="py-8 text-center text-sm text-muted-foreground">
        {{ i18n.t(showOnlyOrphans ? 'attachments.noOrphans' : 'attachments.empty') }}
      </p>

      <ul v-else class="space-y-1.5">
        <li
          v-for="item in visible"
          :key="item.path"
          class="flex items-center gap-3 rounded-md border border-border px-3 py-2"
        >
          <ImageIcon v-if="isImage(item.path)" class="size-4 shrink-0 text-muted-foreground" />
          <FileText v-else class="size-4 shrink-0 text-muted-foreground" />

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">{{ stem(item.path) }}</p>
            <p class="truncate text-xs text-muted-foreground">{{ item.path }}</p>
          </div>

          <!-- 引用来源（7.1）：可点，直接跳到那篇笔记 -->
          <div class="flex shrink-0 items-center gap-1">
            <template v-if="item.usedBy.length > 0">
              <Button
                v-for="note in item.usedBy.slice(0, 2)"
                :key="note"
                size="sm"
                variant="ghost"
                class="max-w-32 truncate text-xs"
                @click="openNote(note)"
              >
                {{ stem(note) }}
              </Button>
              <span v-if="item.usedBy.length > 2" class="text-xs text-muted-foreground">
                +{{ item.usedBy.length - 2 }}
              </span>
            </template>
            <span v-else class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {{ i18n.t('attachments.orphan') }}
            </span>
          </div>

          <!-- OCR（6.3）：只在开了 AI 且是图片时出现，免得摆一个点了报错的按钮 -->
          <Button
            v-if="ai.ready && isImage(item.path)"
            size="icon-sm"
            variant="ghost"
            :disabled="readingPath !== null"
            :title="i18n.t('attachments.ocr')"
            @click="readImage(item.path)"
          >
            <ScanText />
          </Button>

          <Button size="icon-sm" variant="ghost" :title="i18n.t('attachments.delete')" @click="remove(item.path)">
            <Trash2 />
          </Button>
        </li>

        <li v-if="readingPath || readResult" class="rounded-md border border-border bg-muted/40 px-3 py-2">
          <p class="mb-1 text-xs text-muted-foreground">
            {{ readingPath ? i18n.t('attachments.recognizing', { name: stem(readingPath) }) : i18n.t('attachments.ocrResult', { name: stem(readResult!.path) }) }}
          </p>
          <p v-if="readResult" class="whitespace-pre-wrap break-words text-sm">{{ readResult.text || i18n.t('attachments.noText') }}</p>
          <Button
            v-if="readResult?.text"
            size="sm"
            variant="ghost"
            class="mt-1"
            @click="copyResult"
          >
            {{ i18n.t('attachments.copy') }}
          </Button>
        </li>
      </ul>
    </ScrollArea>
  </Dialog>
</template>
