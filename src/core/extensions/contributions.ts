import { builtinText } from './builtins'
import type { ExtensionCommand, ExtensionSlashItem, InstalledExtension } from './types'

export class ExtensionContributions {
  private extensions = new Map<string, InstalledExtension>()

  constructor(private readonly locale: () => string = () => 'zh-CN') {}

  register(extension: InstalledExtension): void {
    this.extensions.set(extension.manifest.id, extension)
  }

  unregister(extensionId: string): void {
    this.extensions.delete(extensionId)
  }

  clear(): void {
    this.extensions.clear()
  }

  commands(): ExtensionCommand[] {
    return [...this.extensions.values()].flatMap((extension) => {
      const { manifest } = extension
      return (manifest.contributes?.commands ?? []).map((command) => ({
        ...command,
        id: `${manifest.id}.${command.id}`,
        extensionId: manifest.id,
        command: command.id,
        title: builtinText(manifest.id, this.locale(), `command.${command.id}`, command.title),
      }))
    })
  }

  slashItems(): ExtensionSlashItem[] {
    return [...this.extensions.values()].flatMap((extension) => {
      const { manifest } = extension
      return (manifest.contributes?.slash ?? []).map((item) => ({
        id: `${manifest.id}.${item.command}`,
        extensionId: manifest.id,
        command: item.command,
        title: builtinText(manifest.id, this.locale(), `command.${item.command}`, item.title),
        group: extension.builtin
          ? (this.locale() === 'en-US' ? 'Official extensions' : '官方扩展')
          : item.group ?? '扩展',
        keywords: item.keywords ?? [],
      }))
    })
  }
}
