<script setup lang="ts">
import { Milkdown, useEditor } from '@milkdown/vue'
import { useAttachmentsStore } from '@/stores/attachments'
import { useEditorStore } from '@/stores/editor'
import { createLightEditor } from './create-editor'

const props = defineProps<{ markdown: string }>()
const attachments = useAttachmentsStore()
const editor = useEditorStore()
const notePath = editor.activePath ?? ''

useEditor((root) => createLightEditor({
  root,
  defaultValue: props.markdown,
  editable: () => false,
  attachments: {
    save: (data, mime, name) => attachments.save(data, mime, notePath, name),
    resolve: (src) => attachments.resolve(src, notePath),
    release: (url) => attachments.release(url),
  },
}))
</script>

<template>
  <Milkdown />
</template>
