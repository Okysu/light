import type { EncryptedSecret } from '@/core/ai/key-store'
import { decryptSecret, encryptSecret } from '@/core/ai/key-store'

const VAULT_CACHE_KEY = 'light:s3-vault-keys'

/** Vault 主密钥只以设备密钥加密后的形式留在本机；密码和恢复密钥永不缓存。 */
export async function cacheVaultKey(profileId: string, vaultKey: Uint8Array): Promise<void> {
  if (vaultKey.byteLength !== 32) throw new Error('Vault 密钥必须为 256 位')
  const records = readRecords()
  records[profileId] = await encryptSecret(toBase64(vaultKey))
  localStorage.setItem(VAULT_CACHE_KEY, JSON.stringify(records))
}

export async function loadCachedVaultKey(profileId: string): Promise<Uint8Array | null> {
  const record = readRecords()[profileId]
  if (!record) return null
  const plaintext = await decryptSecret(record)
  if (!plaintext) return null
  try {
    const key = fromBase64(plaintext)
    return key.byteLength === 32 ? key : null
  } catch {
    return null
  }
}

export function forgetCachedVaultKey(profileId: string): void {
  const records = readRecords()
  delete records[profileId]
  localStorage.setItem(VAULT_CACHE_KEY, JSON.stringify(records))
}

function readRecords(): Record<string, EncryptedSecret> {
  try {
    const value = JSON.parse(localStorage.getItem(VAULT_CACHE_KEY) ?? '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, EncryptedSecret>
      : {}
  } catch {
    return {}
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const output = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index)
  return output
}
