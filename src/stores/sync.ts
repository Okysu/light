import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { EncryptedSecret } from '@/core/ai/key-store'
import { canEncrypt, decryptSecret, encryptSecret } from '@/core/ai/key-store'
import {
  DEFAULT_SYNC_CONFIG,
  isSyncConfigured,
  normalizeSyncConfig,
  SYNC_CONFIG_PATH,
  SYNC_STATE_PATH,
} from '@/core/sync/config'
import { synchronize } from '@/core/sync/engine'
import { createS3Remote } from '@/core/sync/s3-remote'
import { initializeVault, unlockWithPassword, unlockWithRecovery } from '@/core/sync/vault'
import { RemoteGarbageCollector, type RemoteGcPlan, type RemoteGcResult } from '@/core/sync/gc'
import type { S3Credentials, SyncConfig, SyncProgress, SyncResult } from '@/core/sync/types'
import { SyncError } from '@/core/sync/types'
import { ATTACHMENTS_DIR } from '@/core/workspace/types'
import { useEditorStore } from './editor'
import { useBoardStore } from './board'
import { useCanvasStore } from './canvas'
import { useWorkspaceStore } from './workspace'
import { createMultipartJournal } from './sync-multipart-journal'
import { cacheVaultKey, forgetCachedVaultKey, loadCachedVaultKey } from './sync-vault-cache'

const CREDENTIALS_KEY = 'light:s3-credentials'
const DEVICE_ID_KEY = 'light:sync-device-id'

/** S3 同步编排：core 负责规则，这里只管配置、凭据、进度和触发时机。 */
export const useSyncStore = defineStore('sync', () => {
  const workspace = useWorkspaceStore()
  const editor = useEditorStore()
  const board = useBoardStore()
  const canvas = useCanvasStore()
  const config = ref<SyncConfig>({ ...DEFAULT_SYNC_CONFIG })
  const running = ref(false)
  const testing = ref(false)
  const progress = ref<SyncProgress | null>(null)
  const lastResult = ref<SyncResult | null>(null)
  const lastSyncedAt = ref<number | null>(null)
  const error = ref<string | null>(null)
  const loaded = ref(false)
  const vaultStatus = ref<'unknown' | 'absent' | 'locked' | 'unlocked'>('unknown')
  const recoveryExport = ref<string | null>(null)
  const gcPlan = ref<RemoteGcPlan | null>(null)
  const gcRunning = ref(false)
  const vaultKey = shallowRef<Uint8Array | null>(null)
  const secrets = ref<Record<string, EncryptedSecret>>(readSecrets())
  let activeController: AbortController | null = null
  let gcCollector: RemoteGarbageCollector | null = null

  const profileId = computed(() => profileKey(config.value))
  const hasCredentials = computed(() => !!secrets.value[profileId.value])
  const ready = computed(() => isSyncConfigured(config.value) && hasCredentials.value && vaultStatus.value === 'unlocked')

  async function load(): Promise<void> {
    if (!workspace.storage) {
      config.value = { ...DEFAULT_SYNC_CONFIG }
      loaded.value = false
      return
    }
    try {
      config.value = normalizeSyncConfig(JSON.parse(await workspace.storage.readText(SYNC_CONFIG_PATH)))
    } catch {
      config.value = { ...DEFAULT_SYNC_CONFIG }
    }
    loaded.value = true
    await refreshVaultStatus().catch(() => { vaultStatus.value = 'unknown' })
  }

  async function save(next: SyncConfig): Promise<void> {
    if (!workspace.storage) throw new SyncError('数据目录尚未就绪', 'IO')
    const previousProfile = profileId.value
    config.value = normalizeSyncConfig(next)
    await workspace.storage.writeText(SYNC_CONFIG_PATH, JSON.stringify(config.value, null, 2))
    if (previousProfile !== profileId.value) {
      vaultKey.value?.fill(0)
      vaultKey.value = null
      recoveryExport.value = null
      vaultStatus.value = 'unknown'
      gcPlan.value = null
      gcCollector = null
    }
  }

  async function saveCredentials(accessKeyId: string, secretAccessKey: string): Promise<void> {
    const access = accessKeyId.trim()
    const secret = secretAccessKey.trim()
    if (!access || !secret) throw new SyncError('AccessKey 和 SecretKey 都不能为空', 'NOT_CONFIGURED')
    if (!canEncrypt()) throw new SyncError('当前环境不支持本地加密存储', 'IO')

    const next = { ...secrets.value }
    next[profileId.value] = await encryptSecret(JSON.stringify({ accessKeyId: access, secretAccessKey: secret }))
    persistSecrets(next)
  }

  function forgetCredentials(): void {
    const next = { ...secrets.value }
    delete next[profileId.value]
    persistSecrets(next)
    lockVault()
  }

  async function testConnection(): Promise<void> {
    testing.value = true
    error.value = null
    try {
      const remote = await configuredS3()
      await remote.testConnection()
      await refreshVaultStatus(remote)
    } catch (cause) {
      error.value = messageOf(cause)
      throw cause
    } finally {
      testing.value = false
    }
  }

  async function refreshVaultStatus(existingRemote?: Awaited<ReturnType<typeof configuredS3>>): Promise<void> {
    const remote = existingRemote ?? await configuredS3()
    const snapshot = await remote.readKeyDocument()
    if (!snapshot) {
      vaultKey.value?.fill(0)
      vaultKey.value = null
      vaultStatus.value = 'absent'
      return
    }
    if (!vaultKey.value) vaultKey.value = await loadCachedVaultKey(profileId.value)
    vaultStatus.value = vaultKey.value ? 'unlocked' : 'locked'
  }

  async function createVault(password: string, resetExisting = false): Promise<string> {
    const remote = await configuredS3()
    await remote.testConnection()
    const existing = await remote.readKeyDocument()
    if (existing && !resetExisting) {
      vaultStatus.value = 'locked'
      throw new SyncError('远端已存在 Vault，请解锁；若要清空开发数据请使用“重置并新建”', 'REMOTE_CHANGED')
    }
    if (resetExisting) {
      await remote.resetProtocolData()
      if (workspace.storage && await workspace.storage.exists(SYNC_STATE_PATH)) {
        await workspace.storage.remove(SYNC_STATE_PATH)
      }
    }
    const initialized = await initializeVault(password)
    try {
      await remote.writeKeyDocument(initialized.keyDoc, null)
      vaultKey.value?.fill(0)
      vaultKey.value = initialized.vaultKey
      await cacheVaultKey(profileId.value, initialized.vaultKey)
      recoveryExport.value = initialized.recoveryExport
      vaultStatus.value = 'unlocked'
      return initialized.recoveryExport
    } catch (cause) {
      initialized.vaultKey.fill(0)
      if (vaultKey.value === initialized.vaultKey) vaultKey.value = null
      vaultStatus.value = 'locked'
      throw cause
    }
  }

  async function unlockVaultWithPassword(password: string): Promise<void> {
    const remote = await configuredS3()
    const snapshot = await remote.readKeyDocument()
    if (!snapshot) {
      vaultStatus.value = 'absent'
      throw new SyncError('远端尚未初始化 Vault', 'NOT_CONFIGURED')
    }
    const unlocked = await unlockWithPassword(snapshot.document, password)
    vaultKey.value?.fill(0)
    vaultKey.value = unlocked
    await cacheVaultKey(profileId.value, unlocked)
    vaultStatus.value = 'unlocked'
  }

  async function unlockVaultWithRecovery(value: string): Promise<void> {
    const remote = await configuredS3()
    const snapshot = await remote.readKeyDocument()
    if (!snapshot) {
      vaultStatus.value = 'absent'
      throw new SyncError('远端尚未初始化 Vault', 'NOT_CONFIGURED')
    }
    const unlocked = await unlockWithRecovery(snapshot.document, value)
    vaultKey.value?.fill(0)
    vaultKey.value = unlocked
    await cacheVaultKey(profileId.value, unlocked)
    vaultStatus.value = 'unlocked'
  }

  function lockVault(): void {
    vaultKey.value?.fill(0)
    vaultKey.value = null
    recoveryExport.value = null
    forgetCachedVaultKey(profileId.value)
    vaultStatus.value = 'locked'
    gcPlan.value = null
    gcCollector = null
  }

  async function previewGarbageCollection(): Promise<RemoteGcPlan> {
    if (gcRunning.value) throw new SyncError('远端维护正在执行', 'IO')
    gcRunning.value = true
    error.value = null
    try {
      const remote = await configuredRemote()
      gcCollector = new RemoteGarbageCollector(remote)
      gcPlan.value = await gcCollector.dryRun()
      return gcPlan.value
    } catch (cause) {
      gcPlan.value = null
      gcCollector = null
      error.value = messageOf(cause)
      throw cause
    } finally {
      gcRunning.value = false
    }
  }

  async function executeGarbageCollection(): Promise<RemoteGcResult> {
    if (!gcCollector || !gcPlan.value) throw new SyncError('请先重新扫描可清理对象', 'NOT_CONFIGURED')
    gcRunning.value = true
    error.value = null
    try {
      const result = await gcCollector.execute(gcPlan.value, gcPlan.value.confirmationToken)
      gcPlan.value = null
      gcCollector = null
      return result
    } catch (cause) {
      gcPlan.value = null
      gcCollector = null
      error.value = messageOf(cause)
      throw cause
    } finally {
      gcRunning.value = false
    }
  }

  async function syncNow(): Promise<SyncResult | null> {
    if (running.value) return null
    if (!workspace.storage) throw new SyncError('数据目录尚未就绪', 'IO')

    running.value = true
    error.value = null
    lastResult.value = null
    progress.value = null
    activeController = new AbortController()
    try {
      // 正在编辑的最后几百毫秒内容先落盘，远端快照才不会少半句话。
      await Promise.all([editor.flush(), board.flush(), canvas.flush()])
      const remote = await configuredRemote()
      const result = await synchronize({
        storage: workspace.storage,
        remote,
        deviceId: deviceId(),
        conflictPolicy: config.value.conflictPolicy,
        onProgress: (value) => { progress.value = value },
        signal: activeController.signal,
        attachmentsDir: ATTACHMENTS_DIR,
        attachmentPolicy: config.value.attachmentPolicy,
      })
      await workspace.refresh()
      await reloadActiveDocument()
      lastResult.value = result
      lastSyncedAt.value = result.finishedAt
      return result
    } catch (cause) {
      error.value = messageOf(cause)
      throw cause
    } finally {
      activeController = null
      running.value = false
      progress.value = null
    }
  }

  function cancelSync(): void {
    activeController?.abort()
  }

  async function autoSync(): Promise<void> {
    if (!loaded.value) await load()
    if (!config.value.enabled || !config.value.autoSync || !ready.value || !navigator.onLine) return
    try {
      await syncNow()
    } catch {
      // 自动同步的错误已进入响应式状态；不能用未处理 rejection 打扰编辑。
    }
  }

  async function configuredRemote() {
    if (!vaultKey.value) vaultKey.value = await loadCachedVaultKey(profileId.value)
    if (!vaultKey.value) throw new SyncError('请先用密码或恢复密钥解锁 S3 Vault', 'NOT_CONFIGURED')
    vaultStatus.value = 'unlocked'
    return configuredS3(vaultKey.value)
  }

  async function configuredS3(unlockedVaultKey?: Uint8Array) {
    if (!isSyncConfigured(config.value)) {
      throw new SyncError('请先填写端点、区域和 Bucket', 'NOT_CONFIGURED')
    }
    const encrypted = secrets.value[profileId.value]
    if (!encrypted) throw new SyncError('请先保存 S3 凭据', 'NOT_CONFIGURED')
    const plaintext = await decryptSecret(encrypted)
    if (!plaintext) throw new SyncError('保存的 S3 凭据无法解密，请重新填写', 'AUTH')

    let credentials: S3Credentials
    try {
      credentials = JSON.parse(plaintext) as S3Credentials
      if (!credentials.accessKeyId || !credentials.secretAccessKey) throw new Error('invalid')
    } catch (cause) {
      throw new SyncError('保存的 S3 凭据已损坏，请重新填写', 'AUTH', { cause })
    }
    return createS3Remote(config.value, credentials, {
      multipartJournal: createMultipartJournal(profileKey(config.value)),
      vaultKey: unlockedVaultKey,
    })
  }

  async function reloadActiveDocument(): Promise<void> {
    const path = editor.activePath
    if (!path) return
    if (!(await workspace.storage!.exists(path))) {
      await editor.forgetTab(path)
      return
    }

    if (path.endsWith('.md')) await editor.openNote(path)
    else if (path.endsWith('.board')) await board.open(path)
    else if (path.endsWith('.canvas')) await canvas.open(path)
  }

  function persistSecrets(next: Record<string, EncryptedSecret>): void {
    secrets.value = next
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(next))
  }

  return {
    config,
    running,
    testing,
    progress,
    lastResult,
    lastSyncedAt,
    error,
    loaded,
    hasCredentials,
    ready,
    vaultStatus,
    recoveryExport,
    gcPlan,
    gcRunning,
    load,
    save,
    saveCredentials,
    forgetCredentials,
    testConnection,
    refreshVaultStatus,
    createVault,
    unlockVaultWithPassword,
    unlockVaultWithRecovery,
    lockVault,
    previewGarbageCollection,
    executeGarbageCollection,
    syncNow,
    cancelSync,
    autoSync,
  }
})

function readSecrets(): Record<string, EncryptedSecret> {
  try {
    const value = JSON.parse(localStorage.getItem(CREDENTIALS_KEY) ?? '{}') as Record<string, EncryptedSecret>
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function profileKey(config: SyncConfig): string {
  return [config.endpoint.trim(), config.region.trim(), config.bucket.trim(), config.prefix.trim()].join('|')
}

function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const created = crypto.randomUUID()
  localStorage.setItem(DEVICE_ID_KEY, created)
  return created
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
