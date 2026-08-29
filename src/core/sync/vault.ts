import {
  ARGON2ID_PARAMETERS,
  SyncCryptoError,
  exportRecoveryKey,
  generateRecoveryKey,
  generateVaultKey,
  importRecoveryKey,
  unwrapVaultKeyWithPassword,
  unwrapVaultKeyWithRecoveryKey,
  wrapVaultKeyWithPassword,
  wrapVaultKeyWithRecoveryKey,
  type PasswordWrappedVaultKeyEnvelope,
  type RecoveryWrappedVaultKeyEnvelope,
} from './crypto'

const KEY_DOCUMENT_PURPOSE = 'light-sync-vault-key'
const KEY_DOCUMENT_ALGORITHM = 'Argon2id+AES-256-GCM'
const PASSWORD_WRAP_AAD = 'bGlnaHQtc3luYzp2MTp2YXVsdC1rZXk6cGFzc3dvcmQ'
const RECOVERY_WRAP_AAD = 'bGlnaHQtc3luYzp2MTp2YXVsdC1rZXk6cmVjb3Zlcnk'
const SALT_PATTERN = /^[A-Za-z0-9_-]{22}$/
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16}$/
const WRAPPED_KEY_PATTERN = /^[A-Za-z0-9_-]{64}$/

/**
 * 远端唯一受支持的 Vault key document 协议。
 *
 * 文档只含随机 salt、nonce 和经认证加密后的 Vault 密钥，不含密码、恢复密钥
 * 或 Vault 明文密钥。当前仍在开发期，initializeVault 的语义是创建一个全新的
 * Vault；调用方若已有 Light 远端协议数据，应显式执行破坏性重置并整体替换，
 * 不应把新文档当成旧 Vault 的迁移或兼容层。本模块本身不进行任何 S3 操作。
 */
export interface KeyDocument {
  version: 1
  purpose: 'light-sync-vault-key'
  algorithm: 'Argon2id+AES-256-GCM'
  passwordWrappedVaultKey: PasswordWrappedVaultKeyEnvelope
  recoveryWrappedVaultKey: RecoveryWrappedVaultKeyEnvelope
}

export interface InitializedVault {
  keyDoc: KeyDocument
  vaultKey: Uint8Array<ArrayBuffer>
  recoveryExport: string
}

/**
 * 创建一个全新且与任何旧状态无关的 Vault。
 *
 * recoveryKey 仅供测试或由调用方自备恢复材料时使用；省略时会安全随机生成。
 * 返回值只导出可供用户离线保存的恢复文本，KeyDocument 不保存恢复密钥本身。
 */
export async function initializeVault(
  password: string,
  recoveryKey?: Uint8Array,
): Promise<InitializedVault> {
  const vaultKey = generateVaultKey()
  const effectiveRecoveryKey = recoveryKey
    ? copyRecoveryKey(recoveryKey)
    : generateRecoveryKey()

  try {
    const [passwordWrappedVaultKey, recoveryWrappedVaultKey] = await Promise.all([
      wrapVaultKeyWithPassword(vaultKey, password),
      wrapVaultKeyWithRecoveryKey(vaultKey, effectiveRecoveryKey),
    ])
    return {
      keyDoc: {
        version: 1,
        purpose: KEY_DOCUMENT_PURPOSE,
        algorithm: KEY_DOCUMENT_ALGORITHM,
        passwordWrappedVaultKey,
        recoveryWrappedVaultKey,
      },
      vaultKey,
      recoveryExport: exportRecoveryKey(effectiveRecoveryKey),
    }
  } finally {
    effectiveRecoveryKey.fill(0)
  }
}

/** 使用密码严格校验并解锁 KeyDocument；任何未知协议字段都会 fail closed。 */
export async function unlockWithPassword(
  value: unknown,
  password: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const keyDoc = parseKeyDocument(value)
  return unwrapVaultKeyWithPassword(keyDoc.passwordWrappedVaultKey, password)
}

/** 使用离线恢复文本严格校验并解锁 KeyDocument。 */
export async function unlockWithRecovery(
  value: unknown,
  recoveryExport: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const keyDoc = parseKeyDocument(value)
  const recoveryKey = importRecoveryKey(recoveryExport)
  try {
    return await unwrapVaultKeyWithRecoveryKey(keyDoc.recoveryWrappedVaultKey, recoveryKey)
  } finally {
    recoveryKey.fill(0)
  }
}

/**
 * 对来自 S3/JSON 的未知值执行完整、封闭的 v1 schema 校验。
 * 未知字段同样被拒绝，避免调用方误以为未来或被篡改的语义已被理解。
 */
export function parseKeyDocument(value: unknown): KeyDocument {
  const document = expectRecord(value, 'Vault key document')
  expectExactKeys(document, [
    'algorithm',
    'passwordWrappedVaultKey',
    'purpose',
    'recoveryWrappedVaultKey',
    'version',
  ])
  if (
    document.version !== 1 ||
    document.purpose !== KEY_DOCUMENT_PURPOSE ||
    document.algorithm !== KEY_DOCUMENT_ALGORITHM
  ) {
    invalidDocument('Vault key document 的版本、用途或算法不受支持')
  }

  validatePasswordWrappedKey(document.passwordWrappedVaultKey)
  validateRecoveryWrappedKey(document.recoveryWrappedVaultKey)
  return document as unknown as KeyDocument
}

function validatePasswordWrappedKey(value: unknown): void {
  const envelope = expectRecord(value, 'passwordWrappedVaultKey')
  expectExactKeys(envelope, ['algorithm', 'parameters', 'purpose', 'version', 'wrappedKey'])
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== 'Argon2id+AES-256-GCM' ||
    envelope.purpose !== 'vault-key' ||
    !isEncoded(envelope.wrappedKey, WRAPPED_KEY_PATTERN)
  ) {
    invalidDocument('密码包装的 Vault 密钥无效')
  }

  const parameters = expectRecord(envelope.parameters, 'passwordWrappedVaultKey.parameters')
  expectExactKeys(parameters, ['cipher', 'kdf'])
  const kdf = expectRecord(parameters.kdf, 'passwordWrappedVaultKey.parameters.kdf')
  expectExactKeys(kdf, [
    'algorithm',
    'iterations',
    'memoryKiB',
    'outputBytes',
    'parallelism',
    'salt',
  ])
  if (
    kdf.algorithm !== 'Argon2id' ||
    !isEncoded(kdf.salt, SALT_PATTERN) ||
    kdf.memoryKiB !== ARGON2ID_PARAMETERS.memoryKiB ||
    kdf.iterations !== ARGON2ID_PARAMETERS.iterations ||
    kdf.parallelism !== ARGON2ID_PARAMETERS.parallelism ||
    kdf.outputBytes !== ARGON2ID_PARAMETERS.outputBytes
  ) {
    invalidDocument('Argon2id 参数无效或不受支持')
  }

  validateCipher(parameters.cipher, PASSWORD_WRAP_AAD, '密码包装')
}

function validateRecoveryWrappedKey(value: unknown): void {
  const envelope = expectRecord(value, 'recoveryWrappedVaultKey')
  expectExactKeys(envelope, ['algorithm', 'parameters', 'purpose', 'version', 'wrappedKey'])
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== 'AES-256-GCM' ||
    envelope.purpose !== 'vault-key-recovery' ||
    !isEncoded(envelope.wrappedKey, WRAPPED_KEY_PATTERN)
  ) {
    invalidDocument('恢复密钥包装的 Vault 密钥无效')
  }
  validateCipher(envelope.parameters, RECOVERY_WRAP_AAD, '恢复密钥包装', false)
}

function validateCipher(
  value: unknown,
  expectedAdditionalData: string,
  label: string,
  includesAlgorithm = true,
): void {
  const cipher = expectRecord(value, `${label}.cipher`)
  expectExactKeys(
    cipher,
    includesAlgorithm
      ? ['additionalData', 'algorithm', 'nonce', 'tagLength']
      : ['additionalData', 'nonce', 'tagLength'],
  )
  if (
    (includesAlgorithm && cipher.algorithm !== 'AES-256-GCM') ||
    !isEncoded(cipher.nonce, NONCE_PATTERN) ||
    cipher.tagLength !== 128 ||
    cipher.additionalData !== expectedAdditionalData
  ) {
    invalidDocument(`${label}的 AES-256-GCM 参数无效或不受支持`)
  }
}

function copyRecoveryKey(value: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
    throw new SyncCryptoError('恢复密钥必须恰好为 256 位', 'INVALID_INPUT')
  }
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength))
  copy.set(value)
  return copy
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidDocument(`${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function expectExactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    invalidDocument('Vault key document 包含缺失或未知字段')
  }
}

function isEncoded(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value)
}

function invalidDocument(message: string): never {
  throw new SyncCryptoError(message, 'INVALID_ENVELOPE')
}
