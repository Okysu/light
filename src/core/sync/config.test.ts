import { describe, expect, it } from 'vitest'
import { DEFAULT_SYNC_CONFIG, isSyncConfigured, normalizePrefix, normalizeSyncConfig } from './config'

describe('同步配置', () => {
  it('逐字段规范化，不把未知值带入运行时', () => {
    expect(normalizeSyncConfig({
      enabled: true,
      endpoint: ' https://s3.example.com/ ',
      region: 'auto',
      bucket: ' notes ',
      prefix: '/vault/main/',
      forcePathStyle: false,
      autoSync: false,
      conflictPolicy: 'manual',
      attachmentPolicy: { enabled: true, maxSizeMb: 25, excludedExtensions: ['.PSD'] },
      secretAccessKey: '绝不能进入配置',
    })).toEqual({
      version: 1,
      enabled: true,
      endpoint: 'https://s3.example.com/',
      region: 'auto',
      bucket: 'notes',
      prefix: 'vault/main',
      forcePathStyle: false,
      autoSync: false,
      conflictPolicy: 'manual',
      attachmentPolicy: { enabled: true, maxSizeMb: 25, excludedExtensions: ['psd'] },
    })
  })

  it('损坏配置回退安全默认值', () => {
    expect(normalizeSyncConfig(null)).toEqual(DEFAULT_SYNC_CONFIG)
    expect(normalizePrefix('///a/b///')).toBe('a/b')
  })

  it('端点、区域和 Bucket 齐全才算可连接', () => {
    expect(isSyncConfigured({ ...DEFAULT_SYNC_CONFIG, endpoint: 'https://s3.test', bucket: 'notes' })).toBe(true)
    expect(isSyncConfigured({ ...DEFAULT_SYNC_CONFIG, endpoint: '', bucket: 'notes' })).toBe(false)
  })
})
