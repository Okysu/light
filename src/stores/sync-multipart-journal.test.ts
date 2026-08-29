// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearMultipartJournal, createMultipartJournal } from './sync-multipart-journal'

describe('S3 multipart 本机日志', () => {
  beforeEach(() => localStorage.clear())

  it('按 profile 隔离并可清理', async () => {
    const first = createMultipartJournal('a')
    const second = createMultipartJournal('b')
    const record = { key: 'k', uploadId: 'u', size: 10, parts: [{ ETag: 'e', PartNumber: 1 }], updatedAt: 1, noncePrefix: 'AAAAAAAAAAA' }
    await first.save('hash', record)
    await second.save('hash', { ...record, uploadId: 'u2' })

    expect((await first.load('hash'))?.uploadId).toBe('u')
    expect((await second.load('hash'))?.uploadId).toBe('u2')

    clearMultipartJournal('a')
    expect(await first.load('hash')).toBeNull()
    expect((await second.load('hash'))?.uploadId).toBe('u2')
  })
})
