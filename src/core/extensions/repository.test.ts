import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '@/core/storage/memory-adapter'
import { ExtensionRepository } from './repository'
import type { ExtensionManifest } from './types'

const manifest: ExtensionManifest = {
  version: 1,
  id: 'demo',
  name: 'Demo',
  entry: 'main.js',
  permissions: [],
  settings: {
    shared: { type: 'text', label: '共享', default: 'default' },
    token: { type: 'secret', label: '密钥' },
  },
}

describe('ExtensionRepository', () => {
  let storage: MemoryAdapter
  let repository: ExtensionRepository

  beforeEach(() => {
    storage = new MemoryAdapter()
    repository = new ExtensionRepository(storage)
  })

  it('把扩展保存在 Vault 内部目录并计算稳定哈希', async () => {
    const installed = await repository.install(manifest, 'console.log("hello")')
    expect(installed.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await storage.readText('.light/extensions/demo/main.js')).toContain('hello')
    expect((await repository.list())[0]?.manifest.id).toBe('demo')
  })

  it('共享设置落盘，但 secret 不写入 Vault', async () => {
    const installed = await repository.install(manifest, 'void 0')
    await repository.saveSettings(installed, { shared: 'vault', token: 'must-not-leak' })
    const raw = await storage.readText('.light/extensions/demo/settings.json')
    expect(raw).toContain('vault')
    expect(raw).not.toContain('must-not-leak')
  })

  it('扩展数据被限制在自己的目录', async () => {
    await repository.install(manifest, 'void 0')
    await repository.writeData('demo', { count: 2 })
    expect(await repository.readData('demo')).toEqual({ count: 2 })
  })
})
