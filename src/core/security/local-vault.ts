const PREFIX = 'LIGHT-ENCRYPTED-NOTE-V1\n'
export const APP_LOCK_ITERATIONS = 310_000

export interface AppLockConfig {
  version: 1
  salt: string
  verifier: string
  iterations: number
  autoLockMinutes: number
}

let activeKey: CryptoKey | null = null

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

export async function deriveAppKey(password: string, salt: Uint8Array, iterations = APP_LOCK_ITERATIONS): Promise<{ key: CryptoKey; verifier: string }> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, 512))
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  const verifierBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bits.slice(32)))
  bits.fill(0)
  return { key, verifier: bytesToBase64(verifierBytes) }
}

export function createAppLockConfig(salt: Uint8Array, verifier: string, autoLockMinutes = 15): AppLockConfig {
  return { version: 1, salt: bytesToBase64(salt), verifier, iterations: APP_LOCK_ITERATIONS, autoLockMinutes }
}

export function saltOf(config: AppLockConfig): Uint8Array {
  return base64ToBytes(config.salt)
}

export function setActiveLocalVaultKey(key: CryptoKey | null): void {
  activeKey = key
}

export function isProtectedText(value: string): boolean {
  return value.startsWith(PREFIX)
}

export async function encryptProtectedText(plain: string, key: CryptoKey | null = activeKey): Promise<string> {
  if (!key) throw new Error('应用已锁定，无法加密敏感笔记')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)))
  return `${PREFIX}${bytesToBase64(iv)}.${bytesToBase64(cipher)}`
}

export async function decryptProtectedText(value: string, key: CryptoKey | null = activeKey): Promise<string> {
  if (!isProtectedText(value)) return value
  if (!key) throw new Error('这是一篇敏感笔记，请先解锁应用')
  const payload = value.slice(PREFIX.length)
  const dot = payload.indexOf('.')
  if (dot <= 0) throw new Error('敏感笔记密文格式损坏')
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(payload.slice(0, dot)) as BufferSource },
      key,
      base64ToBytes(payload.slice(dot + 1)) as BufferSource,
    )
    return new TextDecoder().decode(plain)
  } catch {
    throw new Error('敏感笔记无法解密：密码错误或内容已损坏')
  }
}

export async function readProtectedText(raw: string): Promise<string> {
  return isProtectedText(raw) ? decryptProtectedText(raw) : raw
}

export async function preserveProtection(previousRaw: string, nextPlain: string): Promise<string> {
  return isProtectedText(previousRaw) ? encryptProtectedText(nextPlain) : nextPlain
}
