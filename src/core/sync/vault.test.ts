import { describe, expect, it } from 'vitest'
import { generateRecoveryKey } from './crypto'
import {
  initializeVault,
  parseKeyDocument,
  unlockWithPassword,
  unlockWithRecovery,
} from './vault'

describe('远端 Vault key document v1', () => {
  it('创建只含包装密钥的严格 v1 文档，并可分别用密码和恢复文本解锁', async () => {
    const initialized = await initializeVault('a strong development password')

    expect(initialized.keyDoc).toMatchObject({
      version: 1,
      purpose: 'light-sync-vault-key',
      algorithm: 'Argon2id+AES-256-GCM',
      passwordWrappedVaultKey: {
        parameters: {
          kdf: {
            algorithm: 'Argon2id',
            memoryKiB: 65_536,
            iterations: 3,
            parallelism: 4,
            outputBytes: 32,
          },
        },
      },
    })
    expect(JSON.stringify(initialized.keyDoc)).not.toContain('a strong development password')
    expect(JSON.stringify(initialized.keyDoc)).not.toContain(initialized.recoveryExport)
    expect(parseKeyDocument(JSON.parse(JSON.stringify(initialized.keyDoc)))).toEqual(
      initialized.keyDoc,
    )
    await expect(
      unlockWithPassword(initialized.keyDoc, 'a strong development password'),
    ).resolves.toEqual(initialized.vaultKey)
    await expect(
      unlockWithRecovery(initialized.keyDoc, initialized.recoveryExport),
    ).resolves.toEqual(initialized.vaultKey)
  }, 20_000)

  it('可使用调用方提供的恢复密钥，但不会擦除调用方的输入', async () => {
    const recoveryKey = generateRecoveryKey()
    const original = recoveryKey.slice()
    const initialized = await initializeVault('password', recoveryKey)

    expect(recoveryKey).toEqual(original)
    await expect(
      unlockWithRecovery(initialized.keyDoc, initialized.recoveryExport),
    ).resolves.toEqual(initialized.vaultKey)
  }, 20_000)

  it('拒绝未知顶层版本、算法、用途、缺失字段和额外字段', async () => {
    const { keyDoc } = await initializeVault('password')
    const candidates = [
      { ...clone(keyDoc), version: 2 },
      { ...clone(keyDoc), algorithm: 'PBKDF2+AES-256-GCM' },
      { ...clone(keyDoc), purpose: 'other' },
      { ...clone(keyDoc), recoveryWrappedVaultKey: undefined },
      { ...clone(keyDoc), futureField: true },
    ]

    for (const candidate of candidates) {
      expect(() => parseKeyDocument(candidate)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ENVELOPE' }),
      )
    }
  }, 20_000)

  it('在执行 KDF 前拒绝嵌套未知字段、算法、参数和非规范编码', async () => {
    const { keyDoc } = await initializeVault('password')
    const extra = clone(keyDoc)
    ;(extra.passwordWrappedVaultKey.parameters.kdf as Record<string, unknown>).future = true
    const changedKdf = clone(keyDoc)
    changedKdf.passwordWrappedVaultKey.parameters.kdf.memoryKiB = 1 as 65_536
    const changedCipher = clone(keyDoc)
    changedCipher.recoveryWrappedVaultKey.parameters.tagLength = 96 as 128
    const changedAlgorithm = clone(keyDoc)
    changedAlgorithm.recoveryWrappedVaultKey.algorithm = 'AES-CBC' as 'AES-256-GCM'
    const malformed = clone(keyDoc)
    malformed.passwordWrappedVaultKey.parameters.kdf.salt = '***'

    for (const candidate of [extra, changedKdf, changedCipher, changedAlgorithm, malformed]) {
      await expect(unlockWithPassword(candidate, 'password')).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      })
    }
  }, 20_000)

  it('错误密码、错误恢复文本和被篡改包装密文均 fail closed', async () => {
    const initialized = await initializeVault('correct password')
    await expect(unlockWithPassword(initialized.keyDoc, 'wrong password')).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    })

    const other = await initializeVault('other password')
    await expect(
      unlockWithRecovery(initialized.keyDoc, other.recoveryExport),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })

    const tampered = clone(initialized.keyDoc)
    tampered.passwordWrappedVaultKey.wrappedKey = replaceFirstCharacter(
      tampered.passwordWrappedVaultKey.wrappedKey,
    )
    await expect(unlockWithPassword(tampered, 'correct password')).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    })
  }, 30_000)
})

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function replaceFirstCharacter(value: string): string {
  return `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`
}
