import type { ConflictPolicy, SyncConfig } from './types'
import { DEFAULT_ATTACHMENT_SYNC_POLICY, normalizeAttachmentPolicy } from './attachment-policy'

export const SYNC_CONFIG_PATH = '.light/sync.json'
export const SYNC_STATE_PATH = '.light/sync-state.json'

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  version: 1,
  enabled: false,
  endpoint: '',
  region: 'auto',
  bucket: '',
  prefix: '',
  forcePathStyle: true,
  autoSync: true,
  conflictPolicy: 'keep-both',
  attachmentPolicy: { ...DEFAULT_ATTACHMENT_SYNC_POLICY },
}

export function normalizeSyncConfig(input: unknown): SyncConfig {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    version: 1,
    enabled: value.enabled === true,
    endpoint: text(value.endpoint),
    region: text(value.region) || DEFAULT_SYNC_CONFIG.region,
    bucket: text(value.bucket),
    prefix: normalizePrefix(text(value.prefix)),
    forcePathStyle: value.forcePathStyle !== false,
    autoSync: value.autoSync !== false,
    conflictPolicy: isConflictPolicy(value.conflictPolicy)
      ? value.conflictPolicy
      : DEFAULT_SYNC_CONFIG.conflictPolicy,
    attachmentPolicy: normalizeAttachmentPolicy(value.attachmentPolicy),
  }
}

export function normalizePrefix(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

export function isSyncConfigured(config: SyncConfig): boolean {
  return !!config.endpoint.trim() && !!config.bucket.trim() && !!config.region.trim()
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isConflictPolicy(value: unknown): value is ConflictPolicy {
  return value === 'keep-both' || value === 'manual' || value === 'prefer-local' || value === 'prefer-remote'
}
