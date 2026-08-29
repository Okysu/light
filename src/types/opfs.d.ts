/**
 * TypeScript 内置 DOM 类型尚未收录 OPFS 的异步迭代接口，
 * 这里按 File System Access API 规范补齐我们用到的部分。
 * 待 lib.dom.d.ts 补全后可整体删除本文件。
 */
interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  keys(): AsyncIterableIterator<string>
  values(): AsyncIterableIterator<FileSystemHandle>
}
