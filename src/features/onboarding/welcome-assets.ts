import type { StorageAdapter } from '@/core/storage'
import editorUrl from './assets/editor.png?url'
import searchUrl from './assets/search.png?url'
import settingsUrl from './assets/settings.png?url'

const ASSETS = [
  { path: 'attachments/welcome/editor.png', url: editorUrl },
  { path: 'attachments/welcome/search.png', url: searchUrl },
  { path: 'attachments/welcome/settings.png', url: settingsUrl },
] as const

/** 把随应用打包的真实界面截图复制进用户自己的附件目录，欢迎笔记因此完全离线可读。 */
export async function installWelcomeAssets(storage: StorageAdapter): Promise<void> {
  await Promise.all(ASSETS.map(async ({ path, url }) => {
    if (await storage.exists(path)) return
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Unable to load bundled welcome asset: ${path}`)
    await storage.writeBinary(path, new Uint8Array(await response.arrayBuffer()))
  }))
}
