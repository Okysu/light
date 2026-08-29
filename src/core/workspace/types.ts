/**
 * 工作区目录约定（Web 与桌面完全一致，保证 Vault 可直接搬运）：
 *
 *   <工作区根>/
 *     .light/                  Light 自有数据，不参与笔记树展示
 *       workspace.json         工作区配置（每日笔记、回收站…）
 *       trash/                 回收站：软删除的条目按原相对路径归档
 *       trash/manifest.json    回收站清单（原路径、删除时间、类型）
 *     attachments/             Light 自动创建的固定附件目录
 *     任意用户目录/             笔记、看板、画板混合存放，层级不限
 */

export const LIGHT_DIR = '.light'
export const WORKSPACE_CONFIG_PATH = `${LIGHT_DIR}/workspace.json`
export const TRASH_DIR = `${LIGHT_DIR}/trash`
export const TRASH_MANIFEST_PATH = `${TRASH_DIR}/manifest.json`
import { DEFAULT_DAILY_FOLDER, DEFAULT_DAILY_FORMAT } from './daily-note'

export const ATTACHMENTS_DIR = 'attachments'

/** 条目类型由扩展名决定，而非由数据库记录决定——文件系统本身就是真源 */
export type NodeKind = 'folder' | 'note' | 'board' | 'canvas'

export const NOTE_EXT = '.md'
export const BOARD_EXT = '.board'
export const CANVAS_EXT = '.canvas'

/**
 * 笔记树节点。`path` 即天然主键：文件系统中路径唯一，
 * 无需额外维护一张「节点表」与磁盘状态做同步（这正是文件为真源方案的收益）。
 * 笔记内部另有 frontmatter.id 作为重命名后仍稳定的引用锚点，两者职责不同。
 */
export interface TreeNode {
  path: string
  name: string
  kind: NodeKind
  /** 仅 folder 有 */
  children?: TreeNode[]
}

export interface WorkspaceConfig {
  /** 开发期唯一配置结构；不维护历史兼容分支。 */
  version: 1
  /** 回收站自动清理天数；0 表示不自动清理 */
  trashRetentionDays: number
  /** 回收站内容是否参与全文搜索 */
  searchIncludesTrash: boolean
  /** 每日笔记所在目录（11.3） */
  dailyNoteFolder: string
  /** 每日笔记文件名格式；带 `/` 即按年月分子目录 */
  dailyNoteFormat: string
}

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  version: 1,
  trashRetentionDays: 30,
  searchIncludesTrash: false,
  dailyNoteFolder: DEFAULT_DAILY_FOLDER,
  dailyNoteFormat: DEFAULT_DAILY_FORMAT,
}

/**
 * 只挑选当前 V1 支持的字段。开发期不保留旧结构兼容，废弃字段不会回写。
 */
export function normalizeWorkspaceConfig(source: unknown): WorkspaceConfig {
  if (!source || typeof source !== 'object') return { ...DEFAULT_WORKSPACE_CONFIG }
  const value = source as Record<string, unknown>

  return {
    version: 1,
    trashRetentionDays: numberValue(value.trashRetentionDays, DEFAULT_WORKSPACE_CONFIG.trashRetentionDays),
    searchIncludesTrash:
      typeof value.searchIncludesTrash === 'boolean'
        ? value.searchIncludesTrash
        : DEFAULT_WORKSPACE_CONFIG.searchIncludesTrash,
    dailyNoteFolder: stringValue(value.dailyNoteFolder, DEFAULT_WORKSPACE_CONFIG.dailyNoteFolder),
    dailyNoteFormat: stringValue(value.dailyNoteFormat, DEFAULT_WORKSPACE_CONFIG.dailyNoteFormat),
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export interface TrashItem {
  /** 回收站内的存放路径，相对 TRASH_DIR */
  archivedPath: string
  /** 删除前在工作区中的原始路径 */
  originalPath: string
  kind: NodeKind
  deletedAt: number
}
