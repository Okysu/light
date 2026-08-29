import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 测试配置独立于 vite.config.ts。
 *
 * 原因：vitest 自带的 vite 版本与项目使用的 vite 版本不同，
 * 若在同一份配置里声明 `test` 字段，两套 Plugin 类型会互相不兼容而导致类型检查失败。
 * 这里只保留测试真正需要的路径别名，不引入构建插件，从根上避开该冲突。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // 编辑器测试跑在 jsdom 下，需要补齐它未实现的观察者 API
    setupFiles: ['./src/test-setup.ts'],
  },
})
