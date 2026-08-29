import { describe, expect, it } from 'vitest'
import { safeExtensionWorkspacePath } from './host'

describe('扩展工作区路径网关', () => {
  it.each(['/etc/passwd', 'C:\\Users\\secret', '../secret.md', 'notes/../../secret.md'])('拒绝越界路径 %s', (path) => {
    expect(() => safeExtensionWorkspacePath(path)).toThrow('工作区内')
  })

  it.each(['.light/workspace.json', '.light-sync/state', '.git/config', 'node_modules/a.js'])('拒绝内部目录 %s', (path) => {
    expect(() => safeExtensionWorkspacePath(path)).toThrow('内部目录')
  })

  it('允许普通相对路径并规范化分隔符', () => {
    expect(safeExtensionWorkspacePath('notes\\today.md')).toBe('notes/today.md')
    expect(safeExtensionWorkspacePath('', true)).toBe('')
  })
})
