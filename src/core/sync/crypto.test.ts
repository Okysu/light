import { describe, expect, it } from 'vitest'
import {
  ARGON2ID_PARAMETERS,
  SyncCryptoError,
  decryptBytes,
  deriveVaultSubkey,
  encryptBytes,
  exportRecoveryKey,
  generateRecoveryKey,
  generateVaultKey,
  importRecoveryKey,
  keyedObjectId,
  unwrapVaultKeyWithPassword,
  unwrapVaultKeyWithRecoveryKey,
  wrapVaultKeyWithPassword,
  wrapVaultKeyWithRecoveryKey,
} from './crypto'

const encoder = new TextEncoder()

describe('S3 E2EE 密码学核心', () => {
  it('以 HKDF 为 manifest、内容和对象 ID 派生稳定且彼此不同的子密钥', async () => {
    const root = generateVaultKey()
    const manifest = await deriveVaultSubkey(root, 'manifest-encryption')
    const content = await deriveVaultSubkey(root, 'content-encryption')
    const objectId = await deriveVaultSubkey(root, 'object-id')
    expect(manifest).toHaveLength(32)
    expect(manifest).toEqual(await deriveVaultSubkey(root, 'manifest-encryption'))
    expect(Buffer.from(manifest).equals(Buffer.from(content))).toBe(false)
    expect(Buffer.from(content).equals(Buffer.from(objectId))).toBe(false)
  })
  it('生成独立的 256 位 Vault 密钥和恢复密钥', () => {
    const first = generateVaultKey()
    const second = generateVaultKey()
    const recovery = generateRecoveryKey()

    expect(first).toHaveLength(32)
    expect(second).toHaveLength(32)
    expect(recovery).toHaveLength(32)
    expect([...first]).not.toEqual([...second])
    expect([...first]).not.toEqual([...recovery])
  })

  it('AES-256-GCM 字节加解密使用独立 nonce，并认证密文与上下文', async () => {
    const key = generateVaultKey()
    const plaintext = encoder.encode('中文内容\0和二进制\u0001')
    const aad = encoder.encode('manifest:v1')
    const first = await encryptBytes(plaintext, key, aad)
    const second = await encryptBytes(plaintext, key, aad)

    expect(first).toMatchObject({
      version: 1,
      algorithm: 'AES-256-GCM',
      parameters: { tagLength: 128 },
    })
    expect(first.parameters.nonce).not.toBe(second.parameters.nonce)
    await expect(decryptBytes(first, key, aad)).resolves.toEqual(plaintext)
    const emptyAad = await encryptBytes(plaintext, key, new Uint8Array())
    await expect(decryptBytes(emptyAad, key, new Uint8Array())).resolves.toEqual(plaintext)
    await expect(decryptBytes(first, key, encoder.encode('错误上下文'))).rejects.toMatchObject({
      code: 'INVALID_ENVELOPE',
    })

    const tampered = clone(first)
    tampered.ciphertext = replaceFirstBase64UrlCharacter(tampered.ciphertext)
    await expect(decryptBytes(tampered, key, aad)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    })
    await expect(decryptBytes(first, generateVaultKey(), aad)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    })
  })

  it('拒绝未知版本、算法、参数和非规范编码', async () => {
    const key = generateVaultKey()
    const envelope = await encryptBytes(encoder.encode('data'), key)

    await expect(decryptBytes({ ...envelope, version: 2 }, key)).rejects.toMatchObject({
      code: 'INVALID_ENVELOPE',
    })
    await expect(decryptBytes({ ...envelope, algorithm: 'AES-CBC' }, key)).rejects.toMatchObject({
      code: 'INVALID_ENVELOPE',
    })
    await expect(
      decryptBytes(
        { ...envelope, parameters: { ...envelope.parameters, tagLength: 96 } },
        key,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ENVELOPE' })
    await expect(
      decryptBytes(
        { ...envelope, parameters: { ...envelope.parameters, nonce: '***' } },
        key,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ENVELOPE' })
  })

  it('用固定 Argon2id 参数从密码派生 KEK 并包装 Vault 密钥', async () => {
    const vaultKey = generateVaultKey()
    const wrapped = await wrapVaultKeyWithPassword(vaultKey, 'correct horse battery staple')

    expect(wrapped).toMatchObject({
      version: 1,
      algorithm: 'Argon2id+AES-256-GCM',
      purpose: 'vault-key',
      parameters: {
        kdf: {
          algorithm: 'Argon2id',
          memoryKiB: 65_536,
          iterations: 3,
          parallelism: 4,
          outputBytes: 32,
        },
        cipher: { algorithm: 'AES-256-GCM', tagLength: 128 },
      },
    })
    expect(ARGON2ID_PARAMETERS).toEqual({
      memoryKiB: 65_536,
      iterations: 3,
      parallelism: 4,
      outputBytes: 32,
    })
    await expect(
      unwrapVaultKeyWithPassword(wrapped, 'correct horse battery staple'),
    ).resolves.toEqual(vaultKey)
    await expect(unwrapVaultKeyWithPassword(wrapped, 'wrong password')).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    })
  }, 20_000)

  it('在执行昂贵 KDF 前拒绝被篡改或不受支持的包装参数', async () => {
    const wrapped = await wrapVaultKeyWithPassword(generateVaultKey(), 'test password')
    const tampered = clone(wrapped)
    tampered.parameters.kdf.memoryKiB = 1 as 65_536

    await expect(unwrapVaultKeyWithPassword(tampered, 'test password')).rejects.toMatchObject({
      code: 'INVALID_ENVELOPE',
    })
    await expect(wrapVaultKeyWithPassword(generateVaultKey(), '')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  }, 10_000)

  it('导出、导入并使用独立恢复密钥包装 Vault 密钥', async () => {
    const vaultKey = generateVaultKey()
    const recoveryKey = generateRecoveryKey()
    const exported = exportRecoveryKey(recoveryKey)
    const imported = importRecoveryKey(exported)

    expect(exported).toMatch(/^light-recovery:v1:aes-256-gcm:[A-Za-z0-9_-]{43}$/)
    expect(imported).toEqual(recoveryKey)
    expect(() => importRecoveryKey(exported.replace(':v1:', ':v2:'))).toThrowError(SyncCryptoError)
    expect(() => importRecoveryKey(`${exported}=`)).toThrowError(SyncCryptoError)

    const wrapped = await wrapVaultKeyWithRecoveryKey(vaultKey, imported)
    expect(wrapped).toMatchObject({
      version: 1,
      algorithm: 'AES-256-GCM',
      purpose: 'vault-key-recovery',
      parameters: { tagLength: 128 },
    })
    await expect(unwrapVaultKeyWithRecoveryKey(wrapped, imported)).resolves.toEqual(vaultKey)
    await expect(
      unwrapVaultKeyWithRecoveryKey(wrapped, generateRecoveryKey()),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  })

  it('用 HMAC-SHA256 生成稳定、密钥隔离且不暴露内容的对象 ID', async () => {
    const key = new Uint8Array(32).fill(7)
    const contents = encoder.encode('同一对象')
    const first = await keyedObjectId(key, contents)

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toBe('455de19322061b0b3127ef2a99f69bd80d454d242642deef8801fb6e3497c16e')
    await expect(keyedObjectId(key, contents)).resolves.toBe(first)
    await expect(keyedObjectId(key, encoder.encode('另一对象'))).resolves.not.toBe(first)
    await expect(keyedObjectId(new Uint8Array(32).fill(8), contents)).resolves.not.toBe(first)
    expect(first).not.toContain('同一对象')
  })

  it('所有密钥 API 都拒绝非 256 位输入', async () => {
    const shortKey = new Uint8Array(31)
    expect(() => exportRecoveryKey(shortKey)).toThrowError(SyncCryptoError)
    await expect(encryptBytes(new Uint8Array(), shortKey)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(keyedObjectId(shortKey, new Uint8Array())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })
})

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function replaceFirstBase64UrlCharacter(value: string): string {
  return `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`
}
