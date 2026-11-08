/** Browser replacements for the Electron-only helpers Slides calls. */
import * as path from '../node-path'
import * as vfs from '../vfs'
import { dialog } from '../electron-stub'

interface Adapter {
  pickOpenPath?: (options?: unknown) => Promise<string | null>
  pickSavePath?: (defaultName: string, options?: unknown) => Promise<string | null>
  pickDirectory?: () => Promise<string | null>
  pickFiles?: (options?: unknown) => Promise<string[]>
  openExternal?: (url: string) => void
}

function adapter(): Adapter | undefined {
  return (window as unknown as { __genofficeSlidesAdapter?: Adapter }).__genofficeSlidesAdapter
}

export function configuredDefaultSaveDir(_app?: unknown): string {
  return 'GenOffice'
}

export function configuredAuthorName(): string {
  return 'GenOffice'
}

export function saveAsSuggestion(sourcePath: string | null | undefined, defaultName: string): string {
  return sourcePath ? path.join(path.dirname(sourcePath), defaultName) : defaultName
}

export async function showOpenDialogWithMemory(
  _dialog: unknown,
  _parent: unknown,
  options?: unknown,
  _fallbackDir?: string,
) {
  const picked = await adapter()?.pickOpenPath?.(options)
  return picked
    ? { canceled: false, filePaths: [picked] }
    : { canceled: true, filePaths: [] }
}

export async function showSaveDialogWithMemory(
  _dialog: unknown,
  _parent: unknown,
  options?: { defaultPath?: string },
  _fallbackDir?: string,
) {
  const name = String(options?.defaultPath || 'Untitled presentation.pptx')
  const picked = await adapter()?.pickSavePath?.(name, options)
  return picked ? { canceled: false, filePath: picked } : { canceled: true, filePath: undefined }
}

export function recoveryCopyDiskNewer(_recoveryMtime: number, _diskMtime: number): boolean {
  return false
}

export const MAX_REMOTE_IMAGE_BYTES = 32 * 1024 * 1024

export async function fetchRemoteImage(url: string): Promise<Response> {
  return fetch(url)
}

export async function readBodyCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array(await response.arrayBuffer())
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error('response is too large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

export function isHeadlessMode(): boolean {
  return false
}
export function installNavigationGuard(): void {}
export function installContextMenu(): void {}
export function installRendererProtocol(): void {}
export function registerRendererScheme(): void {}
export function rendererUrl(): string {
  return location.href
}
export const appMenuLabels = {}
export const contextMenuLabels = {}
export const appMenuTemplate = () => []
export const helpMenuTemplate = () => []
export const settingsMenuItem = () => null
export const toggleDevToolsItem = () => null
export function safeExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

export function createMainProcessProxyDispatcher(): unknown {
  return null
}

export const dialogMemory = { showOpenDialogWithMemory, showSaveDialogWithMemory }
export { dialog, path, vfs }
