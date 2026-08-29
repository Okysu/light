import { APP_VERSION } from '@/core/app-metadata'
import { SearchService } from '@/core/search/search-service'
import type { ExtensionRepository } from './repository'
import type { ExtensionDeviceStateStore } from './device-state'
import type {
  ExtensionDeviceState,
  ExtensionHostRequest,
  ExtensionSettingValue,
  InstalledExtension,
} from './types'
import { useAiStore } from '@/stores/ai'
import { useEditorStore } from '@/stores/editor'
import { useI18nStore } from '@/stores/i18n'
import { useThemeStore } from '@/stores/theme'
import { useToastStore, type ToastKind } from '@/stores/toast'
import { useWorkspaceStore } from '@/stores/workspace'

interface ExtensionHostOptions {
  extension: InstalledExtension
  device: ExtensionDeviceState
  repository: ExtensionRepository
  deviceState: ExtensionDeviceStateStore
  onSettingChanged: (key: string, value: ExtensionSettingValue) => void
}

const METHOD_PERMISSIONS: Record<string, ExtensionDeviceState['granted'][number] | undefined> = {
  'workspace.list': 'workspace:read',
  'workspace.readText': 'workspace:read',
  'workspace.search': 'workspace:read',
  'workspace.writeText': 'workspace:write',
  'workspace.trash': 'workspace:delete',
  'document.getActive': 'document:read',
  'document.getText': 'document:read',
  'document.getSelection': 'document:read',
  'document.replaceSelection': 'document:write',
  'document.insertAfterSelection': 'document:write',
  'ai.complete': 'ai:invoke',
}

export function createExtensionHost(options: ExtensionHostOptions) {
  const workspace = useWorkspaceStore()
  const editor = useEditorStore()
  const ai = useAiStore()
  const toast = useToastStore()
  const i18n = useI18nStore()
  const theme = useThemeStore()
  let search: SearchService | null = null

  return async (method: string, args: unknown): Promise<unknown> => {
    const required = METHOD_PERMISSIONS[method]
    if (required && !options.device.granted.includes(required)) {
      throw new Error(`扩展没有 ${required} 权限`)
    }
    const request: ExtensionHostRequest = { method, args }
    const value = objectArgs(request.args)

    switch (method) {
      case 'app.getContext':
        return {
          version: APP_VERSION,
          platform: workspace.runtime,
          locale: i18n.locale,
          theme: theme.isDark ? 'dark' : 'light',
        }
      case 'settings.get':
        return settingValue(options, stringArg(value, 'key', 64))
      case 'settings.set': {
        const key = stringArg(value, 'key', 64)
        const next = validateSetting(options.extension, key, value.value)
        if (options.extension.manifest.settings?.[key]?.type === 'secret') {
          await options.deviceState.writeSecret(options.extension.manifest.id, key, String(next ?? ''))
        } else {
          options.extension.settings[key] = next
          await options.repository.saveSettings(options.extension, options.extension.settings)
        }
        options.onSettingChanged(key, next)
        return null
      }
      case 'storage.get': {
        const key = storageKey(value)
        return (await options.repository.readData(options.extension.manifest.id))[key] ?? null
      }
      case 'storage.set': {
        const key = storageKey(value)
        assertJsonValue(value.value)
        const data = await options.repository.readData(options.extension.manifest.id)
        data[key] = value.value
        const serialized = JSON.stringify(data)
        if (serialized.length > 512 * 1024) throw new Error('扩展存储不能超过 512 KiB')
        await options.repository.writeData(options.extension.manifest.id, data)
        return null
      }
      case 'ui.showToast': {
        const message = stringArg(value, 'message', 500)
        const kind = value.type === 'error' || value.type === 'success' ? value.type : 'info'
        toast.show(message, kind as ToastKind)
        return null
      }
      case 'workspace.list': {
        const storage = requireStorage(workspace.storage)
        const path = safeExtensionWorkspacePath(value.path, true)
        return (await storage.list(path)).map((entry) => ({
          path: entry.path,
          name: entry.name,
          directory: entry.isDirectory,
        }))
      }
      case 'workspace.readText':
        return requireStorage(workspace.storage).readText(safeExtensionWorkspacePath(value.path))
      case 'workspace.writeText': {
        const path = safeExtensionWorkspacePath(value.path)
        const contents = stringArg(value, 'contents', 2_000_000, true)
        await requireStorage(workspace.storage).writeText(path, contents)
        await workspace.refresh()
        return null
      }
      case 'workspace.trash':
        await workspace.moveToTrash(safeExtensionWorkspacePath(value.path))
        return null
      case 'workspace.search': {
        const storage = requireStorage(workspace.storage)
        const query = stringArg(value, 'query', 500)
        if (!search) {
          search = new SearchService(storage)
          await search.build()
        }
        return search.search(query, {
          limit: numberArg(value.limit, 20, 1, 100),
          ...(value.scope ? { scope: safeExtensionWorkspacePath(value.scope, true) } : {}),
        }).map(({ path, title, kind, snippet, tags, score }) => ({ path, title, kind, snippet, tags, score }))
      }
      case 'document.getActive':
        return editor.activePath ? { path: editor.activePath, kind: editor.activeKind } : null
      case 'document.getText':
        ensureActiveDocument(editor.activePath)
        return editor.fullContent
      case 'document.getSelection':
        ensureActiveDocument(editor.activePath)
        return { text: editor.selectionBridge?.selection() ?? '' }
      case 'document.replaceSelection':
        ensureActiveDocument(editor.activePath)
        editor.selectionBridge?.replace(stringArg(value, 'markdown', 1_000_000, true))
        return null
      case 'document.insertAfterSelection':
        ensureActiveDocument(editor.activePath)
        editor.selectionBridge?.insertAfter(stringArg(value, 'markdown', 1_000_000, true))
        return null
      case 'ai.isAvailable':
        return ai.ready
      case 'ai.complete': {
        const instruction = stringArg(value, 'instruction', 10_000)
        const input = stringArg(value, 'input', 500_000, true)
        return { text: await ai.runInstruction(instruction, input) }
      }
      default:
        throw new Error(`不支持的扩展 API：${method}`)
    }
  }
}

async function settingValue(options: ExtensionHostOptions, key: string): Promise<ExtensionSettingValue> {
  const definition = options.extension.manifest.settings?.[key]
  if (!definition) throw new Error(`未声明的设置项：${key}`)
  if (definition.type === 'secret') return options.deviceState.readSecret(options.extension.manifest.id, key)
  return options.extension.settings[key] ?? definition.default ?? null
}

function validateSetting(extension: InstalledExtension, key: string, value: unknown): ExtensionSettingValue {
  const definition = extension.manifest.settings?.[key]
  if (!definition) throw new Error(`未声明的设置项：${key}`)
  if (value === null) return null
  const expected = definition.type === 'boolean' ? 'boolean' : definition.type === 'number' ? 'number' : 'string'
  if (typeof value !== expected || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new Error(`设置项 ${key} 的值类型不正确`)
  }
  if (typeof value === 'string' && value.length > 100_000) throw new Error(`设置项 ${key} 的内容过长`)
  if (definition.type === 'select' && !definition.options?.some((option) => option.value === value)) {
    throw new Error(`设置项 ${key} 的值不在候选项中`)
  }
  return value as ExtensionSettingValue
}

export function safeExtensionWorkspacePath(source: unknown, allowRoot = false): string {
  if (typeof source !== 'string') throw new Error('路径必须是字符串')
  const slash = source.replace(/\\/g, '/')
  if (slash.startsWith('/') || /^[a-zA-Z]:/.test(slash) || slash.split('/').some((segment) => segment === '..')) {
    throw new Error('路径必须位于工作区内')
  }
  const path = slash.split('/').filter((segment) => segment && segment !== '.').join('/')
  if (!path && allowRoot) return ''
  if (!path) throw new Error('路径不能为空')
  const root = path.split('/')[0]
  if (root === '.light' || root === '.light-sync' || root === '.git' || root === 'node_modules') {
    throw new Error('扩展不能直接访问 Light 内部目录')
  }
  return path
}

function storageKey(args: Record<string, unknown>): string {
  const key = stringArg(args, 'key', 100)
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) throw new Error('存储键只能包含字母、数字、点、横线和下划线')
  return key
}

function assertJsonValue(value: unknown): void {
  try {
    const source = JSON.stringify(value)
    if (source === undefined) throw new Error()
  } catch {
    throw new Error('扩展存储只接受 JSON 数据')
  }
}

function objectArgs(source: unknown): Record<string, unknown> {
  return source && typeof source === 'object' && !Array.isArray(source) ? source as Record<string, unknown> : {}
}

function stringArg(args: Record<string, unknown>, key: string, max: number, allowEmpty = false): string {
  const value = args[key]
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new Error(`${key} 必须是${allowEmpty ? '' : '非空'}字符串且不超过 ${max} 字符`)
  }
  return value
}

function numberArg(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function requireStorage<T>(storage: T | null): T {
  if (!storage) throw new Error('尚未打开工作区')
  return storage
}

function ensureActiveDocument(path: string | null): asserts path is string {
  if (!path) throw new Error('当前没有打开的文档')
}
