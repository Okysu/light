import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { ExtensionContributions } from '@/core/extensions/contributions'
import { ExtensionDeviceStateStore, hasAllPermissions } from '@/core/extensions/device-state'
import { createExtensionHost } from '@/core/extensions/host'
import { ExtensionRepository } from '@/core/extensions/repository'
import { ExtensionSandbox } from '@/core/extensions/runtime/runtime'
import type {
  ExtensionCommand,
  ExtensionLogEntry,
  ExtensionManifest,
  ExtensionPermission,
  ExtensionRuntimeState,
  ExtensionSettingValue,
  ExtensionSlashItem,
} from '@/core/extensions/types'
import { useToastStore } from './toast'
import { useWorkspaceStore } from './workspace'
import { useEditorStore } from './editor'
import { useI18nStore } from './i18n'
import { useThemeStore } from './theme'

const MAX_LOGS = 100

export const useExtensionsStore = defineStore('extensions', () => {
  const workspace = useWorkspaceStore()
  const toast = useToastStore()
  const editor = useEditorStore()
  const i18n = useI18nStore()
  const theme = useThemeStore()
  const items = ref<ExtensionRuntimeState[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const revision = ref(0)
  const repository = shallowRef<ExtensionRepository | null>(null)
  const deviceState = shallowRef<ExtensionDeviceStateStore | null>(null)
  const contributions = new ExtensionContributions()
  const sandboxes = new Map<string, ExtensionSandbox>()
  const secretValues = new Map<string, string>()
  let initialized = false

  const commands = computed<ExtensionCommand[]>(() => {
    void revision.value
    return contributions.commands()
  })
  const slashItems = computed<ExtensionSlashItem[]>(() => {
    void revision.value
    return contributions.slashItems()
  })

  function initialize(): void {
    if (initialized) return
    initialized = true
    workspace.onBeforeOpen(stopAll)
    workspace.onOpened(load)
    watch(() => editor.activePath, (path) => {
      if (path) broadcast('document.opened', { path, kind: editor.activeKind }, 'document:read')
    })
    watch(() => editor.lastSavedAt, (savedAt, previous) => {
      if (savedAt && savedAt !== previous && editor.activePath) {
        broadcast('document.saved', { path: editor.activePath, savedAt }, 'document:read')
      }
    })
    watch(() => i18n.locale, (locale) => broadcast('locale.changed', { locale }))
    watch(() => theme.isDark, (dark) => broadcast('theme.changed', { theme: dark ? 'dark' : 'light' }))
  }

  async function load(): Promise<void> {
    stopAll()
    secretValues.clear()
    if (!workspace.storage) {
      items.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      repository.value = new ExtensionRepository(workspace.storage)
      deviceState.value = new ExtensionDeviceStateStore(workspaceKey())
      const installed = await repository.value.list()
      items.value = installed.map((extension) => {
        const device = deviceState.value!.read(extension.manifest.id, extension.sourceHash)
        return {
          extension,
          device,
          status: !device.enabled
            ? 'disabled'
            : hasAllPermissions(device.granted, extension.manifest.permissions)
              ? 'starting'
              : 'permission-required',
          logs: [],
        }
      })
      await Promise.all(items.value.flatMap((item) => Object.entries(item.extension.manifest.settings ?? {})
        .filter(([, definition]) => definition.type === 'secret')
        .map(async ([key]) => {
          secretValues.set(secretCacheKey(item.extension.manifest.id, key), await deviceState.value!.readSecret(item.extension.manifest.id, key))
        })))
      await Promise.all(items.value.filter((item) => item.status === 'starting').map((item) => start(item)))
      broadcast('workspace.opened', { runtime: workspace.runtime })
    } catch (cause) {
      error.value = messageOf(cause)
    } finally {
      loading.value = false
    }
  }

  async function install(manifest: ExtensionManifest, source: string): Promise<void> {
    const repo = requireRepository()
    await stop(manifest.id)
    await repo.install(manifest, source)
    await load()
  }

  async function uninstall(id: string): Promise<void> {
    await stop(id)
    await requireRepository().remove(id)
    deviceState.value?.remove(id)
    items.value = items.value.filter((item) => item.extension.manifest.id !== id)
    touchContributions()
  }

  async function approveAndEnable(id: string): Promise<void> {
    const item = requireItem(id)
    item.device.granted = [...item.extension.manifest.permissions]
    item.device.enabled = true
    item.device.sourceHash = item.extension.sourceHash
    item.device.lastError = null
    item.device.crashCount = 0
    persist(item)
    await start(item)
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    const item = requireItem(id)
    if (!enabled) {
      item.device.enabled = false
      persist(item)
      await stop(id)
      item.status = 'disabled'
      return
    }
    if (!hasAllPermissions(item.device.granted, item.extension.manifest.permissions)) {
      item.status = 'permission-required'
      return
    }
    item.device.enabled = true
    persist(item)
    await start(item)
  }

  async function revokePermissions(id: string): Promise<void> {
    const item = requireItem(id)
    await stop(id)
    item.device.enabled = false
    item.device.granted = []
    item.status = 'permission-required'
    persist(item)
  }

  async function updateSetting(id: string, key: string, value: ExtensionSettingValue): Promise<void> {
    const item = requireItem(id)
    const definition = item.extension.manifest.settings?.[key]
    if (!definition) throw new Error(`未声明的设置项：${key}`)
    if (definition.type === 'secret') {
      await requireDeviceState().writeSecret(id, key, String(value ?? ''))
      secretValues.set(secretCacheKey(id, key), String(value ?? ''))
    } else {
      item.extension.settings[key] = value
      await requireRepository().saveSettings(item.extension, item.extension.settings)
    }
    revision.value += 1
    sandboxes.get(id)?.emit('settings.changed', { key, value })
  }

  function settingValue(id: string, key: string): ExtensionSettingValue {
    const item = requireItem(id)
    const definition = item.extension.manifest.settings?.[key]
    if (!definition) return null
    return definition.type === 'secret'
      ? secretValues.get(secretCacheKey(id, key)) ?? ''
      : item.extension.settings[key] ?? definition.default ?? null
  }

  async function invoke(extensionId: string, command: string, args: unknown = null): Promise<unknown> {
    const item = requireItem(extensionId)
    if (item.status !== 'active') throw new Error(`扩展“${item.extension.manifest.name}”没有运行`)
    const sandbox = sandboxes.get(extensionId)
    if (!sandbox) throw new Error('扩展运行环境不可用')
    try {
      return await sandbox.invoke(command, args)
    } catch (cause) {
      log(item, 'error', messageOf(cause))
      toast.error(`${item.extension.manifest.name}：${messageOf(cause)}`)
      throw cause
    }
  }

  async function start(item: ExtensionRuntimeState): Promise<void> {
    const id = item.extension.manifest.id
    await stop(id)
    if (!item.device.enabled) {
      item.status = 'disabled'
      return
    }
    if (!hasAllPermissions(item.device.granted, item.extension.manifest.permissions)) {
      item.status = 'permission-required'
      return
    }
    item.status = 'starting'
    item.device.lastError = null
    const host = createExtensionHost({
      extension: item.extension,
      device: item.device,
      repository: requireRepository(),
      deviceState: requireDeviceState(),
      onSettingChanged: (key, value) => {
        item.extension.settings[key] = value
        revision.value += 1
      },
    })
    const sandbox = new ExtensionSandbox(
      host,
      (level, message) => log(item, level, message),
      (cause) => crash(item, cause),
    )
    sandboxes.set(id, sandbox)
    try {
      await sandbox.activate(id, item.extension.source)
      if (sandboxes.get(id) !== sandbox) return
      item.status = 'active'
      item.device.crashCount = 0
      persist(item)
      contributions.register(item.extension)
      touchContributions()
      log(item, 'info', '扩展已启动')
    } catch (cause) {
      sandbox.dispose()
      sandboxes.delete(id)
      crash(item, cause instanceof Error ? cause : new Error(messageOf(cause)))
    }
  }

  async function stop(id: string): Promise<void> {
    sandboxes.get(id)?.dispose()
    sandboxes.delete(id)
    contributions.unregister(id)
    touchContributions()
  }

  function stopAll(): void {
    for (const sandbox of sandboxes.values()) sandbox.dispose()
    sandboxes.clear()
    contributions.clear()
    touchContributions()
  }

  function broadcast(name: string, payload: unknown, permission?: ExtensionPermission): void {
    for (const item of items.value) {
      if (item.status !== 'active' || (permission && !item.device.granted.includes(permission))) continue
      sandboxes.get(item.extension.manifest.id)?.emit(name, payload)
    }
  }

  function crash(item: ExtensionRuntimeState, cause: Error): void {
    const id = item.extension.manifest.id
    sandboxes.get(id)?.dispose()
    sandboxes.delete(id)
    contributions.unregister(id)
    item.status = 'error'
    item.device.lastError = cause.message
    item.device.crashCount += 1
    if (item.device.crashCount >= 3) item.device.enabled = false
    persist(item)
    log(item, 'error', cause.message)
    touchContributions()
  }

  function log(item: ExtensionRuntimeState, level: ExtensionLogEntry['level'], message: string): void {
    item.logs = [...item.logs.slice(-(MAX_LOGS - 1)), { at: Date.now(), level, message }]
  }

  function persist(item: ExtensionRuntimeState): void {
    requireDeviceState().write(item.extension.manifest.id, { ...item.device })
  }

  function touchContributions(): void {
    revision.value += 1
  }

  function requireItem(id: string): ExtensionRuntimeState {
    const item = items.value.find((candidate) => candidate.extension.manifest.id === id)
    if (!item) throw new Error(`扩展不存在：${id}`)
    return item
  }

  function requireRepository(): ExtensionRepository {
    if (!repository.value) throw new Error('尚未打开工作区')
    return repository.value
  }

  function requireDeviceState(): ExtensionDeviceStateStore {
    if (!deviceState.value) throw new Error('扩展设备状态尚未就绪')
    return deviceState.value
  }

  function workspaceKey(): string {
    return JSON.stringify(workspace.location ?? { kind: workspace.runtime })
  }

  function secretCacheKey(extensionId: string, key: string): string {
    return `${extensionId}\0${key}`
  }

  return {
    items,
    loading,
    error,
    commands,
    slashItems,
    initialize,
    load,
    install,
    uninstall,
    approveAndEnable,
    setEnabled,
    revokePermissions,
    updateSetting,
    settingValue,
    invoke,
    stopAll,
  }
})

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function permissionLabels(permission: ExtensionPermission): { zh: string; en: string } {
  const labels: Record<ExtensionPermission, { zh: string; en: string }> = {
    'workspace:read': { zh: '读取工作区文件', en: 'Read workspace files' },
    'workspace:write': { zh: '创建和修改工作区文件', en: 'Create and modify workspace files' },
    'workspace:delete': { zh: '将工作区文件移入回收站', en: 'Move workspace files to trash' },
    'document:read': { zh: '读取当前文档与选区', en: 'Read the active document and selection' },
    'document:write': { zh: '修改当前文档与选区', en: 'Modify the active document and selection' },
    'ai:invoke': { zh: '调用用户配置的 AI 服务', en: 'Use the configured AI provider' },
  }
  return labels[permission]
}
