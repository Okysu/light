const MAGIC = new TextEncoder().encode('LIGHTFRM')
const HEADER_BYTES = 32
const NONCE_PREFIX_BYTES = 8
const NONCE_BYTES = 12
const TAG_BYTES = 16
const AES_KEY_BYTES = 32
const ALGORITHM_AES_256_GCM = 1
const MAX_UINT32 = 0xffff_ffff
const MAX_UINT64 = 0xffff_ffff_ffff_ffffn
const AAD_DOMAIN = new TextEncoder().encode('light-sync-framed:v1\0')

export const FRAMED_CRYPTO_VERSION = 1 as const
export const DEFAULT_FRAME_PLAINTEXT_BYTES = 8 * 1024 * 1024

export type FramedCryptoErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_FORMAT'
  | 'AUTHENTICATION_FAILED'
  | 'TRUNCATED'
  | 'SIZE_MISMATCH'
  | 'CANCELLED'
  | 'UNSUPPORTED'

export class FramedCryptoError extends Error {
  constructor(
    message: string,
    readonly code: FramedCryptoErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'FramedCryptoError'
  }
}

export interface EncryptFramedStreamOptions {
  key: Uint8Array
  /** HMAC-SHA256 产生的对象 ID；它只进入 AAD，不写入对象正文。 */
  objectId: string
  totalPlaintextBytes: number | bigint
  /** 生产环境默认固定为 8 MiB；参数化仅用于测试和受控调用。 */
  framePlaintextBytes?: number
  /** 断点续传时由受信的本机 journal 恢复；新上传省略则安全随机生成。 */
  noncePrefix?: Uint8Array
  signal?: AbortSignal
}

export interface DecryptFramedStreamOptions {
  key: Uint8Array
  /** 调用方从 manifest 取得的对象 ID。正文不携带对象 ID。 */
  objectId: string
  signal?: AbortSignal
}

/** 计算完整加密对象长度，供 S3 Content-Length / multipart 规划使用。 */
export function framedCiphertextSize(
  totalPlaintextBytes: number | bigint,
  framePlaintextBytes = DEFAULT_FRAME_PLAINTEXT_BYTES,
): bigint {
  const totalSize = validateTotalSize(totalPlaintextBytes)
  const frameSize = validateFrameSize(framePlaintextBytes)
  return BigInt(HEADER_BYTES) + totalSize + BigInt(calculateFrameCount(totalSize, frameSize) * TAG_BYTES)
}

/**
 * 将任意粒度的字节流加密为 Light framed encryption v1。
 *
 * 每个 frame 独立使用 AES-256-GCM 验证，内存上限为一个明文 frame 加一个
 * 密文 frame。调用方必须提供总明文大小，以便每个 frame 的 AAD 都认证它。
 */
export async function* encryptFramedStream(
  source: AsyncIterable<Uint8Array>,
  options: EncryptFramedStreamOptions,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const key = validateKey(options.key)
  const objectIdBytes = validateObjectId(options.objectId)
  const totalSize = validateTotalSize(options.totalPlaintextBytes)
  const frameSize = validateFrameSize(
    options.framePlaintextBytes ?? DEFAULT_FRAME_PLAINTEXT_BYTES,
  )
  const frameCount = calculateFrameCount(totalSize, frameSize)
  const noncePrefix = options.noncePrefix === undefined
    ? randomBytes(NONCE_PREFIX_BYTES)
    : validateNoncePrefix(options.noncePrefix)
  const cryptoKey = await importAesKey(key, ['encrypt'])
  const reader = new AsyncByteReader(source, options.signal)

  throwIfAborted(options.signal)
  yield encodeHeader(frameSize, totalSize, noncePrefix)

  let remaining = totalSize
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    throwIfAborted(options.signal)
    const plaintextBytes =
      totalSize === 0n ? 0 : Number(remaining > BigInt(frameSize) ? BigInt(frameSize) : remaining)
    const plaintext = await reader.readExactly(plaintextBytes, '明文流早于声明大小结束')
    const nonce = makeNonce(noncePrefix, frameIndex)
    const additionalData = makeAdditionalData(
      objectIdBytes,
      frameIndex,
      frameSize,
      totalSize,
    )
    let ciphertext: ArrayBuffer
    try {
      ciphertext = await webCrypto().subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: nonce,
          additionalData,
          tagLength: 128,
        },
        cryptoKey,
        plaintext,
      )
    } catch (cause) {
      throw new FramedCryptoError('AES-256-GCM frame 加密失败', 'UNSUPPORTED', { cause })
    }
    throwIfAborted(options.signal)
    yield new Uint8Array(ciphertext)
    remaining -= BigInt(plaintextBytes)
  }

  if (await reader.hasMore()) {
    throw new FramedCryptoError('明文流长于声明的总大小', 'SIZE_MISMATCH')
  }
}

function validateNoncePrefix(value: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array) || value.byteLength !== NONCE_PREFIX_BYTES) {
    throw new FramedCryptoError('nonce prefix 必须恰好为 64 位', 'INVALID_INPUT')
  }
  return copyBytes(value)
}

/**
 * 解密 Light framed encryption v1。
 *
 * 仅在当前 frame 的 GCM 标签验证通过后才产出该 frame；截断、乱序、篡改、
 * 错误 objectId 和尾随数据都会抛错，不会产出未经认证的字节。
 */
export async function* decryptFramedStream(
  source: AsyncIterable<Uint8Array>,
  options: DecryptFramedStreamOptions,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const key = validateKey(options.key)
  const objectIdBytes = validateObjectId(options.objectId)
  const reader = new AsyncByteReader(source, options.signal)
  const headerBytes = await reader.readExactly(HEADER_BYTES, '加密对象头已截断')
  const header = decodeHeader(headerBytes)
  const frameCount = calculateFrameCount(header.totalSize, header.frameSize)
  const cryptoKey = await importAesKey(key, ['decrypt'])

  let remaining = header.totalSize
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    throwIfAborted(options.signal)
    const plaintextBytes =
      header.totalSize === 0n
        ? 0
        : Number(
            remaining > BigInt(header.frameSize) ? BigInt(header.frameSize) : remaining,
          )
    const ciphertext = await reader.readExactly(
      plaintextBytes + TAG_BYTES,
      `加密对象的第 ${frameIndex} 个 frame 已截断`,
    )
    const nonce = makeNonce(header.noncePrefix, frameIndex)
    const additionalData = makeAdditionalData(
      objectIdBytes,
      frameIndex,
      header.frameSize,
      header.totalSize,
    )
    let plaintext: ArrayBuffer
    try {
      plaintext = await webCrypto().subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: nonce,
          additionalData,
          tagLength: 128,
        },
        cryptoKey,
        ciphertext,
      )
    } catch (cause) {
      throw new FramedCryptoError(
        `第 ${frameIndex} 个 frame 的完整性验证失败`,
        'AUTHENTICATION_FAILED',
        { cause },
      )
    }
    throwIfAborted(options.signal)
    yield new Uint8Array(plaintext)
    remaining -= BigInt(plaintextBytes)
  }

  if (await reader.hasMore()) {
    throw new FramedCryptoError('加密对象包含未认证的尾随数据', 'INVALID_FORMAT')
  }
}

interface DecodedHeader {
  frameSize: number
  totalSize: bigint
  noncePrefix: Uint8Array<ArrayBuffer>
}

function encodeHeader(
  frameSize: number,
  totalSize: bigint,
  noncePrefix: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(HEADER_BYTES))
  bytes.set(MAGIC, 0)
  bytes[8] = FRAMED_CRYPTO_VERSION
  bytes[9] = ALGORITHM_AES_256_GCM
  const view = new DataView(bytes.buffer)
  view.setUint32(10, frameSize, false)
  view.setBigUint64(14, totalSize, false)
  bytes.set(noncePrefix, 22)
  // 30..31 固定保留为 0；解密端严格检查，避免协议被宽松扩展。
  return bytes
}

function decodeHeader(bytes: Uint8Array<ArrayBuffer>): DecodedHeader {
  if (!equalBytes(bytes.subarray(0, MAGIC.byteLength), MAGIC)) {
    throw new FramedCryptoError('加密对象 magic 无效', 'INVALID_FORMAT')
  }
  if (bytes[8] !== FRAMED_CRYPTO_VERSION) {
    throw new FramedCryptoError('不支持的 framed encryption 协议版本', 'INVALID_FORMAT')
  }
  if (bytes[9] !== ALGORITHM_AES_256_GCM) {
    throw new FramedCryptoError('不支持的 framed encryption 算法', 'INVALID_FORMAT')
  }
  if (bytes[30] !== 0 || bytes[31] !== 0) {
    throw new FramedCryptoError('加密对象头的保留字段无效', 'INVALID_FORMAT')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const frameSize = validateFrameSize(view.getUint32(10, false))
  const totalSize = view.getBigUint64(14, false)
  calculateFrameCount(totalSize, frameSize)
  return {
    frameSize,
    totalSize,
    noncePrefix: copyBytes(bytes.subarray(22, 30)),
  }
}

function makeNonce(prefix: Uint8Array, frameIndex: number): Uint8Array<ArrayBuffer> {
  const nonce = new Uint8Array(new ArrayBuffer(NONCE_BYTES))
  nonce.set(prefix, 0)
  new DataView(nonce.buffer).setUint32(NONCE_PREFIX_BYTES, frameIndex, false)
  return nonce
}

function makeAdditionalData(
  objectId: Uint8Array,
  frameIndex: number,
  frameSize: number,
  totalSize: bigint,
): Uint8Array<ArrayBuffer> {
  // AAD 不写入对象；明确的长度和域分隔避免不同字段拼接产生歧义。
  const bytes = new Uint8Array(
    new ArrayBuffer(AAD_DOMAIN.byteLength + 2 + objectId.byteLength + 1 + 4 + 4 + 8),
  )
  let offset = 0
  bytes.set(AAD_DOMAIN, offset)
  offset += AAD_DOMAIN.byteLength
  const view = new DataView(bytes.buffer)
  view.setUint16(offset, objectId.byteLength, false)
  offset += 2
  bytes.set(objectId, offset)
  offset += objectId.byteLength
  bytes[offset] = FRAMED_CRYPTO_VERSION
  offset += 1
  view.setUint32(offset, frameIndex, false)
  offset += 4
  view.setUint32(offset, frameSize, false)
  offset += 4
  view.setBigUint64(offset, totalSize, false)
  return bytes
}

function calculateFrameCount(totalSize: bigint, frameSize: number): number {
  const count = totalSize === 0n ? 1n : (totalSize + BigInt(frameSize) - 1n) / BigInt(frameSize)
  if (count > BigInt(MAX_UINT32) + 1n) {
    throw new FramedCryptoError('对象过大，frame index 将超出 32 位 nonce 空间', 'INVALID_INPUT')
  }
  return Number(count)
}

function validateKey(value: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array) || value.byteLength !== AES_KEY_BYTES) {
    throw new FramedCryptoError('加密密钥必须恰好为 256 位', 'INVALID_INPUT')
  }
  return copyBytes(value)
}

function validateObjectId(value: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FramedCryptoError('objectId 不能为空', 'INVALID_INPUT')
  }
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength > 0xffff) {
    throw new FramedCryptoError('objectId 过长', 'INVALID_INPUT')
  }
  return copyBytes(bytes)
}

function validateTotalSize(value: number | bigint): bigint {
  let size: bigint
  if (typeof value === 'bigint') {
    size = value
  } else if (Number.isSafeInteger(value)) {
    size = BigInt(value)
  } else {
    throw new FramedCryptoError('总明文大小必须是安全整数或 bigint', 'INVALID_INPUT')
  }
  if (size < 0n || size > MAX_UINT64) {
    throw new FramedCryptoError('总明文大小超出 uint64 范围', 'INVALID_INPUT')
  }
  return size
}

function validateFrameSize(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > DEFAULT_FRAME_PLAINTEXT_BYTES) {
    throw new FramedCryptoError('frame 明文大小无效', 'INVALID_INPUT')
  }
  return value
}

async function importAesKey(
  key: Uint8Array<ArrayBuffer>,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  try {
    return await webCrypto().subtle.importKey('raw', key, { name: 'AES-GCM' }, false, usages)
  } catch (cause) {
    throw new FramedCryptoError('AES-256-GCM 在当前环境不可用', 'UNSUPPORTED', { cause })
  }
}

class AsyncByteReader {
  private readonly iterator: AsyncIterator<Uint8Array>
  private current: Uint8Array | undefined
  private currentOffset = 0
  private ended = false

  constructor(source: AsyncIterable<Uint8Array>, private readonly signal?: AbortSignal) {
    if (!source || typeof source[Symbol.asyncIterator] !== 'function') {
      throw new FramedCryptoError('输入必须是 AsyncIterable<Uint8Array>', 'INVALID_INPUT')
    }
    this.iterator = source[Symbol.asyncIterator]()
  }

  async readExactly(length: number, truncatedMessage: string): Promise<Uint8Array<ArrayBuffer>> {
    const output = new Uint8Array(new ArrayBuffer(length))
    let written = 0
    while (written < length) {
      if (!(await this.ensureCurrent())) {
        throw new FramedCryptoError(truncatedMessage, 'TRUNCATED')
      }
      const current = this.current!
      const count = Math.min(length - written, current.byteLength - this.currentOffset)
      output.set(current.subarray(this.currentOffset, this.currentOffset + count), written)
      written += count
      this.currentOffset += count
    }
    return output
  }

  async hasMore(): Promise<boolean> {
    return this.ensureCurrent()
  }

  private async ensureCurrent(): Promise<boolean> {
    while (!this.ended && (!this.current || this.currentOffset >= this.current.byteLength)) {
      throwIfAborted(this.signal)
      const next = await this.iterator.next()
      throwIfAborted(this.signal)
      if (next.done) {
        this.ended = true
        this.current = undefined
        return false
      }
      if (!(next.value instanceof Uint8Array)) {
        throw new FramedCryptoError('输入流只能产出 Uint8Array', 'INVALID_INPUT')
      }
      // 空 chunk 合法；跳过以防 hasMore 将其误判为数据。
      if (next.value.byteLength === 0) continue
      this.current = next.value
      this.currentOffset = 0
    }
    return !this.ended
  }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length))
  try {
    webCrypto().getRandomValues(bytes)
    return bytes
  } catch (cause) {
    throw new FramedCryptoError('安全随机数生成器不可用', 'UNSUPPORTED', { cause })
  }
}

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new FramedCryptoError('WebCrypto 在当前环境不可用', 'UNSUPPORTED')
  }
  return globalThis.crypto
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new FramedCryptoError('操作已取消', 'CANCELLED', { cause: signal.reason })
  }
}

function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength))
  bytes.set(value)
  return bytes
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}
