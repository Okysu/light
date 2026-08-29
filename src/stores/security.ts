import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { flattenTree } from '@/core/workspace/tree'
import {
  createAppLockConfig, decryptProtectedText, deriveAppKey, encryptProtectedText,
  isProtectedText, randomSalt, saltOf, setActiveLocalVaultKey, type AppLockConfig,
} from '@/core/security/local-vault'
import { useWorkspaceStore } from './workspace'
import { useEditorStore } from './editor'

const CONFIG_KEY = 'light:app-lock:v1'

function readConfig(): AppLockConfig | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null') as Partial<AppLockConfig> | null
    if (!parsed || parsed.version !== 1 || typeof parsed.salt !== 'string' || typeof parsed.verifier !== 'string') return null
    return {
      version: 1,
      salt: parsed.salt,
      verifier: parsed.verifier,
      iterations: Number.isFinite(parsed.iterations) ? parsed.iterations! : 310_000,
      autoLockMinutes: Number.isFinite(parsed.autoLockMinutes) ? Math.max(0, parsed.autoLockMinutes!) : 15,
    }
  } catch { return null }
}

function sameVerifier(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}

export const useSecurityStore = defineStore('security', () => {
  const workspace = useWorkspaceStore()
  const editor = useEditorStore()
  const config = ref<AppLockConfig | null>(readConfig())
  const locked = ref(config.value !== null)
  const busy = ref(false)
  const error = ref('')
  const configured = computed(() => config.value !== null)
  let timer: ReturnType<typeof setTimeout> | null = null

  function persist(next: AppLockConfig | null): void {
    config.value = next
    if (next) localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
    else localStorage.removeItem(CONFIG_KEY)
  }

  function armAutoLock(): void {
    if (timer) clearTimeout(timer)
    timer = null
    const minutes = config.value?.autoLockMinutes ?? 0
    if (!locked.value && minutes > 0) timer = setTimeout(() => void lock(), minutes * 60_000)
  }

  function recordActivity(): void {
    if (configured.value && !locked.value) armAutoLock()
  }

  async function setup(password: string): Promise<void> {
    if (password.length < 8) throw new Error('应用锁密码至少需要 8 个字符')
    busy.value = true
    try {
      const salt = randomSalt()
      const derived = await deriveAppKey(password, salt)
      const next = createAppLockConfig(salt, derived.verifier)
      persist(next)
      setActiveLocalVaultKey(derived.key)
      locked.value = false
      error.value = ''
      armAutoLock()
    } finally { busy.value = false }
  }

  async function unlock(password: string): Promise<boolean> {
    const current = config.value
    if (!current) return true
    busy.value = true
    try {
      const derived = await deriveAppKey(password, saltOf(current), current.iterations)
      if (!sameVerifier(derived.verifier, current.verifier)) {
        error.value = '密码不正确'
        return false
      }
      setActiveLocalVaultKey(derived.key)
      locked.value = false
      error.value = ''
      armAutoLock()
      return true
    } finally { busy.value = false }
  }

  async function lock(): Promise<void> {
    if (!configured.value) return
    if (timer) clearTimeout(timer)
    timer = null
    await editor.flush()
    setActiveLocalVaultKey(null)
    locked.value = true
    await editor.close()
    // 派生索引可能保留解锁期间解析出的敏感正文；锁定时一并从内存清掉。
    const [{ useSearchStore }, { useLinksStore }, { useCollectionsStore }, { useAiStore }] = await Promise.all([
      import('./search'), import('./links'), import('./collections'), import('./ai'),
    ])
    useSearchStore().invalidate()
    useLinksStore().invalidate()
    useCollectionsStore().invalidate()
    useAiStore().reset()
  }

  async function setAutoLockMinutes(minutes: number): Promise<void> {
    if (!config.value) return
    persist({ ...config.value, autoLockMinutes: Math.max(0, Math.round(minutes)) })
    armAutoLock()
  }

  async function setSensitive(path: string, sensitive: boolean): Promise<void> {
    const storage = workspace.storage
    if (!storage) throw new Error('数据目录尚未就绪')
    if (!configured.value || locked.value) throw new Error('请先启用并解锁应用锁')
    const raw = await storage.readText(path)
    const note = await workspace.notes!.read(path)
    if (sensitive && !isProtectedText(raw)) {
      await workspace.history?.setProtection(note.id, true, { path, title: note.title })
      await storage.writeText(path, await encryptProtectedText(raw))
    }
    if (!sensitive && isProtectedText(raw)) {
      await storage.writeText(path, await decryptProtectedText(raw))
      await workspace.history?.setProtection(note.id, false, { path, title: note.title })
    }
  }

  async function isSensitive(path: string | null): Promise<boolean> {
    if (!path || !workspace.storage) return false
    try { return isProtectedText(await workspace.storage.readText(path)) } catch { return false }
  }

  async function disable(password: string): Promise<boolean> {
    if (!(await unlock(password))) return false
    if (!workspace.storage) return false
    busy.value = true
    try {
      const notes = flattenTree(workspace.tree).filter((node) => node.kind === 'note')
      for (const note of notes) await setSensitive(note.path, false)
      persist(null)
      setActiveLocalVaultKey(null)
      locked.value = false
      if (timer) clearTimeout(timer)
      timer = null
      return true
    } finally { busy.value = false }
  }

  return {
    config, configured, locked, busy, error,
    setup, unlock, lock, recordActivity, setAutoLockMinutes, setSensitive, isSensitive, disable,
  }
})
