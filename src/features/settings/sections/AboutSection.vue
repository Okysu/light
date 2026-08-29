<script setup lang="ts">
import { FileText, HardDrive, Monitor, Package } from 'lucide-vue-next'
import { computed } from 'vue'
import { Separator } from '@/components/ui/separator'
import { useLinksStore } from '@/stores/links'
import { useSearchStore } from '@/stores/search'
import { useWorkspaceStore } from '@/stores/workspace'
import { flattenTree } from '@/core/workspace/tree'
import { useI18nStore } from '@/stores/i18n'

const workspace = useWorkspaceStore()
const search = useSearchStore()
const links = useLinksStore()
const i18n = useI18nStore()

/** 由 Vite 在构建时注入，避免把版本号写死在两个地方 */
const version = __APP_VERSION__

const isDesktop = computed(() => workspace.runtime === 'desktop')

/**
 * 数据到底存在哪——「本地优先」的承诺必须看得见。
 * 网页版存在 OPFS 里，用户拿不到路径，就如实说明它是浏览器的私有区域，
 * 而不是含糊地写「本地」让人以为能在文件管理器里找到。
 */
const dataLocation = computed(() => {
  const location = workspace.location
  if (!location) return { path: i18n.t('about.notReady'), note: '' }

  switch (location.kind) {
    case 'tauri-fs':
      return { path: location.path, note: i18n.t('about.diskNote') }
    case 'opfs':
      return {
        path: i18n.t('about.opfsPath', { dir: location.dir }),
        note: i18n.t('about.opfsNote'),
      }
    case 'memory':
      return { path: i18n.t('about.memory'), note: i18n.t('about.memoryNote') }
  }
})

const noteCount = computed(() => flattenTree(workspace.tree).filter((node) => node.kind === 'note').length)

/**
 * 索引与链接图都是懒建的——用到时才扫全库。
 * 因此「尚未建立」是正常状态而不是故障，文案要把这层说清楚，
 * 否则用户看到「未建立」会以为出了问题。
 */
const stats = computed(() => [
  { icon: FileText, label: i18n.t('about.notes'), value: i18n.t('about.items', { count: noteCount.value }) },
  { icon: Package, label: i18n.t('about.searchIndex'), value: search.indexedCount > 0 ? i18n.t('about.items', { count: search.indexedCount }) : i18n.t('about.lazy') },
  { icon: HardDrive, label: i18n.t('about.linkGraph'), value: links.indexedCount > 0 ? i18n.t('about.items', { count: links.indexedCount }) : i18n.t('about.lazy') },
])
</script>

<template>
  <div class="space-y-6">
    <!-- 应用标识：设置面板里唯一适合放品牌的地方 -->
    <div class="flex items-center gap-3">
      <img src="/pwa-192x192.png" alt="Light" class="size-11 shrink-0 rounded-lg" />
      <div class="min-w-0">
        <p class="text-base font-semibold">Light</p>
        <p class="text-xs text-muted-foreground">{{ i18n.t('about.tagline') }}</p>
      </div>
      <span class="ml-auto shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
        v{{ version }}
      </span>
    </div>

    <Separator />

    <div class="space-y-3">
      <div class="flex items-center gap-2 text-sm">
        <Monitor class="size-4 shrink-0 text-muted-foreground" />
        <span class="text-muted-foreground">{{ i18n.t('about.runtime') }}</span>
        <span class="ml-auto">{{ isDesktop ? i18n.t('about.desktop') : i18n.t('about.web') }}</span>
      </div>

      <div v-for="item in stats" :key="item.label" class="flex items-center gap-2 text-sm">
        <component :is="item.icon" class="size-4 shrink-0 text-muted-foreground" />
        <span class="text-muted-foreground">{{ item.label }}</span>
        <span class="ml-auto">{{ item.value }}</span>
      </div>
    </div>

    <Separator />

    <div class="space-y-2">
      <div class="space-y-0.5">
        <h3 class="text-sm font-medium">{{ i18n.t('about.dataLocation') }}</h3>
        <p class="text-xs leading-relaxed text-muted-foreground">
          {{ i18n.t('about.portable') }}
        </p>
      </div>

      <div class="rounded-md border border-border bg-muted/40 p-3">
        <p class="break-all font-mono text-xs leading-relaxed">{{ dataLocation.path }}</p>
        <p v-if="dataLocation.note" class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {{ dataLocation.note }}
        </p>
      </div>
    </div>
  </div>
</template>
