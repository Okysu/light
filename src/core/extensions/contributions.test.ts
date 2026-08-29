import { describe, expect, it } from 'vitest'
import { ExtensionContributions } from './contributions'
import type { InstalledExtension } from './types'

describe('扩展贡献注册表', () => {
  it('为贡献加扩展命名空间并可完整卸载', () => {
    const registry = new ExtensionContributions()
    const extension: InstalledExtension = {
      source: '', sourceHash: 'hash', settings: {},
      manifest: {
        version: 1, id: 'demo', name: 'Demo', entry: 'main.js', permissions: [],
        contributes: {
          commands: [{ id: 'hello', title: 'Hello' }],
          slash: [{ command: 'hello', title: 'Hello', group: 'Demo', keywords: [] }],
        },
      },
    }
    registry.register(extension)
    expect(registry.commands()[0]).toMatchObject({ id: 'demo.hello', command: 'hello' })
    expect(registry.slashItems()[0]).toMatchObject({ id: 'demo.hello', extensionId: 'demo' })
    registry.unregister('demo')
    expect(registry.commands()).toEqual([])
  })
})
