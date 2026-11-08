/**
 * Android Slides host entry.
 *
 * The desktop renderer expects the exact preload API and the exact main-process
 * IPC handlers. Instead of duplicating that contract, this bundle loads both the
 * real slides main module and its preload bridge, replacing only Electron, Node
 * filesystem calls and a few native-only side services.
 */
import { registerSlidesIpc } from '../../../apps/slides/src/main/slides-main'
import '../../../apps/slides/src/preload/index'
import { ipcMain } from './electron-stub'
import * as vfs from './vfs'

type AnyApi = Record<string, unknown>

interface SlidesAdapter {
  pickOpenPath?: (options?: unknown) => Promise<string | null>
  pickSavePath?: (defaultName: string, options?: unknown) => Promise<string | null>
  pickDirectory?: () => Promise<string | null>
  pickFiles?: (options?: unknown) => Promise<string[]>
  openExternal?: (url: string) => void
  flush?: (path: string, bytes: Uint8Array) => Promise<void> | void
  onSaved?: (path: string, size: number) => void
  onOpened?: (path: string) => void
}

declare global {
  interface Window {
    __genofficeSlidesHost?: Record<string, unknown>
    __genofficeSlidesAdapter?: SlidesAdapter
    slidesApi?: AnyApi
  }
}

registerSlidesIpc()

// Android build: AI is intentionally not shipped. The desktop renderer still
// contains the AI panel/ribbon code, so hide every entry point and keep the AI
// preferences closed. No AI IPC handler is registered (the AI stub is empty).
try {
  localStorage.setItem('ai-slides-show-ai', '0')
  // Default AutoSave on for new installs, but keep an explicit per-editor
  // off choice across reloads (the AutoSave pill writes '0').
  if (localStorage.getItem('ai-slides-auto-save') == null) {
    localStorage.setItem('ai-slides-auto-save', '1')
  }
  const style = document.createElement('style')
  style.textContent = `
    .ai-dock, .stage-ai-bar, .ai-ask-trigger, .ai-ask-pop,
    .ribbon-group:has(.ai-entry),
    .ribbon-group:has(img[src*="icon-spelling"]),
    .ribbon-group:has(.ai-entry) + .ribbon-sep,
    .ribbon-group:has(img[src*="icon-spelling"]) + .ribbon-sep { display: none !important; }
  `
  document.head.appendChild(style)
} catch {
  /* the UI still works when storage/DOM is unavailable during bootstrap */
}

function ensureHandler(channel: string, fn: () => unknown): void {
  try {
    ipcMain.handle(channel, fn)
  } catch {
    /* already registered by the real main module */
  }
}

function shellTheme(): 'dark' | 'light' | 'system' {
  try {
    const raw = localStorage.getItem('genoffice.shell.theme.v1')
    const value = raw ? JSON.parse(raw) : 'system'
    return value === 'dark' || value === 'light' ? value : 'system'
  } catch {
    return 'system'
  }
}

ensureHandler('app:get-theme', () => shellTheme())
ensureHandler('app:get-auto-save-default', () => ({ on: true, updatedAt: 0 }))
ensureHandler('app:get-ai-panel-prefs', () => ({
  side: 'right',
  fontSize: 'default',
  showAiSidebar: false,
  openInNewDocs: false,
  spellcheck: false,
}))
ensureHandler('ai:get-settings', () => null)
ensureHandler('ai:skills-list', () => [])
ensureHandler('ai:gsk-status', () => ({ loggedIn: false }))

const api = window.slidesApi as
  | (AnyApi & {
      openPptxPath: (path: string, fitWidth: number) => Promise<unknown>
      save: () => Promise<{ ok?: boolean; path?: string } | null>
      saveAs: (name: string) => Promise<{ ok?: boolean; path?: string } | null>
    })
  | undefined

if (!api) console.error('[slides-host] preload did not expose window.slidesApi')

async function flush(path: string): Promise<void> {
  const adapter = window.__genofficeSlidesAdapter
  if (!adapter?.flush) return
  const bytes = vfs.readBytes(path)
  await adapter.flush(path, bytes)
  adapter.onSaved?.(path, bytes.byteLength)
}

const host = {
  version: 1,
  vfs,
  writeFile(path: string, bytes: Uint8Array | ArrayBuffer | string) {
    return vfs.writeBytes(path, bytes)
  },
  readFile(path: string) {
    return vfs.readBytes(path)
  },
  hasFile(path: string) {
    return vfs.hasFile(path)
  },
  removeFile(path: string) {
    return vfs.removeFile(path)
  },
  normalizePath(path: string) {
    return vfs.normalizePath(path)
  },
  setAdapter(adapter: SlidesAdapter) {
    window.__genofficeSlidesAdapter = adapter
  },
  async openBytes(path: string, bytes: Uint8Array, fitWidth = 960) {
    if (!api) throw new Error('Slides API unavailable')
    vfs.writeBytes(path, bytes)
    const result = await api.openPptxPath(path, fitWidth)
    window.__genofficeSlidesAdapter?.onOpened?.(path)
    return result
  },
  async flush(path: string) {
    await flush(path)
  },
  async flushBytes(path: string, bytes: Uint8Array) {
    vfs.writeBytes(path, bytes)
    await flush(path)
  },
  async saveAndFlush() {
    if (!api) return null
    const result = await api.save()
    if (result && (result as { path?: string }).path) await flush((result as { path: string }).path)
    return result
  },
  async saveAsAndFlush(name: string) {
    if (!api) return null
    const result = await api.saveAs(name)
    if (result && (result as { path?: string }).path) await flush((result as { path: string }).path)
    return result
  },
  api,
}

window.__genofficeSlidesHost = host
window.__genofficeVfs = vfs.vfs
