<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import { tagPathSegments } from '@/core/tags/hierarchy'

defineProps<{ value: string }>()
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-0.5" :title="value">
    <template v-for="(segment, index) in tagPathSegments(value)" :key="`${index}:${segment}`">
      <ChevronRight v-if="index > 0" class="size-3 shrink-0 text-muted-foreground/70" />
      <span class="truncate">{{ segment }}</span>
    </template>
  </span>
</template>
