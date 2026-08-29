import { argon2id } from 'hash-wasm'

const VAULT_KEY_BYTES = 32
const ARGON2_SALT_BYTES = 16
const AES_GCM_NONCE_BYTES = 12
const AES_GCM_TAG_BITS = 128
const OBJECT_ID_DOMAIN = new TextEncoder().encode('light-sync-object-v1\0')
const PASSWORD_WRAP_AAD = new TextEncoder().encode('light-sync:v1:vault-key:password')
const RECOVERY_WRAP_AAD = new TextEncoder().encode('light-sync:v1:vault-key:recovery')
const RECOVERY_KEY_PREFIX = 'light-recovery:v1:aes-256-gcm:'
const SUBKEY_SALT = new TextEncoder().encode('light-sync:v1:hkdf-sha256')

export type VaultSubkeyPurpose = 'manifest-encryption' | 'content-encryption' | 'object-id'

/** RFC 9106 的内存受限推荐参数：64 MiB、3 轮、4 路并行。 */
export const ARGON2ID_PARAMETERS = {
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 4,
  outputBytes: VAULT_KEY_BYTES,
} as const

export interface EncryptedBytesEnvelope {
  version: 1
  algorithm: 'AES-256-GCM'
  parameters: {
    nonce: string
    tagLength: 128
    additionalData: string | null
  }
  ciphertext: string
}

export interface PasswordWrappedVaultKeyEnvelope {
  version: 1
  algorithm: 'Argon2id+AES-256-GCM'
  purpose: 'vault-key'
  parameters: {
    kdf: {
      algorithm: 'Argon2id'
      salt: string
      memoryKiB: 65536
      iterations: 3
      parallelism: 4
      outputBytes: 32
    }
    cipher: {
      algorithm: 'AES-256-GCM'
      nonce: string
      tagLength: 128
      additionalData: string
    }
  }
  wrappedKey: string
}

export interface RecoveryWrappedVaultKeyEnvelope {
  version: 1
  algorithm: 'AES-256-GCM'
  purpose: 'vault-key-recovery'
  parameters: {
    nonce: string
    tagLength: 128
    additionalData: string
  }
  wrappedKey: string
}

export type SyncCryptoErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_ENVELOPE'
  | 'AUTHENTICATION_FAILED'
  | 'UNSUPPORTED'

export class SyncCryptoError extends Error {
  constructor(
    message: string,
    readonly code: SyncCryptoErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'SyncCryptoError'
  }
}

/** 生成一个独立、随机的 256 位 Vault 主密钥。 */
export function generateVaultKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(VAULT_KEY_BYTES)
}

/** 生成用于新设备解锁 Vault 的独立 256 位恢复密钥。 */
export function generateRecoveryKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(VAULT_KEY_BYTES)
}

/** 从 Vault 根密钥派生用途隔离的 256-bit 子密钥，避免跨 AES/HMAC 直接复用根密钥。 */
export async function deriveVaultSubkey(
  vaultKey: Uint8Array,
  purpose: VaultSubkeyPurpose,
): Promise<Uint8Array<ArrayBuffer>> {
  assert256BitKey(vaultKey, 'Vault 密钥')
  if (purpose !== 'manifest-encryption' && purpose !== 'content-encryption' && purpose !== 'object-id') {
    throw new SyncCryptoError('Vault 子密钥用途无效', 'INVALID_INPUT')
  }
  try {
    const key = await webCrypto().subtle.importKey('raw', arrayBufferBytes(vaultKey), 'HKDF', false, ['deriveBits'])
    const bits = await webCrypto().subtle.deriveBits({
      name: 'HKDF',
      hash: 'SHA-256',
      salt: arrayBufferBytes(SUBKEY_SALT),
      info: new TextEncoder().encode(`light-sync:v1:${purpose}`),
    }, key, 256)
    return new Uint8Array(bits)
  } catch (cause) {
    throw new SyncCryptoError('HKDF-SHA256 子密钥派生失败', 'UNSUPPORTED', { cause })
  }
}

/**
 * 将恢复密钥导出为可离线保存的文本。
 *
 * 前缀显式固定协议版本和算法；正文采用无填充 base64url，避免复制时引入
 * `+`、`/` 等容易被转义的字符。
 */
export function exportRecoveryKey(recoveryKey: Uint8Array): string {
  assert256BitKey(recoveryKey, '恢复密钥')
  return `${RECOVERY_KEY_PREFIX}${toBase64Url(recoveryKey)}`
}

/** 严格导入由 {@link exportRecoveryKey} 产生的恢复密钥。 */
export function importRecoveryKey(value: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !value.startsWith(RECOVERY_KEY_PREFIX)) {
    throw new SyncCryptoError('恢复密钥格式或协议版本无效', 'INVALID_INPUT')
  }

  const key = decodeBase64Url(value.slice(RECOVERY_KEY_PREFIX.length), '恢复密钥', 'INVALID_INPUT')
  assert256BitKey(key, '恢复密钥')
  return key
}

/** 使用用户密码经 Argon2id 派生的 KEK 包装 Vault 主密钥。 */
export async function wrapVaultKeyWithPassword(
  vaultKey: Uint8Array,
  password: string,
): Promise<PasswordWrappedVaultKeyEnvelope> {
  assert256BitKey(vaultKey, 'Vault 密钥')
  assertPassword(password)

  const salt = randomBytes(ARGON2_SALT_BYTES)
  const kek = await derivePasswordKey(password, salt)
  try {
    const encrypted = await encryptBytes(vaultKey, kek, PASSWORD_WRAP_AAD)
    return {
      version: 1,
      algorithm: 'Argon2id+AES-256-GCM',
      purpose: 'vault-key',
      parameters: {
        kdf: {
          algorithm: 'Argon2id',
          salt: toBase64Url(salt),
          memoryKiB: ARGON2ID_PARAMETERS.memoryKiB,
          iterations: ARGON2ID_PARAMETERS.iterations,
          parallelism: ARGON2ID_PARAMETERS.parallelism,
          outputBytes: ARGON2ID_PARAMETERS.outputBytes,
        },
        cipher: {
          algorithm: 'AES-256-GCM',
          nonce: encrypted.parameters.nonce,
          tagLength: AES_GCM_TAG_BITS,
          additionalData: toBase64Url(PASSWORD_WRAP_AAD),
        },
      },
      wrappedKey: encrypted.ciphertext,
    }
  } finally {
    kek.fill(0)
  }
}

/** 使用密码解包 Vault 主密钥；密码错误或密文被篡改时只会失败，不会返回数据。 */
export async function unwrapVaultKeyWithPassword(
  envelope: unknown,
  password: string,
): Promise<Uint8Array<ArrayBuffer>> {
  assertPassword(password)
  const parsed = parsePasswordEnvelope(envelope)
  const salt = decodeBase64Url(parsed.parameters.kdf.salt, 'Argon2id salt', 'INVALID_ENVELOPE')
  if (salt.byteLength !== ARGON2_SALT_BYTES) invalidEnvelope('Argon2id salt 长度无效')

  const kek = await derivePasswordKey(password, salt)
  try {
    const vaultKey = await decryptBytes(
      {
        version: 1,
        algorithm: 'AES-256-GCM',
        parameters: {
          nonce: parsed.parameters.cipher.nonce,
          tagLength: AES_GCM_TAG_BITS,
          additionalData: parsed.parameters.cipher.additionalData,
        },
        ciphertext: parsed.wrappedKey,
      },
      kek,
      PASSWORD_WRAP_AAD,
    )
    assertUnwrappedVaultKey(vaultKey)
    return vaultKey
  } finally {
    kek.fill(0)
  }
}

/** 用独立恢复密钥包装 Vault 主密钥，供无密码的新设备恢复。 */
export async function wrapVaultKeyWithRecoveryKey(
  vaultKey: Uint8Array,
  recoveryKey: Uint8Array,
): Promise<RecoveryWrappedVaultKeyEnvelope> {
  assert256BitKey(vaultKey, 'Vault 密钥')
  assert256BitKey(recoveryKey, '恢复密钥')
  const encrypted = await encryptBytes(vaultKey, recoveryKey, RECOVERY_WRAP_AAD)
  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    purpose: 'vault-key-recovery',
    parameters: {
      nonce: encrypted.parameters.nonce,
      tagLength: AES_GCM_TAG_BITS,
      additionalData: toBase64Url(RECOVERY_WRAP_AAD),
    },
    wrappedKey: encrypted.ciphertext,
  }
}

/** 使用恢复密钥解包 Vault 主密钥。 */
export async function unwrapVaultKeyWithRecoveryKey(
  envelope: unknown,
  recoveryKey: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  assert256BitKey(recoveryKey, '恢复密钥')
  const parsed = parseRecoveryEnvelope(envelope)
  const vaultKey = await decryptBytes(
    {
      version: 1,
      algorithm: 'AES-256-GCM',
      parameters: {
        nonce: parsed.parameters.nonce,
        tagLength: AES_GCM_TAG_BITS,
        additionalData: parsed.parameters.additionalData,
      },
      ciphertext: parsed.wrappedKey,
    },
    recoveryKey,
    RECOVERY_WRAP_AAD,
  )
  assertUnwrappedVaultKey(vaultKey)
  return vaultKey
}

/** 使用 AES-256-GCM 加密任意字节；每次调用都会生成独立 96 位 nonce。 */
export async function encryptBytes(
  plaintext: Uint8Array,
  key: Uint8Array,
  additionalData?: Uint8Array,
): Promise<EncryptedBytesEnvelope> {
  assert256BitKey(key, '加密密钥')
  assertBytes(plaintext, '明文')
  if (additionalData !== undefined) assertBytes(additionalData, '附加认证数据')

  const nonce = randomBytes(AES_GCM_NONCE_BYTES)
  const cryptoKey = await importAesKey(key, ['encrypt'])
  const parameters: AesGcmParams = {
    name: 'AES-GCM',
    iv: arrayBufferBytes(nonce),
    tagLength: AES_GCM_TAG_BITS,
  }
  if (additionalData !== undefined) parameters.additionalData = arrayBufferBytes(additionalData)

  try {
    const ciphertext = await webCrypto().subtle.encrypt(
      parameters,
      cryptoKey,
      arrayBufferBytes(plaintext),
    )
    return {
      version: 1,
      algorithm: 'AES-256-GCM',
      parameters: {
        nonce: toBase64Url(nonce),
        tagLength: AES_GCM_TAG_BITS,
        additionalData: additionalData === undefined ? null : toBase64Url(additionalData),
      },
      ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    }
  } catch (cause) {
    throw new SyncCryptoError('AES-256-GCM 加密失败', 'UNSUPPORTED', { cause })
  }
}

/**
 * 解密并验证 AES-256-GCM envelope。
 *
 * 若传入 expectedAdditionalData，会先验证 envelope 的上下文，再交给 GCM 验证；
 * 错误密钥、nonce、AAD、认证标签或密文一律 fail closed。
 */
export async function decryptBytes(
  envelope: unknown,
  key: Uint8Array,
  expectedAdditionalData?: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  assert256BitKey(key, '解密密钥')
  if (expectedAdditionalData !== undefined) assertBytes(expectedAdditionalData, '附加认证数据')
  const parsed = parseEncryptedBytesEnvelope(envelope)
  const nonce = decodeBase64Url(parsed.parameters.nonce, 'AES-GCM nonce', 'INVALID_ENVELOPE')
  if (nonce.byteLength !== AES_GCM_NONCE_BYTES) invalidEnvelope('AES-GCM nonce 长度无效')

  const additionalData =
    parsed.parameters.additionalData === null
      ? undefined
      : decodeBase64Url(
          parsed.parameters.additionalData,
          'AES-GCM additionalData',
          'INVALID_ENVELOPE',
          true,
        )
  if (
    expectedAdditionalData !== undefined &&
    (additionalData === undefined || !equalBytes(additionalData, expectedAdditionalData))
  ) {
    invalidEnvelope('AES-GCM 附加认证数据与预期上下文不一致')
  }

  const ciphertext = decodeBase64Url(
    parsed.ciphertext,
    'AES-GCM ciphertext',
    'INVALID_ENVELOPE',
  )
  if (ciphertext.byteLength < AES_GCM_TAG_BITS / 8) invalidEnvelope('AES-GCM 密文长度无效')

  const cryptoKey = await importAesKey(key, ['decrypt'])
  const parameters: AesGcmParams = {
    name: 'AES-GCM',
    iv: arrayBufferBytes(nonce),
    tagLength: AES_GCM_TAG_BITS,
  }
  if (additionalData !== undefined) parameters.additionalData = arrayBufferBytes(additionalData)

  try {
    const plaintext = await webCrypto().subtle.decrypt(
      parameters,
      cryptoKey,
      arrayBufferBytes(ciphertext),
    )
    return new Uint8Array(plaintext)
  } catch (cause) {
    throw new SyncCryptoError(
      '密钥错误，或加密内容的完整性验证失败',
      'AUTHENTICATION_FAILED',
      { cause },
    )
  }
}

/**
 * 生成不泄露明文内容的确定性对象 ID。
 *
 * HMAC 输入带固定协议域分隔符，返回 64 字符小写十六进制 SHA-256 摘要。
 */
export async function keyedObjectId(
  vaultKey: Uint8Array,
  contents: Uint8Array,
): Promise<string> {
  assert256BitKey(vaultKey, 'Vault 密钥')
  assertBytes(contents, '对象内容')
  const hmacKey = await webCrypto().subtle.importKey(
    'raw',
    arrayBufferBytes(vaultKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const input = new Uint8Array(OBJECT_ID_DOMAIN.byteLength + contents.byteLength)
  input.set(OBJECT_ID_DOMAIN)
  input.set(contents, OBJECT_ID_DOMAIN.byteLength)
  const digest = await webCrypto().subtle.sign('HMAC', hmacKey, input)
  return toHex(new Uint8Array(digest))
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const derived = await argon2id({
      password,
      salt,
      iterations: ARGON2ID_PARAMETERS.iterations,
      parallelism: ARGON2ID_PARAMETERS.parallelism,
      memorySize: ARGON2ID_PARAMETERS.memoryKiB,
      hashLength: ARGON2ID_PARAMETERS.outputBytes,
      outputType: 'binary',
    })
    return arrayBufferBytes(derived)
  } catch (cause) {
    throw new SyncCryptoError('Argon2id 密钥派生失败', 'UNSUPPORTED', { cause })
  }
}

async function importAesKey(
  key: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  try {
    return await webCrypto().subtle.importKey(
      'raw',
      arrayBufferBytes(key),
      { name: 'AES-GCM', length: 256 },
      false,
      usages,
    )
  } catch (cause) {
    throw new SyncCryptoError('AES-256-GCM 在当前环境不可用', 'UNSUPPORTED', { cause })
  }
}

function parseEncryptedBytesEnvelope(value: unknown): EncryptedBytesEnvelope {
  if (!isRecord(value) || value.version !== 1 || value.algorithm !== 'AES-256-GCM') {
    invalidEnvelope('加密内容的协议版本或算法无效')
  }
  if (!isRecord(value.parameters)) invalidEnvelope('AES-GCM 参数无效')
  if (
    typeof value.parameters.nonce !== 'string' ||
    value.parameters.tagLength !== AES_GCM_TAG_BITS ||
    (value.parameters.additionalData !== null &&
      typeof value.parameters.additionalData !== 'string') ||
    typeof value.ciphertext !== 'string'
  ) {
    invalidEnvelope('AES-GCM envelope 字段无效')
  }
  return value as unknown as EncryptedBytesEnvelope
}

function parsePasswordEnvelope(value: unknown): PasswordWrappedVaultKeyEnvelope {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.algorithm !== 'Argon2id+AES-256-GCM' ||
    value.purpose !== 'vault-key' ||
    !isRecord(value.parameters) ||
    !isRecord(value.parameters.kdf) ||
    !isRecord(value.parameters.cipher)
  ) {
    invalidEnvelope('密码包装的 Vault 密钥 envelope 无效')
  }
  const kdf = value.parameters.kdf
  const cipher = value.parameters.cipher
  if (
    kdf.algorithm !== 'Argon2id' ||
    typeof kdf.salt !== 'string' ||
    kdf.memoryKiB !== ARGON2ID_PARAMETERS.memoryKiB ||
    kdf.iterations !== ARGON2ID_PARAMETERS.iterations ||
    kdf.parallelism !== ARGON2ID_PARAMETERS.parallelism ||
    kdf.outputBytes !== ARGON2ID_PARAMETERS.outputBytes ||
    cipher.algorithm !== 'AES-256-GCM' ||
    typeof cipher.nonce !== 'string' ||
    cipher.tagLength !== AES_GCM_TAG_BITS ||
    cipher.additionalData !== toBase64Url(PASSWORD_WRAP_AAD) ||
    typeof value.wrappedKey !== 'string'
  ) {
    invalidEnvelope('密码包装参数无效或不受支持')
  }
  return value as unknown as PasswordWrappedVaultKeyEnvelope
}

function parseRecoveryEnvelope(value: unknown): RecoveryWrappedVaultKeyEnvelope {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.algorithm !== 'AES-256-GCM' ||
    value.purpose !== 'vault-key-recovery' ||
    !isRecord(value.parameters) ||
    typeof value.parameters.nonce !== 'string' ||
    value.parameters.tagLength !== AES_GCM_TAG_BITS ||
    value.parameters.additionalData !== toBase64Url(RECOVERY_WRAP_AAD) ||
    typeof value.wrappedKey !== 'string'
  ) {
    invalidEnvelope('恢复密钥包装的 Vault 密钥 envelope 无效')
  }
  return value as unknown as RecoveryWrappedVaultKeyEnvelope
}

function assertPassword(password: string): void {
  if (typeof password !== 'string' || password.length === 0) {
    throw new SyncCryptoError('密码不能为空', 'INVALID_INPUT')
  }
}

function assert256BitKey(key: Uint8Array, label: string): void {
  assertBytes(key, label)
  if (key.byteLength !== VAULT_KEY_BYTES) {
    throw new SyncCryptoError(`${label}必须恰好为 256 位`, 'INVALID_INPUT')
  }
}

function assertUnwrappedVaultKey(key: Uint8Array): void {
  if (key.byteLength !== VAULT_KEY_BYTES) {
    throw new SyncCryptoError('解包结果不是有效的 256 位 Vault 密钥', 'INVALID_ENVELOPE')
  }
}

function assertBytes(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new SyncCryptoError(`${label}必须是 Uint8Array`, 'INVALID_INPUT')
  }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(new ArrayBuffer(length))
  try {
    webCrypto().getRandomValues(output)
    return output
  } catch (cause) {
    throw new SyncCryptoError('安全随机数生成器不可用', 'UNSUPPORTED', { cause })
  }
}

function webCrypto(): Crypto {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    throw new SyncCryptoError('WebCrypto 在当前环境不可用', 'UNSUPPORTED')
  }
  return globalThis.crypto
}

function arrayBufferBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(new ArrayBuffer(value.byteLength))
  output.set(value)
  return output
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(
  value: string,
  label: string,
  code: Extract<SyncCryptoErrorCode, 'INVALID_INPUT' | 'INVALID_ENVELOPE'>,
  allowEmpty = false,
): Uint8Array<ArrayBuffer> {
  if (allowEmpty && value === '') return new Uint8Array(new ArrayBuffer(0))
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length % 4 === 1
  ) {
    throw new SyncCryptoError(`${label} 的 base64url 编码无效`, code)
  }
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
    const binary = atob(padded)
    const output = new Uint8Array(new ArrayBuffer(binary.length))
    for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index)
    if (toBase64Url(output) !== value) throw new Error('non-canonical base64url')
    return output
  } catch (cause) {
    throw new SyncCryptoError(`${label} 的 base64url 编码无效`, code, { cause })
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

function toHex(bytes: Uint8Array): string {
  let output = ''
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0')
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function invalidEnvelope(message: string): never {
  throw new SyncCryptoError(message, 'INVALID_ENVELOPE')
}
