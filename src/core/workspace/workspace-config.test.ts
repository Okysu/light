import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_CONFIG, normalizeWorkspaceConfig } from './types'

describe('normalizeWorkspaceConfig', () => {
  it('V1 删除无效库名称，只保留当前字段', () => {
    const config = normalizeWorkspaceConfig({
      version: 1,
      name: '旧库名',
      trashRetentionDays: 7,
      searchIncludesTrash: true,
      dailyNoteFolder: 'daily',
      dailyNoteFormat: 'YYYY/MM/DD',
    })

    expect(config).toEqual({
      version: 1,
      trashRetentionDays: 7,
      searchIncludesTrash: true,
      dailyNoteFolder: 'daily',
      dailyNoteFormat: 'YYYY/MM/DD',
    })
    expect(config).not.toHaveProperty('name')
  })

  it('损坏或缺失的字段分别回退默认值', () => {
    expect(normalizeWorkspaceConfig({ attachmentsDir: '旧值', searchIncludesTrash: 'yes' })).toEqual(
      DEFAULT_WORKSPACE_CONFIG,
    )
  })
})
