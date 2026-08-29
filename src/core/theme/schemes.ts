import type { StorageAdapter } from '../storage'

export const THEME_SCHEMES_PATH = '.light/themes.json'

export interface ThemeSchemeData {
  appearance: 'light' | 'dark' | 'system'
  preset: string
  typography: {
    editorWidth: string
    fontSize: string
    lineHeight: string
    fontFamily: string
    density: number
  }
  customCss: string
}

export interface ThemeScheme extends ThemeSchemeData {
  id: string
  name: string
  updatedAt: number
}

export interface ThemeSchemesDocument {
  version: 1
  schemes: ThemeScheme[]
}

export function normalizeThemeSchemes(input: unknown): ThemeSchemesDocument {
  const raw = input as Partial<ThemeSchemesDocument> | null
  const schemes = Array.isArray(raw?.schemes) ? raw.schemes : []
  return {
    version: 1,
    schemes: schemes.flatMap((item) => {
      const value = item as Partial<ThemeScheme>
      if (!value.id?.trim() || !value.name?.trim() || !value.typography) return []
      return [{
        id: value.id,
        name: value.name,
        appearance: value.appearance === 'light' || value.appearance === 'dark' ? value.appearance : 'system',
        preset: typeof value.preset === 'string' ? value.preset : 'minimal',
        typography: {
          editorWidth: String(value.typography.editorWidth || '45rem'),
          fontSize: String(value.typography.fontSize || '1rem'),
          lineHeight: String(value.typography.lineHeight || '1.75'),
          fontFamily: String(value.typography.fontFamily || 'system-ui, sans-serif'),
          density: Number.isFinite(value.typography.density) ? value.typography.density : 1,
        },
        customCss: typeof value.customCss === 'string' ? value.customCss : '',
        updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt! : 0,
      }]
    }),
  }
}

export class ThemeSchemeService {
  constructor(private readonly storage: StorageAdapter) {}

  async read(): Promise<ThemeSchemesDocument> {
    try {
      return normalizeThemeSchemes(JSON.parse(await this.storage.readText(THEME_SCHEMES_PATH)))
    } catch {
      return { version: 1, schemes: [] }
    }
  }

  async write(document: ThemeSchemesDocument): Promise<void> {
    await this.storage.writeText(THEME_SCHEMES_PATH, JSON.stringify(normalizeThemeSchemes(document), null, 2))
  }
}
