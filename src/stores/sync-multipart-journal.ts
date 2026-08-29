import type { MultipartJournal, MultipartUploadRecord } from '@/core/sync/s3-remote'

const JOURNAL_KEY = 'light:s3-multipart-journal'

/**
 * Multipart uploadId/ETag 只属于本机和当前 S3 profile。
 * 放 localStorage 可确保它既不进 Vault、也不会被同步或导出。
 */
export function createMultipartJournal(profileId: string): MultipartJournal {
  const key = (id: string) => `${profileId}\n${id}`
  return {
    async load(id) {
      return readJournal()[key(id)] ?? null
    },
    async save(id, record) {
      const journal = readJournal()
      journal[key(id)] = record
      writeJournal(journal)
    },
    async remove(id) {
      const journal = readJournal()
      delete journal[key(id)]
      writeJournal(journal)
    },
  }
}

export function clearMultipartJournal(profileId: string): void {
  const journal = readJournal()
  const prefix = `${profileId}\n`
  for (const key of Object.keys(journal)) {
    if (key.startsWith(prefix)) delete journal[key]
  }
  writeJournal(journal)
}

function readJournal(): Record<string, MultipartUploadRecord> {
  try {
    const parsed = JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, MultipartUploadRecord>
  } catch {
    return {}
  }
}

function writeJournal(value: Record<string, MultipartUploadRecord>): void {
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(value))
}
