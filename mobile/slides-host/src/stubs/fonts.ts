import { HeuristicMetrics, type FontMetricsProvider } from '@genoffice/pptx-render'

let metrics: FontMetricsProvider | null = null

export function createSystemFontMetrics(): FontMetricsProvider {
  if (!metrics) metrics = new HeuristicMetrics()
  return metrics
}

export function resetFontRegistry(): void {
  metrics = null
}

export function registerEmbeddedFonts(_faces: unknown): boolean {
  return false
}
export function listPrivateFontFaces(): unknown[] {
  return []
}
export function getPrivateFontData(_id: string): null {
  return null
}
export function setUserFontDir(_dir: string): void {}
export function getUserFontDir(): string {
  return '.genoffice/fonts'
}
export function familyAvailable(_family: string): boolean {
  return false
}
export function fontFileFamilies(_path: string): string[] {
  return []
}
