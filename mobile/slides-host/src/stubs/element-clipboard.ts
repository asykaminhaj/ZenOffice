export const ELEMENT_CLIPBOARD_FORMAT = 'io.genoffice.slides.elements'
export function isElementClipboardToken(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('genoffice-slides-elements:')
}
export function elementClipboardMarkerMatches(_token: string): boolean {
  return false
}
export function canWriteElementClipboardImage(_token: string, _png: unknown): boolean {
  return false
}
export function writeElementClipboardImage(_token: string, _png: unknown): boolean {
  return false
}
