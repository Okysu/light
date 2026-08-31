import { describe, expect, it } from 'vitest'
import { aiStatusKey, canSyncFromSidebar, syncStatusKey, type SyncSidebarState } from './sidebar-status'

const sync: SyncSidebarState = {
  enabled: true, ready: true, running: false, testing: false, gcRunning: false,
  online: true, error: null, vaultStatus: 'unlocked', lastSyncedAt: null,
}

describe('侧边栏状态', () => {
  it('区分 AI 关闭、未配置、就绪、执行和错误', () => {
    const state = { enabled: true, ready: true, busy: false, error: null }
    expect(aiStatusKey(state)).toBe('sidebar.ready')
    expect(aiStatusKey({ ...state, enabled: false })).toBe('sidebar.disabled')
    expect(aiStatusKey({ ...state, ready: false })).toBe('sidebar.notConfigured')
    expect(aiStatusKey({ ...state, busy: true })).toBe('sidebar.aiWorking')
    expect(aiStatusKey({ ...state, error: 'failed' })).toBe('sidebar.error')
  })

  it('同步状态覆盖配置、锁定、网络、执行、成功和失败', () => {
    expect(syncStatusKey(sync)).toBe('sidebar.ready')
    expect(syncStatusKey({ ...sync, enabled: false })).toBe('sidebar.disabled')
    expect(syncStatusKey({ ...sync, ready: false })).toBe('sidebar.notConfigured')
    expect(syncStatusKey({ ...sync, vaultStatus: 'locked', ready: false })).toBe('sync.locked')
    expect(syncStatusKey({ ...sync, online: false })).toBe('sidebar.offline')
    expect(syncStatusKey({ ...sync, running: true })).toBe('sync.syncing')
    expect(syncStatusKey({ ...sync, testing: true })).toBe('sync.testing')
    expect(syncStatusKey({ ...sync, gcRunning: true })).toBe('sidebar.maintenance')
    expect(syncStatusKey({ ...sync, lastSyncedAt: 100 })).toBe('sidebar.synced')
    expect(syncStatusKey({ ...sync, error: 'failed' })).toBe('sidebar.error')
  })

  it('只允许已启用、就绪且空闲在线的同步，避免重复触发', () => {
    expect(canSyncFromSidebar(sync)).toBe(true)
    for (const change of [{ enabled: false }, { ready: false }, { running: true }, { testing: true }, { gcRunning: true }, { online: false }]) {
      expect(canSyncFromSidebar({ ...sync, ...change })).toBe(false)
    }
  })
})
