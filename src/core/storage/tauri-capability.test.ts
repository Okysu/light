import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Capability {
  windows?: string[]
  permissions?: string[]
}

describe('Tauri 文件系统 capability', () => {
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
})
