import type { ExtensionCommand, ExtensionSlashItem, InstalledExtension } from './types'

export class ExtensionContributions {
  private commandsByExtension = new Map<string, ExtensionCommand[]>()
  private slashByExtension = new Map<string, ExtensionSlashItem[]>()

  register(extension: InstalledExtension): void {
    const { manifest } = extension
    this.commandsByExtension.set(manifest.id, (manifest.contributes?.commands ?? []).map((command) => ({
      ...command,
      id: `${manifest.id}.${command.id}`,
      extensionId: manifest.id,
      command: command.id,
    })))
    this.slashByExtension.set(manifest.id, (manifest.contributes?.slash ?? []).map((item) => ({
      id: `${manifest.id}.${item.command}`,
      extensionId: manifest.id,
      command: item.command,
      title: item.title,
      group: item.group ?? '扩展',
      keywords: item.keywords ?? [],
    })))
  }

  unregister(extensionId: string): void {
    this.commandsByExtension.delete(extensionId)
    this.slashByExtension.delete(extensionId)
  }

  clear(): void {
    this.commandsByExtension.clear()
    this.slashByExtension.clear()
  }

  commands(): ExtensionCommand[] {
    return [...this.commandsByExtension.values()].flat()
  }

  slashItems(): ExtensionSlashItem[] {
    return [...this.slashByExtension.values()].flat()
  }
}
