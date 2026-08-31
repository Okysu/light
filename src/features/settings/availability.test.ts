import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isSettingsPageDisabled } from './availability'

describe('数据目录打不开时的设置恢复入口', () => {
  it('首次初始化失败后常规和外观仍可打开', () => {
    expect(isSettingsPageDisabled('workspace', 'workspace', false)).toBe(false)
    expect(isSettingsPageDisabled('app', 'appearance', false)).toBe(false)
  })

  it('属性、同步等依赖库数据的页面只在目录打开后恢复', () => {
    for (const page of ['properties', 'sync', 'trash', 'export']) {
      expect(isSettingsPageDisabled('workspace', page, false)).toBe(true)
      expect(isSettingsPageDisabled('workspace', page, true)).toBe(false)
    }
  })

  it('导航按页判定，常规页中写入库的表单仍受保护', () => {
    const panel = readFileSync(fileURLToPath(new URL('./SettingsPanel.vue', import.meta.url)), 'utf8')
    const general = readFileSync(fileURLToPath(new URL('./sections/WorkspaceSection.vue', import.meta.url)), 'utf8')
    expect(panel).toContain(':disabled="isSettingsPageDisabled(group.id, page.id, workspace.isOpen)"')
    expect(general).toContain('v-model="dailyNoteFolder" :disabled="!workspace.isOpen"')
    expect(general).toContain('v-model="dailyNoteFormat" :disabled="!workspace.isOpen"')
    expect(general).toContain(':disabled="changingPath || workspace.loading" @click="change"')
  })
})
