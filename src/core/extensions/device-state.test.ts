// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionDeviceStateStore, defaultState, hasAllPermissions } from './device-state'

vi.mock('@/core/ai/key-store', () => ({
  canEncrypt: () => true,
  encryptSecret: async (value: string) => ({ cipher: btoa(value), iv: 'test' }),
  decryptSecret: async (value: { cipher: string }) => atob(value.cipher),
}))

describe('扩展设备状态', () => {
  beforeEach(() => localStorage.clear())

  it('代码哈希变化后不会继承启用状态和权限', () => {
    const store = new ExtensionDeviceStateStore('vault')
    store.write('demo', { enabled: true, sourceHash: 'old', granted: ['document:read'], lastError: null, crashCount: 0 })
    expect(store.read('demo', 'old').enabled).toBe(true)
    expect(store.read('demo', 'new')).toEqual(defaultState('new'))
  })

  it('secret 加密后按 Vault 与扩展隔离', async () => {
    const first = new ExtensionDeviceStateStore('first')
    const second = new ExtensionDeviceStateStore('second')
    await first.writeSecret('demo', 'token', 'secret')
    expect(localStorage.getItem('light:extension-secrets')).not.toContain('secret')
    expect(await first.readSecret('demo', 'token')).toBe('secret')
    expect(await second.readSecret('demo', 'token')).toBe('')
  })

  it('要求全部权限均被批准', () => {
    expect(hasAllPermissions(['document:read'], ['document:read'])).toBe(true)
    expect(hasAllPermissions(['document:read'], ['document:read', 'ai:invoke'])).toBe(false)
  })
})
