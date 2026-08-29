import { beforeEach, describe, expect, it } from 'vitest'
import {
  createAppLockConfig, decryptProtectedText, deriveAppKey, encryptProtectedText,
  isProtectedText, randomSalt, saltOf, setActiveLocalVaultKey,
} from './local-vault'

describe('本地敏感笔记加密', () => {
  beforeEach(() => setActiveLocalVaultKey(null))

  it('密码派生配置可验证并用 AES-GCM 往返', async () => {
    const salt = randomSalt()
    const derived = await deriveAppKey('correct horse battery staple', salt, 1_000)
    const config = createAppLockConfig(salt, derived.verifier)
    expect(saltOf(config)).toEqual(salt)
    const cipher = await encryptProtectedText('私密正文', derived.key)
    expect(isProtectedText(cipher)).toBe(true)
    expect(cipher).not.toContain('私密正文')
    expect(await decryptProtectedText(cipher, derived.key)).toBe('私密正文')
  })

  it('错误密钥 fail closed', async () => {
    const a = await deriveAppKey('a', randomSalt(), 1_000)
    const b = await deriveAppKey('b', randomSalt(), 1_000)
    await expect(decryptProtectedText(await encryptProtectedText('secret', a.key), b.key)).rejects.toThrow('无法解密')
  })

  it('锁定时不能解密或新增加密内容', async () => {
    const key = (await deriveAppKey('a', randomSalt(), 1_000)).key
    const cipher = await encryptProtectedText('secret', key)
    await expect(decryptProtectedText(cipher)).rejects.toThrow('先解锁')
    await expect(encryptProtectedText('secret')).rejects.toThrow('已锁定')
  })
})
