import { describe, expect, it } from 'vitest'
import { parseExtensionManifest } from './manifest'

describe('扩展 manifest', () => {
  it('规范化权限、设置与菜单贡献', () => {
    const manifest = parseExtensionManifest({
      version: 1,
      id: 'dev.light.demo',
      name: 'Demo',
      entry: 'main.js',
      permissions: ['document:read', 'document:read', 'ai:invoke'],
      settings: {
        enabled: { type: 'boolean', label: '启用', default: true },
        tone: {
          type: 'select',
          label: '语气',
          default: 'short',
          options: [{ label: '简短', value: 'short' }],
          visibleWhen: { key: 'enabled', equals: true },
        },
      },
      contributes: {
        commands: [{ id: 'polish', title: '润色' }],
        slash: [{ command: 'polish', title: '润色', keywords: ['ai'] }],
        settings: [{ id: 'writing', title: '写作', fields: ['enabled', 'tone'], actions: [{ command: 'polish', title: '测试' }] }],
      },
    })

    expect(manifest.permissions).toEqual(['document:read', 'ai:invoke'])
    expect(manifest.settings?.tone?.default).toBe('short')
    expect(manifest.settings?.tone?.visibleWhen).toEqual({ key: 'enabled', equals: true })
    expect(manifest.contributes?.slash?.[0]?.group).toBe('扩展')
    expect(manifest.contributes?.settings?.[0]?.actions?.[0]?.command).toBe('polish')
  })

  it.each([
    [{ version: 2, id: 'demo', name: 'Demo', entry: 'main.js', permissions: [] }, 'version'],
    [{ version: 1, id: '../demo', name: 'Demo', entry: 'main.js', permissions: [] }, 'id'],
    [{ version: 1, id: 'demo', name: 'Demo', entry: 'remote.js', permissions: [] }, 'entry'],
    [{ version: 1, id: 'demo', name: 'Demo', entry: 'main.js', permissions: ['network:*'] }, '权限'],
  ])('拒绝危险或未知字段结构', (source, message) => {
    expect(() => parseExtensionManifest(source)).toThrow(message)
  })

  it('拒绝引用未声明命令的斜杠菜单', () => {
    expect(() => parseExtensionManifest({
      version: 1,
      id: 'demo',
      name: 'Demo',
      entry: 'main.js',
      permissions: [],
      contributes: { commands: [], slash: [{ command: 'missing', title: 'Missing' }] },
    })).toThrow('未声明')
  })

  it('拒绝设置界面引用未声明字段或命令', () => {
    expect(() => parseExtensionManifest({
      version: 1,
      id: 'demo',
      name: 'Demo',
      entry: 'main.js',
      permissions: [],
      settings: { enabled: { type: 'boolean', label: '启用' } },
      contributes: {
        commands: [],
        settings: [{ id: 'general', title: '常规', fields: ['missing'], actions: [{ command: 'missing', title: '执行' }] }],
      },
    })).toThrow('未声明设置')
  })
})
