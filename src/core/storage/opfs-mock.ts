/**
 * OPFS 的内存模拟，**仅供测试使用**。
 *
 * jsdom 不提供 Origin Private File System，导致 `OpfsAdapter` 长期没有测试覆盖——
 * 「文件夹无法删除」那个缺陷正是从这个盲区里漏出去的：
 * 真实 OPFS 对目录调用 `getFileHandle` 会抛 `TypeMismatchError` 而非 `NotFoundError`，
 * 而适配器只放行了后者。
 *
 * 因此这个模拟的重点不是「能读能写」，而是**精确复刻规范里的错误类型**：
 * 类型不匹配、路径不存在、删除非空目录，三者各自抛什么 DOMException。
 * 错误语义不对的 mock 只会制造虚假的安全感。
 */

type Entry = MockDirectoryHandle | MockFileHandle

function domException(name: string, message: string): DOMException {
  return new DOMException(message, name)
}

export class MockFileHandle {
  readonly kind = 'file' as const
  data = new Uint8Array()
  lastModified = 0

  constructor(
    readonly name: string,
    private readonly clock: () => number,
  ) {}

  async getFile(): Promise<{
    size: number
    lastModified: number
    text: () => Promise<string>
    arrayBuffer: () => Promise<ArrayBuffer>
  }> {
    const bytes = this.data
    return {
      size: bytes.byteLength,
      lastModified: this.lastModified,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.slice().buffer,
    }
  }

  async createWritable(): Promise<{ write: (chunk: unknown) => Promise<void>; close: () => Promise<void> }> {
    let pending = new Uint8Array()
    return {
      write: async (chunk: unknown) => {
        pending =
          typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk as Uint8Array)
      },
      close: async () => {
        this.data = pending
        this.lastModified = this.clock()
      },
    }
  }
}

export class MockDirectoryHandle {
  readonly kind = 'directory' as const
  private readonly children = new Map<string, Entry>()

  constructor(
    readonly name: string,
    private readonly clock: () => number = () => 0,
  ) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MockDirectoryHandle> {
    const existing = this.children.get(name)
    if (existing) {
      // 目标是文件时，规范要求抛 TypeMismatchError
      if (existing.kind !== 'directory') throw domException('TypeMismatchError', name)
      return existing
    }
    if (!options?.create) throw domException('NotFoundError', name)

    const created = new MockDirectoryHandle(name, this.clock)
    this.children.set(name, created)
    return created
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFileHandle> {
    const existing = this.children.get(name)
    if (existing) {
      // 目标是目录时同样抛 TypeMismatchError——正是这条语义暴露了适配器的缺陷
      if (existing.kind !== 'file') throw domException('TypeMismatchError', name)
      return existing
    }
    if (!options?.create) throw domException('NotFoundError', name)

    const created = new MockFileHandle(name, this.clock)
    this.children.set(name, created)
    return created
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const existing = this.children.get(name)
    if (!existing) throw domException('NotFoundError', name)

    if (existing.kind === 'directory' && !options?.recursive && existing.size > 0) {
      throw domException('InvalidModificationError', name)
    }
    this.children.delete(name)
  }

  async *entries(): AsyncIterableIterator<[string, Entry]> {
    for (const [name, handle] of [...this.children]) yield [name, handle]
  }

  get size(): number {
    return this.children.size
  }
}

/**
 * 装上模拟的 `navigator.storage.getDirectory`，返回卸载函数。
 * 每个用例独立一棵树，避免相互串数据。
 */
export function installMockOpfs(clock: () => number = () => 0): {
  root: MockDirectoryHandle
  uninstall: () => void
} {
  const root = new MockDirectoryHandle('', clock)
  const previous = Reflect.get(globalThis, 'navigator')

  Reflect.set(globalThis, 'navigator', {
    ...(previous ?? {}),
    storage: { getDirectory: async () => root },
  })

  return {
    root,
    uninstall: () => Reflect.set(globalThis, 'navigator', previous),
  }
}
