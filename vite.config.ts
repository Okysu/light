import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Tauri 开发时通过 TAURI_DEV_HOST 指定局域网地址（移动端调试用）
const host = process.env.TAURI_DEV_HOST

/**
 * PWA 只服务网页模式（9.2）。客户端跑的是本地文件，Service Worker 既没有意义，
 * 还会把 Tauri 的 IPC 请求卷进缓存策略里，因此打客户端包时整体关掉。
 */
const isTauriBuild = Boolean(process.env.TAURI_ENV_PLATFORM)

// 版本号只在 package.json 里维护一份，关于页读注入的常量
const { version } = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      disable: isTauriBuild,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'Light — 本地优先的轻量知识库',
        short_name: 'Light',
        description: '离线可用的 Markdown 知识库，数据存在你自己的设备上',
        lang: 'zh-CN',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 编辑器分包后单文件超过默认 2 MiB 上限，不放宽会被静默排除在预缓存之外，
        // 结果就是「装得上但离线打不开笔记」
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // 开发时不注册 SW：缓存会让改动看起来「没生效」，排查成本远大于收益
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri 要求固定端口，且失败时不自动切换，否则客户端窗口连不上
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 5174 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
