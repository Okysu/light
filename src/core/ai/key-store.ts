/**
 * API Key 的本地加密存储（6.2）。
 *
 * ## 它防住了什么，没防住什么
 *
 * 加密用的是 WebCrypto 的 AES-GCM，密钥是一把 **`extractable: false` 的
 * CryptoKey**，存在 IndexedDB 里。「不可导出」由浏览器实现保证：
 * 任何脚本——包括本应用自己——都拿不到密钥的原始字节，只能拿它去加解密。
 *
 * 因此这套方案挡得住：
 * - 拿到 localStorage / 备份文件 / 同步到网盘的配置，直接读出明文 Key；
 * - 误把配置贴进 issue、日志、截图。
 *
 * 挡不住：
 * - 以同一用户身份、在同一浏览器 profile 里运行的恶意代码。它能调
 *   `decrypt()`，和本应用有一样的权限。
 *
 * 这是**没有主密码**的方案能达到的上限，而不是密码学上的强保护。
 * 设置页必须把这句话原样说给用户听——安全功能上含糊其辞，
 * 比没有这个功能更糟：用户会据此做出他本不会做的决定。
 *
 * 不引入第三方加密库：WebCrypto 本身就是上游实现，再包一层只会多一个
 * 可能出错、且没人审计的转换层。
 */

const DB_NAME = 'light-secrets'
const STORE_NAME = 'keys'
const DEVICE_KEY_ID = 'device-key'
const IV_LENGTH = 12

export interface EncryptedSecret {
  /** base64 的密文 */
  cipher: string
  /** base64 的初始向量。GCM 下 IV 绝不能复用，因此每次加密都新生成一个 */
  iv: string
}

/** 浏览器是否具备加密所需的能力；不具备时上层应当拒绝保存 Key 而不是退回明文 */
export function canEncrypt(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle
}

export async function encryptSecret(plaintext: string): Promise<EncryptedSecret> {
  const key = await deviceKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )

  return { cipher: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) }
}

/**
 * 解密。
 *
 * 失败返回 null 而不是抛错：密文解不开的现实原因是「换了浏览器 / 清了站点数据，
 * 设备密钥没了」，这不是异常而是一种正常状态，上层该提示用户重新填一次 Key。
 */
export async function decryptSecret(secret: EncryptedSecret): Promise<string | null> {
  try {
    const key = await deviceKey()
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(secret.iv) },
      key,
      fromBase64(secret.cipher),
    )
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

/**
 * 取得（必要时生成）本设备的密钥。
 *
 * `extractable: false` 是这套方案的全部依仗，不能为了「方便导出备份」松掉——
 * 一旦可导出，它就退化成了「明文存储外面套了一层 base64」。
 */
async function deviceKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(DEVICE_KEY_ID)
  if (existing) return existing

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  await idbPut(DEVICE_KEY_ID, key)
  return key
}

/** 清除设备密钥。用户「忘记全部 AI 凭据」时调用——密钥没了，密文就再也解不开 */
export async function forgetDeviceKey(): Promise<void> {
  const db = await openDb()
  await promisify(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(DEVICE_KEY_ID))
  db.close()
}

// --- IndexedDB 最小封装 -----------------------------------------------------
// 只存一条记录，不值得引入 idb 之类的库。

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbGet<T>(id: string): Promise<T | null> {
  const db = await openDb()
  try {
    return (await promisify<T>(db.transaction(STORE_NAME).objectStore(STORE_NAME).get(id))) ?? null
  } finally {
    db.close()
  }
}

async function idbPut(id: string, value: unknown): Promise<void> {
  const db = await openDb()
  try {
    await promisify(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, id))
  } finally {
    db.close()
  }
}

function promisify<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error)
  })
}

// --- base64 -----------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // 不用 String.fromCharCode(...bytes)：几十 KB 的数组会把参数栈撑爆
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * 显式建在 ArrayBuffer 上。
 *
 * `Uint8Array.from` 的返回类型是 `Uint8Array<ArrayBufferLike>`，而 WebCrypto
 * 要求 `ArrayBuffer`——`ArrayBufferLike` 还包含 `SharedArrayBuffer`，
 * 那种缓冲区不能传给 subtle crypto。
 */
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
