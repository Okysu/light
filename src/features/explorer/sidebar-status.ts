import type { MessageKey } from '@/core/i18n/messages'

export interface AiSidebarState {
  enabled: boolean
  ready: boolean
  busy: boolean
  error: string | null
}

export interface SyncSidebarState {
  enabled: boolean
  ready: boolean
  running: boolean
  testing: boolean
  gcRunning: boolean
  online: boolean
  error: string | null
  vaultStatus: 'unknown' | 'absent' | 'locked' | 'unlocked'
  lastSyncedAt: number | null
}

export function aiStatusKey(state: AiSidebarState): MessageKey {
  if (state.busy) return 'sidebar.aiWorking'
  if (!state.enabled) return 'sidebar.disabled'
  if (state.error) return 'sidebar.error'
  return state.ready ? 'sidebar.ready' : 'sidebar.notConfigured'
}

export function syncStatusKey(state: SyncSidebarState): MessageKey {
  if (state.running) return 'sync.syncing'
  if (state.testing) return 'sync.testing'
  if (state.gcRunning) return 'sidebar.maintenance'
  if (!state.enabled) return 'sidebar.disabled'
  if (!state.online) return 'sidebar.offline'
  if (state.error) return 'sidebar.error'
  if (state.vaultStatus === 'locked') return 'sync.locked'
  if (!state.ready) return 'sidebar.notConfigured'
  return state.lastSyncedAt ? 'sidebar.synced' : 'sidebar.ready'
}

export function canSyncFromSidebar(state: SyncSidebarState): boolean {
  return state.enabled && state.ready && state.online && !state.running && !state.testing && !state.gcRunning
}
