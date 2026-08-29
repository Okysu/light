import type { ExtensionDeviceState, ExtensionPermission } from './types'
import { canEncrypt, decryptSecret, encryptSecret, type EncryptedSecret } from '@/core/ai/key-store'

const STORAGE_KEY = 'light:extension-device-state'
const SECRET_KEY = 'light:extension-secrets'

type DeviceStateDocument = Record<string, Record<string, ExtensionDeviceState>>
type SecretDocument = Record<string, Record<string, Record<string, EncryptedSecret>>>

export class ExtensionDeviceStateStore {
  constructor(private readonly workspaceKey: string) {}

  read(extensionId: string, sourceHash: string): ExtensionDeviceState {
    const saved = readJson<DeviceStateDocument>(STORAGE_KEY)?.[this.workspaceKey]?.[extensionId]
    if (!saved || saved.sourceHash !== sourceHash) return defaultState(sourceHash)
    return {
      enabled: Boolean(saved.enabled),
      sourceHash,
      granted: Array.isArray(saved.granted) ? saved.granted : [],
      lastError: typeof saved.lastError === 'string' ? saved.lastError : null,
      crashCount: Number.isSafeInteger(saved.crashCount) ? saved.crashCount : 0,
    }
  }

  write(extensionId: string, state: ExtensionDeviceState): void {
    const document = readJson<DeviceStateDocument>(STORAGE_KEY) ?? {}
    document[this.workspaceKey] ??= {}
    document[this.workspaceKey]![extensionId] = state
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document))
  }

  remove(extensionId: string): void {
    const document = readJson<DeviceStateDocument>(STORAGE_KEY) ?? {}
    delete document[this.workspaceKey]?.[extensionId]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document))
    const secrets = readJson<SecretDocument>(SECRET_KEY) ?? {}
    delete secrets[this.workspaceKey]?.[extensionId]
    localStorage.setItem(SECRET_KEY, JSON.stringify(secrets))
  }

  async readSecret(extensionId: string, key: string): Promise<string> {
    const encrypted = readJson<SecretDocument>(SECRET_KEY)?.[this.workspaceKey]?.[extensionId]?.[key]
    return encrypted ? (await decryptSecret(encrypted) ?? '') : ''
  }

  async writeSecret(extensionId: string, key: string, value: string): Promise<void> {
    const document = readJson<SecretDocument>(SECRET_KEY) ?? {}
    document[this.workspaceKey] ??= {}
    document[this.workspaceKey]![extensionId] ??= {}
    if (value) {
      if (!canEncrypt()) throw new Error('当前环境无法安全保存扩展密钥')
      document[this.workspaceKey]![extensionId]![key] = await encryptSecret(value)
    }
    else delete document[this.workspaceKey]![extensionId]![key]
    localStorage.setItem(SECRET_KEY, JSON.stringify(document))
  }
}

export function defaultState(sourceHash: string): ExtensionDeviceState {
  return { enabled: false, sourceHash, granted: [], lastError: null, crashCount: 0 }
}

export function hasAllPermissions(granted: readonly ExtensionPermission[], requested: readonly ExtensionPermission[]): boolean {
  return requested.every((permission) => granted.includes(permission))
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}
