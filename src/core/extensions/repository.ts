import { joinPath } from '@/core/path'
import { StorageError, type StorageAdapter } from '@/core/storage'
import { parseExtensionManifest } from './manifest'
import {
  EXTENSION_ENTRY,
  EXTENSION_MANIFEST,
  EXTENSIONS_DIR,
  type ExtensionManifest,
  type ExtensionSettingValue,
  type InstalledExtension,
} from './types'

const SETTINGS_FILE = 'settings.json'
const DATA_FILE = 'data.json'

export class ExtensionRepository {
  constructor(private readonly storage: StorageAdapter) {}

  async list(): Promise<InstalledExtension[]> {
    if (!(await this.storage.exists(EXTENSIONS_DIR))) return []
    const entries = await this.storage.list(EXTENSIONS_DIR)
    const installed: InstalledExtension[] = []
    for (const entry of entries) {
      if (!entry.isDirectory) continue
      try {
        installed.push(await this.read(entry.name))
      } catch {
        // 单个损坏扩展不能阻止其余扩展和设置页启动。
      }
    }
    return installed.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))
  }

  async read(id: string): Promise<InstalledExtension> {
    const base = extensionPath(id)
    const manifest = parseExtensionManifest(JSON.parse(await this.storage.readText(joinPath(base, EXTENSION_MANIFEST))))
    if (manifest.id !== id) throw new Error(`扩展目录 ${id} 与 manifest.id 不一致`)
    const source = await this.storage.readText(joinPath(base, manifest.entry))
    const settings = await this.readSettings(manifest)
    return { manifest, source, sourceHash: await hashExtension(manifest, source), settings }
  }

  async install(manifest: ExtensionManifest, source: string): Promise<InstalledExtension> {
    const normalized = parseExtensionManifest(manifest)
    if (!source.trim()) throw new Error('扩展脚本不能为空')
    const base = extensionPath(normalized.id)
    await this.storage.mkdir(base)
    await Promise.all([
      this.storage.writeText(joinPath(base, EXTENSION_MANIFEST), JSON.stringify(normalized, null, 2)),
      this.storage.writeText(joinPath(base, EXTENSION_ENTRY), source),
    ])
    return this.read(normalized.id)
  }

  async saveSettings(extension: InstalledExtension, settings: Record<string, ExtensionSettingValue>): Promise<void> {
    const shared: Record<string, ExtensionSettingValue> = {}
    for (const [key, value] of Object.entries(settings)) {
      if (extension.manifest.settings?.[key]?.type !== 'secret') shared[key] = value
    }
    await this.storage.writeText(joinPath(extensionPath(extension.manifest.id), SETTINGS_FILE), JSON.stringify(shared, null, 2))
  }

  async readData(id: string): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await this.storage.readText(joinPath(extensionPath(id), DATA_FILE))) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }

  async writeData(id: string, data: Record<string, unknown>): Promise<void> {
    await this.storage.writeText(joinPath(extensionPath(id), DATA_FILE), JSON.stringify(data, null, 2))
  }

  async remove(id: string): Promise<void> {
    await this.storage.remove(extensionPath(id), { recursive: true })
  }

  private async readSettings(manifest: ExtensionManifest): Promise<Record<string, ExtensionSettingValue>> {
    const defaults = Object.fromEntries(
      Object.entries(manifest.settings ?? {}).map(([key, definition]) => [key, definition.default ?? null]),
    ) as Record<string, ExtensionSettingValue>
    try {
      const parsed = JSON.parse(await this.storage.readText(joinPath(extensionPath(manifest.id), SETTINGS_FILE))) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (manifest.settings?.[key] && isSettingValue(value)) defaults[key] = value
      }
      return defaults
    } catch (cause) {
      if (cause instanceof StorageError && cause.code === 'NOT_FOUND') return defaults
      return defaults
    }
  }
}

export function extensionPath(id: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) throw new Error(`无效的扩展 id：${id}`)
  return joinPath(EXTENSIONS_DIR, id)
}

export async function hashExtension(manifest: ExtensionManifest, source: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${JSON.stringify(manifest)}\0${source}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isSettingValue(value: unknown): value is ExtensionSettingValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
}
