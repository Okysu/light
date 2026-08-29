import { extname, normalizePath } from '../path'

export interface AttachmentSyncPolicy {
  /** false 表示附件只留本地；文档、看板和配置不受影响。 */
  enabled: boolean
  /** 0 表示不限大小。 */
  maxSizeMb: number
  /** 小写扩展名；可带或不带前导点。 */
  excludedExtensions: string[]
}

export const DEFAULT_ATTACHMENT_SYNC_POLICY: AttachmentSyncPolicy = {
  enabled: true,
  maxSizeMb: 0,
  excludedExtensions: [],
}

export type AttachmentSyncDecision = 'sync' | 'local-only'

export function normalizeAttachmentPolicy(input: unknown): AttachmentSyncPolicy {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const max = typeof value.maxSizeMb === 'number' && Number.isFinite(value.maxSizeMb)
    ? Math.max(0, value.maxSizeMb)
    : 0
  const extensions = Array.isArray(value.excludedExtensions)
    ? value.excludedExtensions
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeExtension)
      .filter(Boolean)
    : []
  return {
    enabled: value.enabled !== false,
    maxSizeMb: max,
    excludedExtensions: [...new Set(extensions)],
  }
}

export function attachmentSyncDecision(
  path: string,
  size: number,
  attachmentsDir: string,
  policy: AttachmentSyncPolicy,
): AttachmentSyncDecision {
  if (!isUnder(path, attachmentsDir)) return 'sync'
  if (!policy.enabled) return 'local-only'
  if (policy.maxSizeMb > 0 && size > policy.maxSizeMb * 1024 * 1024) return 'local-only'
  const extension = normalizeExtension(extname(path))
  if (extension && policy.excludedExtensions.map(normalizeExtension).includes(extension)) return 'local-only'
  return 'sync'
}

function isUnder(path: string, directory: string): boolean {
  const target = normalizePath(path)
  const root = normalizePath(directory)
  return Boolean(root) && (target === root || target.startsWith(`${root}/`))
}

function normalizeExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, '')
}
