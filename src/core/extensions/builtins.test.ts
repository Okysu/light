import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '@/core/storage/memory-adapter'
import { BUILTIN_EXTENSIONS, builtinName, ensureBuiltinExtensions, isBuiltinExtension, markBuiltin } from './builtins'
import { parseExtensionManifest } from './manifest'
import { ExtensionRepository, hashExtension } from './repository'

describe('官方内置扩展', () => {
  it('包含五个可通过严格 Manifest 校验的离线扩展', async () => {
    expect(BUILTIN_EXTENSIONS).toHaveLength(5)
    expect(new Set(BUILTIN_EXTENSIONS.map((item) => item.manifest.id)).size).toBe(5)

    for (const definition of BUILTIN_EXTENSIONS) {
      expect(parseExtensionManifest(definition.manifest)).toEqual(definition.manifest)
      expect(definition.source).toContain('light.commands.handle')
      expect(await hashExtension(definition.manifest, definition.source)).toMatch(/^[a-f0-9]{64}$/)
      expect(isBuiltinExtension(definition.manifest.id)).toBe(true)
    }
  })

  it('标记官方来源并按界面语言提供名称', async () => {
    const definition = BUILTIN_EXTENSIONS[0]!
    const extension = markBuiltin({
      manifest: definition.manifest,
      source: definition.source,
      sourceHash: await hashExtension(definition.manifest, definition.source),
      settings: {},
    })
    expect(extension.builtin).toBe(true)
    expect(builtinName(extension, 'zh-CN')).toBe('快速收集箱')
    expect(builtinName(extension, 'en-US')).toBe('Quick Capture')
  })

  it('自动补齐并修复官方代码，同时保留共享设置', async () => {
    const storage = new MemoryAdapter()
    const repository = new ExtensionRepository(storage)
    await ensureBuiltinExtensions(repository)
    expect(await repository.list()).toHaveLength(5)

    const definition = BUILTIN_EXTENSIONS[0]!
    const installed = await repository.read(definition.manifest.id)
    installed.settings.inboxFolder = 'My Inbox'
    await repository.saveSettings(installed, installed.settings)
    await storage.writeText(`.light/extensions/${definition.manifest.id}/main.js`, 'broken source')

    await ensureBuiltinExtensions(repository)
    expect((await repository.read(definition.manifest.id)).source).toBe(definition.source)
    expect((await repository.read(definition.manifest.id)).settings.inboxFolder).toBe('My Inbox')
  })
})
