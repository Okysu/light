import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { archiveFileName, collectArchiveEntries, createArchive } from './archive'

describe('collectArchiveEntries', () => {
  let fs: MemoryAdapter

  beforeEach(async () => {
    fs = new MemoryAdapter()
    await fs.writeText('笔记.md', '# 笔记')
    await fs.writeText('项目/计划.md', '# 计划')
    await fs.writeText('项目/归档/旧稿.md', '# 旧稿')
    await fs.writeText('attachments/图.png', 'PNG')
    await fs.writeText('attachments/报告.pdf', 'PDF')
    await fs.writeText('attachments/未引用.bin', 'BIN')
    await fs.writeText('.light/workspace.json', '{"version":1}')
    await fs.writeText('.light/properties.json', '{"version":1}')
    await fs.writeText('.light/sync.json', '{"version":1,"bucket":"notes"}')
    await fs.writeText('.light/sync-state.json', '{"deviceId":"private"}')
    await fs.writeText('.light/trash/已删除.md', '# 已删除')
    await fs.writeText('.light/extensions/demo/manifest.json', '{"version":1}')
    await fs.writeText('.light/extensions/demo/main.js', 'void 0')
  })

  /**
   * 只比集合，不比顺序。
   * 中文路径的排序取决于运行环境的 ICU 数据，对它做强断言会让测试在不同
   * Node / 浏览器上飘——而收集顺序本来也不是这个函数的契约。
   */
  function paths(entries: Awaited<ReturnType<typeof collectArchiveEntries>>): Set<string> {
    return new Set(entries.map((entry) => entry.path))
  }

  it('默认收下全部笔记与配置', async () => {
    expect(paths(await collectArchiveEntries(fs))).toEqual(
      new Set([
        '.light/properties.json',
        '.light/sync.json',
        '.light/workspace.json',
        '.light/extensions/demo/manifest.json',
        '.light/extensions/demo/main.js',
        '笔记.md',
        '项目/计划.md',
        '项目/归档/旧稿.md',
        'attachments/图.png',
        'attachments/报告.pdf',
        'attachments/未引用.bin',
      ]),
    )
  })

  /** 回收站是已删除内容，用户要的是「现在的库」 */
  it('回收站一律排除', async () => {
    const result = [...paths(await collectArchiveEntries(fs))]
    expect(result.some((path) => path.includes('trash'))).toBe(false)
  })

  it('可以不带配置', async () => {
    const result = paths(await collectArchiveEntries(fs, { includeConfig: false }))
    expect([...result].some((path) => path.startsWith('.light/'))).toBe(false)
    expect(result.has('笔记.md')).toBe(true)
  })

  it('同步公开配置可以导出，但本机同步状态绝不进入压缩包', async () => {
    const result = paths(await collectArchiveEntries(fs))
    expect(result.has('.light/sync.json')).toBe(true)
    expect(result.has('.light/sync-state.json')).toBe(false)
  })

  it('扩展代码作为 Vault 内容随整库导出', async () => {
    const result = paths(await collectArchiveEntries(fs))
    expect(result.has('.light/extensions/demo/manifest.json')).toBe(true)
    expect(result.has('.light/extensions/demo/main.js')).toBe(true)
  })

  it('指定单篇时带上正文实际引用的附件，不带无关附件', async () => {
    await fs.writeText('笔记.md', '# 笔记\n\n![图](attachments/图.png)\n\n[报告](attachments/报告.pdf)')
    expect(paths(await collectArchiveEntries(fs, { include: ['笔记.md'] }))).toEqual(
      new Set(['笔记.md', 'attachments/图.png', 'attachments/报告.pdf']),
    )
  })

  it('单篇导出不会沿普通笔记链接打包其它文档', async () => {
    await fs.writeText('笔记.md', '[计划](项目/计划.md)')
    expect(paths(await collectArchiveEntries(fs, { include: ['笔记.md'] }))).toEqual(new Set(['笔记.md']))
  })

  it('指定目录时按前缀收下整棵子树', async () => {
    expect(paths(await collectArchiveEntries(fs, { include: ['项目'] }))).toEqual(
      new Set(['项目/计划.md', '项目/归档/旧稿.md']),
    )
  })

  it('目录里的笔记引用目录外附件时一并带上', async () => {
    await fs.writeText('项目/计划.md', '![图](../attachments/图.png)')
    const result = paths(await collectArchiveEntries(fs, { include: ['项目'] }))
    expect(result.has('attachments/图.png')).toBe(true)
  })

  /**
   * 目录前缀必须带分隔符再比。
   * 少了它，导出「项目」会把「项目归档」这类同前缀的兄弟目录一并带走。
   */
  it('同前缀的兄弟目录不会被误收', async () => {
    await fs.writeText('项目归档/别的.md', '# 别的')

    const result = paths(await collectArchiveEntries(fs, { include: ['项目'] }))
    expect(result.has('项目归档/别的.md')).toBe(false)
  })

  it('指定范围时不塞入配置——用户要的是那几篇，不是整个库', async () => {
    const result = [...paths(await collectArchiveEntries(fs, { include: ['笔记.md'] }))]
    expect(result.some((path) => path.startsWith('.light/'))).toBe(false)
  })

  it('空工作区产出空清单而不是报错', async () => {
    expect(await collectArchiveEntries(new MemoryAdapter())).toEqual([])
  })
})

describe('createArchive', () => {
  it('产出的 ZIP 能被解开，内容逐字一致', async () => {
    const fs = new MemoryAdapter()
    const source = '---\nid: a\n---\n# 标题\n\n正文里有 [[链接]] 和中文。\n'
    await fs.writeText('笔记.md', source)

    const archive = await createArchive(await collectArchiveEntries(fs, { includeConfig: false }))
    const unpacked = unzipSync(archive)

    expect(Object.keys(unpacked)).toEqual(['笔记.md'])
    expect(new TextDecoder().decode(unpacked['笔记.md'])).toBe(source)
  })

  it('保留目录结构', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText('项目/深/更深/笔记.md', '内容')

    const unpacked = unzipSync(await createArchive(await collectArchiveEntries(fs)))
    expect(Object.keys(unpacked)).toContain('项目/深/更深/笔记.md')
  })

  it('空清单产出的仍是合法 ZIP', async () => {
    expect(Object.keys(unzipSync(await createArchive([])))).toEqual([])
  })
})

describe('archiveFileName', () => {
  const at = new Date(2026, 7, 29) // 2026-08-29

  it('带上日期，便于区分多次导出', () => {
    expect(archiveFileName('我的工作区', at)).toBe('我的工作区-20260829.zip')
  })

  it('月份与日期补零', () => {
    expect(archiveFileName('库', new Date(2026, 0, 5))).toBe('库-20260105.zip')
  })

  it('清洗文件名里的非法字符', () => {
    expect(archiveFileName('a/b:c*d', at)).toBe('a_b_c_d-20260829.zip')
  })

  it('名称为空时有兜底', () => {
    expect(archiveFileName('   ', at)).toBe('workspace-20260829.zip')
  })
})
