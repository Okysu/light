import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { synchronize } from './engine'
import type { RemoteManifest, RemoteManifestSnapshot, SyncRemote } from './types'
import { SyncError } from './types'

class FakeRemote implements SyncRemote {
  manifest: RemoteManifest | null = null
  contents = new Map<string, Uint8Array>()
  revision = 0
  readCount = 0
  writeCount = 0
  onReadManifest?: (remote: FakeRemote) => void | Promise<void>
  onWriteManifest?: (remote: FakeRemote) => void | Promise<void>
  onReadContent?: (hash: string, remote: FakeRemote) => void | Promise<void>

  async readManifest(): Promise<RemoteManifestSnapshot | null> {
    this.readCount += 1
    await this.onReadManifest?.(this)
    return this.manifest
      ? { manifest: structuredClone(this.manifest), etag: `"${this.revision}"` }
      : null
  }

  async writeManifest(manifest: RemoteManifest, previousEtag: string | null): Promise<void> {
    this.writeCount += 1
    await this.onWriteManifest?.(this)
    const expected = this.manifest ? `"${this.revision}"` : null
    if (previousEtag !== expected) throw new SyncError('changed', 'REMOTE_CHANGED')
    this.manifest = structuredClone(manifest)
    this.revision += 1
  }

  async readContent(hash: string): Promise<Uint8Array> {
    await this.onReadContent?.(hash, this)
    const value = this.contents.get(hash)
    if (!value) throw new Error(`missing ${hash}`)
    return value.slice()
  }

  async writeContent(hash: string, contents: Uint8Array): Promise<void> {
    if (!this.contents.has(hash)) this.contents.set(hash, contents.slice())
  }

  async testConnection(): Promise<void> {}

  currentManifest(): RemoteManifest | null {
    return this.manifest
  }
}

async function hashOf(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('S3 同步引擎', () => {
  it('首次把本地文件增量上传，另一台空设备可以下载', async () => {
    const remote = new FakeRemote()
    const first = new MemoryAdapter()
    await first.writeText('笔记.md', '本地内容')

    const uploaded = await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    expect(uploaded.uploaded).toBe(1)
    expect(remote.manifest?.entries['笔记.md']).toMatchObject({ deleted: false, vector: { a: 1 } })

    const second = new MemoryAdapter()
    const downloaded = await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'keep-both' })
    expect(downloaded.downloaded).toBe(1)
    expect(await second.readText('笔记.md')).toBe('本地内容')
  })

  it('同步删除态，另一台设备会删除原路径', async () => {
    const remote = new FakeRemote()
    const first = new MemoryAdapter()
    const second = new MemoryAdapter()
    await first.writeText('旧稿.md', '内容')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'keep-both' })

    await first.remove('旧稿.md')
    const removed = await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    expect(removed.deletedRemote).toBe(1)

    const applied = await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'keep-both' })
    expect(applied.deletedLocal).toBe(1)
    expect(await second.exists('旧稿.md')).toBe(false)
  })

  it('离线并发编辑默认保留双方，并让本地版本成为原路径的新共同版本', async () => {
    let clock = new Date(2026, 7, 29, 21, 30, 0).getTime()
    const now = () => clock++
    const remote = new FakeRemote()
    const first = new MemoryAdapter(now)
    const second = new MemoryAdapter(now)
    await first.writeText('方案.md', '初稿')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both', now })
    await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'keep-both', now })

    await first.writeText('方案.md', '设备 A')
    await second.writeText('方案.md', '设备 B')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both', now })
    const result = await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'keep-both', now })

    expect(result.conflicts).toEqual(['方案.md'])
    expect(await second.readText('方案.md')).toBe('设备 B')
    const conflict = (await second.list('')).find((entry) => entry.name.startsWith('方案 (冲突-云端-'))
    expect(conflict).toBeTruthy()
    expect(await second.readText(conflict!.path)).toBe('设备 A')
  })

  it('文本的非重叠并发修改会像 Git 一样自动三方合并并同步给其它设备', async () => {
    const remote = new FakeRemote()
    const first = new MemoryAdapter()
    const second = new MemoryAdapter()
    const path = '合并.md'
    await first.writeText(path, '# 标题\n\n第一段\n\n第二段\n')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'merge-text' })
    await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'merge-text' })

    await first.writeText(path, '# 新标题\n\n第一段\n\n第二段\n')
    await second.writeText(path, '# 标题\n\n第一段\n\n第二段已补充\n')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'merge-text' })
    const result = await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'merge-text' })

    const expected = '# 新标题\n\n第一段\n\n第二段已补充\n'
    expect(result.merged).toEqual([path])
    expect(result.conflicts).toEqual([])
    expect(await second.readText(path)).toBe(expected)
    expect((await second.list('')).some((entry) => entry.name.includes('冲突-云端'))).toBe(false)

    const observer = new MemoryAdapter()
    await synchronize({ storage: observer, remote, deviceId: 'observer', conflictPolicy: 'merge-text' })
    expect(await observer.readText(path)).toBe(expected)
  })

  it('Markdown 的重叠修改写入标准冲突标记，不复制出另一篇笔记', async () => {
    const remote = new FakeRemote()
    const first = new MemoryAdapter()
    const second = new MemoryAdapter()
    const path = '重叠.md'
    await first.writeText(path, '# 标题\n\n共同内容\n')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'merge-text' })
    await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'merge-text' })

    await first.writeText(path, '# 标题\n\n来自 A\n')
    await second.writeText(path, '# 标题\n\n来自 B\n')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'merge-text' })
    const result = await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'merge-text' })
    const merged = await second.readText(path)

    expect(result.merged).toEqual([])
    expect(result.conflicts).toEqual([path])
    expect(merged).toContain('<<<<<<< LOCAL\n来自 B')
    expect(merged).toContain('||||||| BASE\n共同内容')
    expect(merged).toContain('=======\n来自 A\n>>>>>>> REMOTE')
    expect((await second.list('')).some((entry) => entry.name.includes('冲突-云端'))).toBe(false)
  })

  it('结构化 JSON 发生重叠冲突时回退到保留双份，避免写入非法 JSON', async () => {
    const remote = new FakeRemote()
    const first = new MemoryAdapter()
    const second = new MemoryAdapter()
    const path = '视图.board'
    await first.writeText(path, '{"title":"共同"}\n')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'merge-text' })
    await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'merge-text' })

    await first.writeText(path, '{"title":"A"}\n')
    await second.writeText(path, '{"title":"B"}\n')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'merge-text' })
    const result = await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'merge-text' })

    expect(result.conflicts).toEqual([path])
    expect(JSON.parse(await second.readText(path))).toEqual({ title: 'B' })
    const copy = (await second.list('')).find((entry) => entry.name.startsWith('视图 (冲突-云端-'))
    expect(copy).toBeTruthy()
    expect(JSON.parse(await second.readText(copy!.path))).toEqual({ title: 'A' })
  })

  it.each([
    ['prefer-local', '设备 B', '设备 B', false],
    ['prefer-remote', '设备 A', '设备 A', false],
    ['manual', '设备 B', '设备 A', true],
  ] as const)('离线并发编辑按 %s 策略收敛', async (policy, localExpected, remoteExpected, hasCopy) => {
    const remote = new FakeRemote()
    const first = new MemoryAdapter()
    const second = new MemoryAdapter()
    await first.writeText('策略.md', '初稿')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'keep-both' })
    await first.writeText('策略.md', '设备 A')
    await second.writeText('策略.md', '设备 B')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })

    const result = await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: policy })
    expect(result.conflicts).toEqual(['策略.md'])
    expect(await second.readText('策略.md')).toBe(localExpected)
    const copy = (await second.list('')).find((entry) => entry.name.startsWith('策略 (冲突-云端-'))
    expect(Boolean(copy)).toBe(hasCopy)

    const observer = new MemoryAdapter()
    await synchronize({ storage: observer, remote, deviceId: 'observer', conflictPolicy: 'keep-both' })
    expect(await observer.readText('策略.md')).toBe(remoteExpected)
  })

  it.each([
    ['keep-both', true, false],
    ['manual', true, true],
    ['prefer-local', true, false],
    ['prefer-remote', false, true],
  ] as const)('本地编辑与远端删除冲突按 %s 策略处理', async (policy, localExists, remoteDeleted) => {
    const remote = new FakeRemote()
    const first = new MemoryAdapter()
    const second = new MemoryAdapter()
    await first.writeText('删除冲突.md', '初稿')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'keep-both' })
    await first.remove('删除冲突.md')
    await second.writeText('删除冲突.md', '本地继续编辑')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })

    await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: policy })
    expect(await second.exists('删除冲突.md')).toBe(localExists)
    expect(remote.manifest!.entries['删除冲突.md']!.deleted).toBe(remoteDeleted)
  })

  const policies = ['keep-both', 'manual', 'prefer-local', 'prefer-remote'] as const
  const conflictScenarios = ['首次同路径', 'edit/edit', 'edit/delete', 'delete/edit'] as const

  it.each(policies.flatMap((policy) => conflictScenarios.map((scenario) => [policy, scenario] as const)))(
    '%s 策略完整收敛 %s，第二、三轮不重复冲突',
    async (policy, scenario) => {
      const remote = new FakeRemote()
      const first = new MemoryAdapter()
      const second = new MemoryAdapter()
      const path = '矩阵.md'

      await first.writeText(path, scenario === '首次同路径' ? '远端版本' : '共同初稿')
      await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
      if (scenario === '首次同路径') {
        await second.writeText(path, '本地版本')
      } else {
        await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'keep-both' })
        if (scenario === 'edit/edit') {
          await first.writeText(path, '远端版本')
          await second.writeText(path, '本地版本')
        } else if (scenario === 'edit/delete') {
          await first.remove(path)
          await second.writeText(path, '本地版本')
        } else {
          await first.writeText(path, '远端版本')
          await second.remove(path)
        }
        await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
      }

      const resolved = await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: policy })
      expect(resolved.conflicts).toEqual([path])
      const localShouldExist = scenario === 'delete/edit'
        ? policy === 'prefer-remote'
        : policy !== 'prefer-remote' || scenario !== 'edit/delete'
      expect(await second.exists(path)).toBe(localShouldExist)

      const expectsCopy = (policy === 'keep-both' || policy === 'manual')
        && scenario !== 'edit/delete'
      const copy = (await second.list('')).find((entry) => entry.name.startsWith('矩阵 (冲突-云端-'))
      expect(Boolean(copy)).toBe(expectsCopy)

      const secondRound = await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: policy })
      const thirdRound = await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: policy })
      expect(secondRound.conflicts).toEqual([])
      expect(thirdRound.conflicts).toEqual([])
    },
  )

  it('CAS 竞争时自动重读重算，失败尝试不会提前创建冲突副本', async () => {
    const remote = new FakeRemote()
    const first = new MemoryAdapter()
    const second = new MemoryAdapter()
    await first.writeText('竞争.md', '远端')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    await second.writeText('竞争.md', '本地')

    remote.onWriteManifest = async (target) => {
      if (target.writeCount !== 2) return // 第一次写入来自初始化，第二次才是竞争尝试
      expect((await second.list('')).some((entry) => entry.name.includes('冲突-云端'))).toBe(false)
      target.revision += 1
      target.manifest!.updatedAt += 1
      throw new SyncError('changed', 'REMOTE_CHANGED')
    }

    const result = await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'keep-both' })
    expect(result.conflicts).toEqual(['竞争.md'])
    expect(remote.writeCount).toBe(3)
    expect((await second.list('')).filter((entry) => entry.name.includes('冲突-云端'))).toHaveLength(1)
  })

  it('两个独立设备实例同时抢写同一清单，CAS 重试后合并双方改动', async () => {
    const remote = new FakeRemote()
    const seed = new MemoryAdapter()
    await seed.writeText('共同.md', '基线')
    await synchronize({ storage: seed, remote, deviceId: 'seed', conflictPolicy: 'keep-both' })

    const first = new MemoryAdapter()
    const second = new MemoryAdapter()
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    await synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'keep-both' })
    await first.writeText('设备-A.md', 'A')
    await second.writeText('设备-B.md', 'B')

    await Promise.all([
      synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' }),
      synchronize({ storage: second, remote, deviceId: 'b', conflictPolicy: 'keep-both' }),
    ])

    const observer = new MemoryAdapter()
    await synchronize({ storage: observer, remote, deviceId: 'observer', conflictPolicy: 'keep-both' })
    expect(await observer.readText('设备-A.md')).toBe('A')
    expect(await observer.readText('设备-B.md')).toBe('B')
    expect(remote.writeCount).toBeGreaterThanOrEqual(3)
  })

  it('无 manifest 写入但需下载时会复查 ETag，变化后重算而不落地旧内容', async () => {
    const remote = new FakeRemote()
    const first = new MemoryAdapter()
    await first.writeText('更新.md', '旧远端')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    const newHash = await hashOf('新远端')
    remote.contents.set(newHash, new TextEncoder().encode('新远端'))
    remote.readCount = 0
    remote.onReadManifest = (target) => {
      if (target.readCount !== 2) return
      target.revision += 1
      target.manifest!.entries['更新.md'] = {
        hash: newHash,
        size: new TextEncoder().encode('新远端').byteLength,
        deleted: false,
        vector: { a: 2 },
        modifiedAt: 2,
      }
    }

    const empty = new MemoryAdapter()
    const result = await synchronize({ storage: empty, remote, deviceId: 'b', conflictPolicy: 'prefer-remote' })
    expect(result.downloaded).toBe(1)
    expect(await empty.readText('更新.md')).toBe('新远端')
    expect(remote.readCount).toBe(4)
  })

  it('下载后发现本地在扫描后被编辑时拒绝覆盖', async () => {
    const remote = new FakeRemote()
    const source = new MemoryAdapter()
    const target = new MemoryAdapter()
    await source.writeText('保护.md', '云端内容')
    await synchronize({ storage: source, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    remote.onReadContent = async () => {
      remote.onReadContent = undefined
      await target.writeText('保护.md', '用户刚刚编辑的内容')
    }

    await expect(
      synchronize({ storage: target, remote, deviceId: 'b', conflictPolicy: 'prefer-remote' }),
    ).rejects.toMatchObject({ code: 'IO' })
    expect(await target.readText('保护.md')).toBe('用户刚刚编辑的内容')
  })

  it('REMOTE_CHANGED 默认最多自动重试三次', async () => {
    const remote = new FakeRemote()
    const storage = new MemoryAdapter()
    await storage.writeText('重试.md', '内容')
    remote.onWriteManifest = () => { throw new SyncError('changed', 'REMOTE_CHANGED') }

    await expect(
      synchronize({ storage, remote, deviceId: 'a', conflictPolicy: 'prefer-local' }),
    ).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    expect(remote.writeCount).toBe(4)
  })

  it('指数退避期间支持 AbortSignal 取消', async () => {
    const remote = new FakeRemote()
    const storage = new MemoryAdapter()
    const controller = new AbortController()
    await storage.writeText('取消重试.md', '内容')
    remote.onWriteManifest = () => {
      controller.abort('user')
      throw new SyncError('changed', 'REMOTE_CHANGED')
    }

    await expect(synchronize({
      storage,
      remote,
      deviceId: 'a',
      conflictPolicy: 'prefer-local',
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(remote.writeCount).toBe(1)
  })

  it('支持在开始前取消同步', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(synchronize({
      storage: new MemoryAdapter(),
      remote: new FakeRemote(),
      deviceId: 'a',
      conflictPolicy: 'keep-both',
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('本地同步状态不会被上传', async () => {
    const remote = new FakeRemote()
    const storage = new MemoryAdapter()
    await storage.writeText('.light/sync-state.json', '{"private":true}')
    await storage.writeText('.light/history/v1/note/index.json', '{"local":true}')
    await storage.writeText('.light/sync.json', '{"enabled":true}')
    await storage.writeText('.light/sidebar.json', '{"version":1,"parents":{}}')

    await synchronize({ storage, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    expect(remote.manifest?.entries).toHaveProperty('.light/sync.json')
    expect(remote.manifest?.entries).toHaveProperty('.light/sidebar.json')
    expect(remote.manifest?.entries).not.toHaveProperty('.light/sync-state.json')
    expect(remote.manifest?.entries).not.toHaveProperty('.light/history/v1/note/index.json')
  })

  it('附件规则排除已跟踪的本地附件时不会发布删除墓碑', async () => {
    const remote = new FakeRemote()
    const storage = new MemoryAdapter()
    await storage.writeText('assets/large.bin', '保留在本地')
    await synchronize({ storage, remote, deviceId: 'a', conflictPolicy: 'keep-both', attachmentsDir: 'assets' })
    const before = structuredClone(remote.manifest!.entries['assets/large.bin'])

    await synchronize({
      storage,
      remote,
      deviceId: 'a',
      conflictPolicy: 'keep-both',
      attachmentsDir: 'assets',
      attachmentPolicy: { enabled: false, maxSizeMb: 0, excludedExtensions: [] },
    })

    expect(remote.manifest!.entries['assets/large.bin']).toEqual(before)
    expect(await storage.exists('assets/large.bin')).toBe(true)
  })

  it('附件规则排除远端附件时不会下载到空设备', async () => {
    const remote = new FakeRemote()
    const source = new MemoryAdapter()
    await source.writeText('assets/photo.png', 'binary')
    await synchronize({ storage: source, remote, deviceId: 'a', conflictPolicy: 'keep-both', attachmentsDir: 'assets' })
    const target = new MemoryAdapter()

    await synchronize({
      storage: target,
      remote,
      deviceId: 'b',
      conflictPolicy: 'keep-both',
      attachmentsDir: 'assets',
      attachmentPolicy: { enabled: true, maxSizeMb: 0, excludedExtensions: ['png'] },
    })

    expect(await target.exists('assets/photo.png')).toBe(false)
  })

  it('重新启用附件规则后会继续下载此前跳过的附件', async () => {
    const remote = new FakeRemote()
    const source = new MemoryAdapter()
    const target = new MemoryAdapter()
    await source.writeText('assets/retry.mov', 'movie')
    await synchronize({ storage: source, remote, deviceId: 'a', conflictPolicy: 'keep-both', attachmentsDir: 'assets' })
    await synchronize({
      storage: target,
      remote,
      deviceId: 'b',
      conflictPolicy: 'keep-both',
      attachmentsDir: 'assets',
      attachmentPolicy: { enabled: false, maxSizeMb: 0, excludedExtensions: [] },
    })

    const result = await synchronize({ storage: target, remote, deviceId: 'b', conflictPolicy: 'keep-both', attachmentsDir: 'assets' })
    expect(result.downloaded).toBe(1)
    expect(await target.readText('assets/retry.mov')).toBe('movie')
  })

  it('拒绝远端清单中的非规范路径，避免写到意外位置', async () => {
    const remote = new FakeRemote()
    remote.manifest = {
      version: 1,
      updatedAt: 1,
      entries: {
        '../outside.md': { hash: 'a'.repeat(64), size: 1, vector: { bad: 1 }, deleted: false, modifiedAt: 1 },
      },
    }

    await expect(
      synchronize({ storage: new MemoryAdapter(), remote, deviceId: 'a', conflictPolicy: 'keep-both' }),
    ).rejects.toMatchObject({ code: 'INVALID_REMOTE' })
  })

  it.each(['.git/config', '.obsidian/plugins/x', 'node_modules/pkg/index.js', '.light-sync/private']) (
    '拒绝远端清单写入保留目录：%s',
    async (path) => {
      const remote = new FakeRemote()
      remote.manifest = {
        version: 1,
        updatedAt: 1,
        entries: {
          [path]: { hash: 'a'.repeat(64), size: 1, vector: { bad: 1 }, deleted: false, modifiedAt: 1 },
        },
      }
      const storage = new MemoryAdapter()

      await expect(
        synchronize({ storage, remote, deviceId: 'a', conflictPolicy: 'keep-both' }),
      ).rejects.toMatchObject({ code: 'INVALID_REMOTE' })
      expect(await storage.exists(path)).toBe(false)
    },
  )

  it('下载内容必须与清单中的 SHA-256 一致', async () => {
    const remote = new FakeRemote()
    const first = new MemoryAdapter()
    await first.writeText('笔记.md', '正确内容')
    await synchronize({ storage: first, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    const hash = remote.manifest!.entries['笔记.md']!.hash!
    remote.contents.set(hash, new TextEncoder().encode('被篡改'))

    await expect(
      synchronize({ storage: new MemoryAdapter(), remote, deviceId: 'b', conflictPolicy: 'keep-both' }),
    ).rejects.toMatchObject({ code: 'INVALID_REMOTE' })
  })

  it('远端清单被删除后重新发布本地快照，不会反向清空本地', async () => {
    const remote = new FakeRemote()
    const storage = new MemoryAdapter()
    await storage.writeText('保留.md', '不能丢')
    await synchronize({ storage, remote, deviceId: 'a', conflictPolicy: 'keep-both' })

    remote.manifest = null
    const rebuilt = await synchronize({ storage, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    expect(rebuilt.uploaded).toBe(1)
    expect(await storage.readText('保留.md')).toBe('不能丢')
    expect(remote.currentManifest()?.entries).toHaveProperty('保留.md')
  })

  it('已跟踪条目不能从远端清单直接消失，删除必须使用墓碑', async () => {
    const remote = new FakeRemote()
    const storage = new MemoryAdapter()
    await storage.writeText('保留.md', '内容')
    await synchronize({ storage, remote, deviceId: 'a', conflictPolicy: 'keep-both' })
    delete remote.manifest!.entries['保留.md']

    await expect(
      synchronize({ storage, remote, deviceId: 'a', conflictPolicy: 'keep-both' }),
    ).rejects.toMatchObject({ code: 'INVALID_REMOTE' })
    expect(await storage.readText('保留.md')).toBe('内容')
  })
})
