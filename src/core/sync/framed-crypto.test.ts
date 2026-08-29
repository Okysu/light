import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FRAME_PLAINTEXT_BYTES,
  decryptFramedStream,
  encryptFramedStream,
  framedCiphertextSize,
  FramedCryptoError,
} from './framed-crypto'

const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const objectId = '6f'.repeat(32)

describe('framed encryption v1', () => {
  it('默认使用 8 MiB 明文 frame', () => {
    expect(DEFAULT_FRAME_PLAINTEXT_BYTES).toBe(8 * 1024 * 1024)
    expect(framedCiphertextSize(0)).toBe(48n)
    expect(framedCiphertextSize(17, 8)).toBe(32n + 17n + 3n * 16n)
  })

  it('在任意输入和传输分块下往返多 frame 内容', async () => {
    const plaintext = Uint8Array.from({ length: 137 }, (_, index) => (index * 19) & 0xff)
    const encrypted = await collect(
      encryptFramedStream(chunks(plaintext, [1, 30, 2, 70, 34]), {
        key,
        objectId,
        totalPlaintextBytes: plaintext.byteLength,
        framePlaintextBytes: 32,
      }),
    )

    const decrypted = await collect(
      decryptFramedStream(chunks(encrypted, [3, 1, 17, 2, 51, 7]), { key, objectId }),
    )
    expect(decrypted).toEqual(plaintext)
  })

  it('支持空文件，并用一个认证标签保护空对象', async () => {
    const encrypted = await collect(
      encryptFramedStream(chunks(new Uint8Array(), []), {
        key,
        objectId,
        totalPlaintextBytes: 0,
        framePlaintextBytes: 16,
      }),
    )
    expect(encrypted.byteLength).toBe(32 + 16)
    await expect(
      collect(decryptFramedStream(chunks(encrypted, [5]), { key, objectId })),
    ).resolves.toEqual(new Uint8Array())
  })

  it('每个文件使用不同随机 nonce prefix', async () => {
    const plaintext = Uint8Array.of(1, 2, 3)
    const first = await collect(
      encryptFramedStream(chunks(plaintext, [3]), {
        key,
        objectId,
        totalPlaintextBytes: 3,
        framePlaintextBytes: 2,
      }),
    )
    const second = await collect(
      encryptFramedStream(chunks(plaintext, [3]), {
        key,
        objectId,
        totalPlaintextBytes: 3,
        framePlaintextBytes: 2,
      }),
    )
    expect(first.slice(22, 30)).not.toEqual(second.slice(22, 30))
    expect(first).not.toEqual(second)
  })

  it('错误 objectId 无法通过 AAD 认证，且正文不包含 objectId', async () => {
    const plaintext = new TextEncoder().encode(`payload-${objectId}`)
    const encrypted = await collect(
      encryptFramedStream(chunks(plaintext, [4]), {
        key,
        objectId,
        totalPlaintextBytes: plaintext.byteLength,
        framePlaintextBytes: 9,
      }),
    )
    expect(new TextDecoder().decode(encrypted)).not.toContain(objectId)
    await expectCryptoCode(
      collect(decryptFramedStream(chunks(encrypted, [11]), { key, objectId: 'wrong-id' })),
      'AUTHENTICATION_FAILED',
    )
  })

  it('密文、header 总大小和 header frame 大小篡改均 fail closed', async () => {
    const encrypted = await encryptedFixture()
    const ciphertextTampered = encrypted.slice()
    ciphertextTampered[40] = (ciphertextTampered[40] ?? 0) ^ 0x80
    await expectCryptoCode(
      collect(decryptFramedStream(chunks(ciphertextTampered, [9]), { key, objectId })),
      'AUTHENTICATION_FAILED',
    )

    const totalTampered = encrypted.slice()
    totalTampered[21] = (totalTampered[21] ?? 0) ^ 0x01
    await expectCryptoCode(
      collect(decryptFramedStream(chunks(totalTampered, [9]), { key, objectId })),
      'AUTHENTICATION_FAILED',
    )

    const frameSizeTampered = encrypted.slice()
    frameSizeTampered[13] = (frameSizeTampered[13] ?? 0) ^ 0x01
    await expectCryptoCode(
      collect(decryptFramedStream(chunks(frameSizeTampered, [9]), { key, objectId })),
      'AUTHENTICATION_FAILED',
    )
  })

  it('交换相同长度的 frame 会因 index nonce/AAD 不匹配而失败', async () => {
    const encrypted = await encryptedFixture()
    const first = encrypted.slice(32, 32 + 24)
    const second = encrypted.slice(32 + 24, 32 + 48)
    encrypted.set(second, 32)
    encrypted.set(first, 32 + 24)
    await expectCryptoCode(
      collect(decryptFramedStream(chunks(encrypted, [13]), { key, objectId })),
      'AUTHENTICATION_FAILED',
    )
  })

  it('拒绝 header/frame 截断和尾随数据', async () => {
    const encrypted = await encryptedFixture()
    await expectCryptoCode(
      collect(decryptFramedStream(chunks(encrypted.slice(0, 20), [20]), { key, objectId })),
      'TRUNCATED',
    )
    await expectCryptoCode(
      collect(decryptFramedStream(chunks(encrypted.slice(0, -1), [7]), { key, objectId })),
      'TRUNCATED',
    )
    const trailed = concat([encrypted, Uint8Array.of(0)])
    await expectCryptoCode(
      collect(decryptFramedStream(chunks(trailed, [19]), { key, objectId })),
      'INVALID_FORMAT',
    )
  })

  it('严格验证声明的明文总大小', async () => {
    await expectCryptoCode(
      collect(
        encryptFramedStream(chunks(Uint8Array.of(1, 2), [2]), {
          key,
          objectId,
          totalPlaintextBytes: 3,
          framePlaintextBytes: 2,
        }),
      ),
      'TRUNCATED',
    )
    await expectCryptoCode(
      collect(
        encryptFramedStream(chunks(Uint8Array.of(1, 2, 3), [3]), {
          key,
          objectId,
          totalPlaintextBytes: 2,
          framePlaintextBytes: 2,
        }),
      ),
      'SIZE_MISMATCH',
    )
  })

  it('加密在读完整个文件前即可产出首个 frame', async () => {
    let releaseSecond!: () => void
    const secondReady = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    let requestedSecond = false
    async function* source(): AsyncGenerator<Uint8Array> {
      yield Uint8Array.of(1, 2, 3, 4)
      requestedSecond = true
      await secondReady
      yield Uint8Array.of(5, 6, 7, 8)
    }
    const iterator = encryptFramedStream(source(), {
      key,
      objectId,
      totalPlaintextBytes: 8,
      framePlaintextBytes: 4,
    })[Symbol.asyncIterator]()

    expect((await iterator.next()).value?.byteLength).toBe(32)
    expect((await iterator.next()).value?.byteLength).toBe(4 + 16)
    expect(requestedSecond).toBe(false)
    releaseSecond()
    expect((await iterator.next()).value?.byteLength).toBe(4 + 16)
    await iterator.next()
  })

  it('加密和解密均响应 AbortSignal', async () => {
    const encryptController = new AbortController()
    encryptController.abort('stop')
    await expectCryptoCode(
      collect(
        encryptFramedStream(chunks(Uint8Array.of(1), [1]), {
          key,
          objectId,
          totalPlaintextBytes: 1,
          signal: encryptController.signal,
        }),
      ),
      'CANCELLED',
    )

    const encrypted = await encryptedFixture()
    const decryptController = new AbortController()
    async function* abortingSource(): AsyncGenerator<Uint8Array> {
      yield encrypted.slice(0, 32)
      decryptController.abort()
      yield encrypted.slice(32)
    }
    await expectCryptoCode(
      collect(
        decryptFramedStream(abortingSource(), {
          key,
          objectId,
          signal: decryptController.signal,
        }),
      ),
      'CANCELLED',
    )
  })
})

async function encryptedFixture(): Promise<Uint8Array> {
  const plaintext = Uint8Array.from({ length: 24 }, (_, index) => index)
  return collect(
    encryptFramedStream(chunks(plaintext, [3, 5, 16]), {
      key,
      objectId,
      totalPlaintextBytes: plaintext.byteLength,
      framePlaintextBytes: 8,
    }),
  )
}

async function* chunks(bytes: Uint8Array, sizes: number[]): AsyncGenerator<Uint8Array> {
  let offset = 0
  for (const size of sizes) {
    if (offset >= bytes.byteLength) break
    yield bytes.slice(offset, Math.min(offset + size, bytes.byteLength))
    offset += size
  }
  if (offset < bytes.byteLength) yield bytes.slice(offset)
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let length = 0
  for await (const part of source) {
    parts.push(part)
    length += part.byteLength
  }
  return concat(parts, length)
}

function concat(parts: Uint8Array[], knownLength?: number): Uint8Array {
  const output = new Uint8Array(
    knownLength ?? parts.reduce((length, part) => length + part.byteLength, 0),
  )
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

async function expectCryptoCode(
  promise: Promise<unknown>,
  code: FramedCryptoError['code'],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'FramedCryptoError', code })
}
