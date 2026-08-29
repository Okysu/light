export const EXTENSIONS_DIR = '.light/extensions'
export const EXTENSION_ENTRY = 'main.js'
export const EXTENSION_MANIFEST = 'manifest.json'

export const EXTENSION_PERMISSIONS = [
  'workspace:read',
  'workspace:write',
  'workspace:delete',
  'document:read',
  'document:write',
  'ai:invoke',
] as const

export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number]
export type ExtensionSettingType = 'boolean' | 'text' | 'textarea' | 'number' | 'select' | 'secret'
export type ExtensionSettingValue = string | number | boolean | null

export interface ExtensionSettingDefinition {
  type: ExtensionSettingType
  label: string
  description?: string
  default?: ExtensionSettingValue
  options?: Array<{ label: string; value: string }>
}

export interface ExtensionCommandContribution {
  id: string
  title: string
  description?: string
}

export interface ExtensionSlashContribution {
  command: string
  title: string
  group?: string
  keywords?: string[]
}

export interface ExtensionManifest {
  version: 1
  id: string
  name: string
  description?: string
  author?: string
  entry: 'main.js'
  permissions: ExtensionPermission[]
  settings?: Record<string, ExtensionSettingDefinition>
  contributes?: {
    commands?: ExtensionCommandContribution[]
    slash?: ExtensionSlashContribution[]
  }
}

export interface InstalledExtension {
  manifest: ExtensionManifest
  source: string
  sourceHash: string
  settings: Record<string, ExtensionSettingValue>
}

export interface ExtensionDeviceState {
  enabled: boolean
  sourceHash: string
  granted: ExtensionPermission[]
  lastError: string | null
  crashCount: number
}

export type ExtensionStatus = 'disabled' | 'permission-required' | 'starting' | 'active' | 'error'

export interface ExtensionLogEntry {
  at: number
  level: 'info' | 'error'
  message: string
}

export interface ExtensionCommand {
  id: string
  extensionId: string
  command: string
  title: string
  description?: string
}

export interface ExtensionSlashItem {
  id: string
  extensionId: string
  command: string
  title: string
  group: string
  keywords: string[]
}

export interface ExtensionRuntimeState {
  extension: InstalledExtension
  device: ExtensionDeviceState
  status: ExtensionStatus
  logs: ExtensionLogEntry[]
}

export interface ExtensionHostRequest {
  method: string
  args: unknown
}
