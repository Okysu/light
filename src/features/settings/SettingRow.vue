<script setup lang="ts">
/**
 * 设置项的统一排布：标签 + 说明在上，控件在下。
 *
 * 抽出来是因为设置页会越来越多（同步、AI、快捷键都在规划里），
 * 每页各写一遍标题与说明的样式，迟早会长歪成几套不一致的间距。
 */
defineProps<{
  label: string
  description?: string
}>()
</script>

<template>
  <section class="space-y-2">
    <div class="space-y-0.5">
      <h3 class="text-sm font-medium">{{ label }}</h3>
      <p v-if="description" class="text-xs leading-relaxed text-muted-foreground">{{ description }}</p>
    </div>
    <slot />
  </section>
</template>
