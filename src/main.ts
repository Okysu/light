import { createPinia } from 'pinia'
import { createApp, type Component } from 'vue'
import App from './App.vue'
import { isCaptureWindow } from './core/desktop/events'
import QuickCapture from './features/capture/QuickCapture.vue'
import './styles/main.css'

/**
 * 客户端的速记窗口与主窗口共用同一份产物，靠 URL 参数分流。
 * 两个入口文件会让 Vite 多打一份公共依赖，而速记只是个文本框，不值当。
 */
const root: Component = isCaptureWindow() ? QuickCapture : App

createApp(root).use(createPinia()).mount('#app')
