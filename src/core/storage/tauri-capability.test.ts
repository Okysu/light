import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Capability {
  windows?: string[]
  permissions?: string[]
}

interface TauriConfig {
  plugins?: { fs?: { requireLiteralLeadingDot?: boolean } }
  app?: {
    windows?: Array<{ dragDropEnabled?: boolean }>
  }
}

describe('Tauri 文件系统 capability', () => {
  it('静态 scope 配置允许隐藏项，但不静态放开全盘', () => {
    const path = join(process.cwd(), 'src-tauri', 'tauri.conf.json')
    const config = JSON.parse(readFileSync(path, 'utf8')) as TauriConfig
    // 这里只检查静态配置。动态授权的隐藏目录匹配由 Rust workspace_scope 测试验证。
    expect(config.plugins?.fs?.requireLiteralLeadingDot).toBe(false)
    const capability = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri', 'capabilities', 'default.json'), 'utf8')) as Capability
    expect(capability.permissions?.every((permission) => typeof permission === 'string')).toBe(true)
    expect(capability.permissions).not.toContain('fs:scope-home-recursive')
  })
  it('允许客户端同步以流方式读写工作区文件', () => {
    const path = join(process.cwd(), 'src-tauri', 'capabilities', 'default.json')
    const capability = JSON.parse(readFileSync(path, 'utf8')) as Capability

    expect(capability.windows).toEqual(expect.arrayContaining(['main', 'capture']))
    expect(capability.permissions).toEqual(expect.arrayContaining([
      'fs:allow-open',
      'fs:allow-read',
      'fs:allow-write',
    ]))
  })

  it('关闭原生拖放接管，让 Windows WebView 使用 HTML5 文件树拖拽', () => {
    const path = join(process.cwd(), 'src-tauri', 'tauri.conf.json')
    const config = JSON.parse(readFileSync(path, 'utf8')) as TauriConfig

    expect(config.app?.windows).not.toHaveLength(0)
    expect(config.app?.windows?.every((window) => window.dragDropEnabled === false)).toBe(true)
  })
})
