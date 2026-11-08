export const OP_DOCS: Record<string, unknown> = {}
export const OP_GUIDES: Record<string, unknown> = {}
export const OP_GROUPS: readonly string[] = []
export function opVocabulary(): string {
  return ''
}
export function opUsage(_name: string): string | undefined {
  return undefined
}
export function opSignatureIndex(): string {
  return ''
}
export function opGuide(_group: string): string | undefined {
  return undefined
}
export function opGuideCatalog(): string {
  return ''
}
export default OP_DOCS
