export function initFontStore(): void {}
export async function listFontCatalog(): Promise<unknown[]> {
  return []
}
export async function downloadFontFamily(_family: string): Promise<boolean> {
  return false
}
export function installLocalFontFiles(_paths: string[]): unknown {
  return { ok: false, families: [] }
}
export function missingCatalogFonts(_opened: unknown): string[] {
  return []
}
export const FONT_CATALOG: unknown[] = []
