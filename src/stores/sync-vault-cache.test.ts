// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/core/ai/key-store', () => ({
  encryptSecret: vi.fn(async (value: string) => ({ cipher: value, iv: 'iv' })),
  decryptSecret: vi.fn(async (value: { cipher: string }) => value.cipher),
}))

import { cacheVaultKey, forgetCachedVaultKey, loadCachedVaultKey } from './sync-vault-cache'

describe('S3 Vault 本机缓存', () => {
  beforeEach(() => localStorage.clear())

  it('按 profile 隔离、读取和锁定 Vault 主密钥', async () => {
    const key = new Uint8Array(32).fill(7)
    await cacheVaultKey('a', key)
    expect(await loadCachedVaultKey('a')).toEqual(key)
    expect(await loadCachedVaultKey('b')).toBeNull()
    forgetCachedVaultKey('a')
    expect(await loadCachedVaultKey('a')).toBeNull()
  })
})
