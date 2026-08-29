import { describe, expect, it } from 'vitest'
import {
  attachmentSyncDecision,
  DEFAULT_ATTACHMENT_SYNC_POLICY,
  normalizeAttachmentPolicy,
} from './attachment-policy'

describe('附件同步策略', () => {
  it('默认上传所有附件，非附件永远不受规则影响', () => {
    expect(attachmentSyncDecision('附件/a.png', 99, '附件', DEFAULT_ATTACHMENT_SYNC_POLICY)).toBe('sync')
    expect(attachmentSyncDecision('笔记.md', 99_000_000, '附件', { enabled: false, maxSizeMb: 1, excludedExtensions: ['md'] })).toBe('sync')
  })

  it('可以把全部附件设为仅本地', () => {
    expect(attachmentSyncDecision('附件/a.png', 1, '附件', { enabled: false, maxSizeMb: 0, excludedExtensions: [] })).toBe('local-only')
  })

  it('按大小和扩展名排除，但边界大小仍上传', () => {
    const policy = { enabled: true, maxSizeMb: 2, excludedExtensions: ['.PSD', 'mov'] }
    expect(attachmentSyncDecision('附件/a.bin', 2 * 1024 * 1024, '附件', policy)).toBe('sync')
    expect(attachmentSyncDecision('附件/a.bin', 2 * 1024 * 1024 + 1, '附件', policy)).toBe('local-only')
    expect(attachmentSyncDecision('附件/a.PsD', 1, '附件', policy)).toBe('local-only')
  })

  it('规范化非法大小并去重扩展名', () => {
    expect(normalizeAttachmentPolicy({ maxSizeMb: -1, excludedExtensions: ['.PNG', 'png', 1] })).toEqual({
      enabled: true,
      maxSizeMb: 0,
      excludedExtensions: ['png'],
    })
  })
})
