/**
 * Just enough of Electron to run the Slides main process inside the Android
 * WebView. IPC is an in-page bus; dialogs are routed to the Capacitor adapter.
 */
type Handler = (event: FakeEvent, ...args: unknown[]) => unknown
type Listener = (...args: unknown[]) => void

interface Adapter {
  pickOpenPath?: (options?: unknown) => Promise<string | null>
  pickSavePath?: (defaultName: string, options?: unknown) => Promise<string | null>
  pickDirectory?: () => Promise<string | null>
  pickFiles?: (options?: unknown) => Promise<string[]>
  readVirtualFile?: (path: string) => Uint8Array | null
  writeVirtualFile?: (path: string, bytes: Uint8Array) => void
  openExternal?: (url: string) => void
}

function adapter(): Adapter | undefined {
  return (window as unknown as { __genofficeSlidesAdapter?: Adapter }).__genofficeSlidesAdapter
}

const handlers = new Map<string, Handler>()
const mainListeners = new Map<string, Set<Listener>>()
const rendererListeners = new Map<string, Set<Listener>>()
const readyCallbacks: Array<() => void> = []
let ready = false

function emitMain(channel: string, ...args: unknown[]): void {
  const set = mainListeners.get(channel)
  if (set) for (const fn of [...set]) fn({ sender: fakeSender }, ...args)
}

function emitRenderer(channel: string, ...args: unknown[]): void {
  const set = rendererListeners.get(channel)
  if (set) for (const fn of [...set]) fn({ sender: fakeSender }, ...args)
}

const fakeSender = {
  id: 1,
  send(channel: string, ...args: unknown[]) {
    queueMicrotask(() => emitRenderer(channel, ...args))
  },
  isDestroyed() {
    return false
  },
  focus() {},
  postMessage() {},
  setWindowOpenHandler() {},
  on() {},
  once() {},
  removeListener() {},
  session: {},
  getType() {
    return 'window'
  },
  getURL() {
    return location.href
  },
}

function makeWindow(): Record<string, unknown> {
  return {
    webContents: fakeSender,
    isDestroyed: () => false,
    isFullScreen: () => false,
    isSimpleFullScreen: () => false,
    setFullScreen: () => {},
    setSimpleFullScreen: () => {},
    setFullScreenable: () => {},
    focus: () => {},
    show: () => {},
    hide: () => {},
    close: () => {},
    destroy: () => {},
    on: () => {},
    once: () => {},
    send: (channel: string, ...args: unknown[]) => emitRenderer(channel, ...args),
    setMenu: () => {},
    setMenuBarVisibility: () => {},
    getBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    getContentBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    setTitle: () => {},
    setRepresentedFilename: () => {},
    setDocumentEdited: () => {},
    setBackgroundColor: () => {},
  }
}

const focusedWindow = makeWindow()

class BrowserWindow {
  [key: string]: unknown
  webContents = fakeSender
  static getAllWindows() {
    return [focusedWindow]
  }
  static getFocusedWindow() {
    return focusedWindow
  }
  static fromWebContents() {
    return focusedWindow
  }
  static fromId() {
    return focusedWindow
  }
  constructor() {
    Object.assign(this, makeWindow())
  }
}

class WebContentsView {
  webContents = fakeSender
  constructor() {
    Object.assign(this, makeWindow())
  }
  setBounds() {}
}

const ipcMain = {
  handle(channel: string, fn: Handler) {
    handlers.set(channel, fn)
  },
  handleOnce(channel: string, fn: Handler) {
    handlers.set(channel, fn)
  },
  removeHandler(channel: string) {
    handlers.delete(channel)
  },
  on(channel: string, fn: Listener) {
    let set = mainListeners.get(channel)
    if (!set) mainListeners.set(channel, (set = new Set()))
    set.add(fn)
  },
  once(channel: string, fn: Listener) {
    const wrapped = (...args: unknown[]) => {
      mainListeners.get(channel)?.delete(wrapped)
      fn(...args)
    }
    ipcMain.on(channel, wrapped)
  },
  removeListener(channel: string, fn: Listener) {
    mainListeners.get(channel)?.delete(fn)
  },
  removeAllListeners(channel: string) {
    mainListeners.delete(channel)
  },
  emit(channel: string, ...args: unknown[]) {
    emitMain(channel, ...args)
  },
}

const ipcRenderer = {
  async invoke(channel: string, ...args: unknown[]) {
    const fn = handlers.get(channel)
    if (!fn) return fallbackInvoke(channel, args)
    try {
      return await fn({ sender: fakeSender } as FakeEvent, ...args)
    } catch (err) {
      console.error(`[slides-host] ipc ${channel} failed`, err)
      throw err
    }
  },
  send(channel: string, ...args: unknown[]) {
    emitMain(channel, ...args)
  },
  sendSync(channel: string, ...args: unknown[]) {
    void channel
    void args
    return null
  },
  on(channel: string, fn: Listener) {
    let set = rendererListeners.get(channel)
    if (!set) rendererListeners.set(channel, (set = new Set()))
    set.add(fn)
    return ipcRenderer
  },
  once(channel: string, fn: Listener) {
    const wrapped = (...args: unknown[]) => {
      rendererListeners.get(channel)?.delete(wrapped)
      fn(...args)
    }
    ipcRenderer.on(channel, wrapped)
    return ipcRenderer
  },
  removeListener(channel: string, fn: Listener) {
    rendererListeners.get(channel)?.delete(fn)
    return ipcRenderer
  },
  removeAllListeners(channel: string) {
    rendererListeners.delete(channel)
    return ipcRenderer
  },
}

function fallbackInvoke(channel: string, args: unknown[]): unknown {
  if (channel === 'app:get-theme') {
    try {
      const stored = localStorage.getItem('genoffice.shell.theme.v1')
      const value = stored ? JSON.parse(stored) : 'system'
      return value === 'dark' || value === 'light' ? value : 'system'
    } catch {
      return 'system'
    }
  }
  if (channel === 'app:get-language') {
    try {
      const stored = localStorage.getItem('genoffice.android.lang')
      return stored ? JSON.parse(stored) : 'id'
    } catch {
      return 'id'
    }
  }
  if (channel === 'app:get-auto-save-default') return { on: true, updatedAt: 0 }
  if (channel === 'app:get-ai-panel-prefs') {
    return {
      side: 'right',
      fontSize: 'default',
      showAiSidebar: false,
      openInNewDocs: false,
      spellcheck: false,
    }
  }
  if (channel === 'ai:get-settings') return null
  if (channel === 'ai:skills-list') return []
  if (channel === 'ai:gsk-status') return { loggedIn: false }
  if (/^on[A-Z]/.test(channel)) return () => {}
  if (/^(is|has|can)/.test(channel)) return false
  if (channel.startsWith('slides:font-') || channel.includes('font-catalog')) return null
  void args
  return null
}

const app = {
  isPackaged: false,
  isReady: () => true,
  whenReady: () =>
    new Promise<void>((resolve) => {
      if (ready) resolve()
      else readyCallbacks.push(resolve)
    }),
  on(_event: string, _fn: Listener) {},
  once(_event: string, _fn: Listener) {},
  off(_event: string, _fn: Listener) {},
  emit(_event: string, ..._args: unknown[]) {},
  quit() {},
  exit() {},
  getPath(name: string) {
    if (name === 'userData') return '.genoffice'
    if (name === 'temp' || name === 'sessionData') return '.genoffice/tmp'
    // The host VFS is rooted at the real Documents/GenOffice folder, so the
    // Electron 'documents' path is the VFS root. configuredDefaultSaveDir()
    // appends its own 'GenOffice' segment, yielding the correct draft folder.
    if (name === 'documents' || name === 'downloads' || name === 'desktop') return ''
    return `.genoffice/${name || 'path'}`
  },
  setPath(_name: string, _path: string) {},
  getVersion() {
    return '1.0.0-android'
  },
  getName() {
    return 'GenOffice'
  },
  getLocale() {
    return 'id'
  },
  getSystemLocale() {
    return 'id'
  },
  getAppMetrics() {
    return []
  },
  getGPUFeatureStatus() {
    return {}
  },
  commandLine: {
    appendSwitch() {},
    appendArgument() {},
    hasSwitch: () => false,
    getSwitchValue: () => '',
  },
  requestSingleInstanceLock: () => true,
  releaseSingleInstanceLock() {},
  setAppUserModelId() {},
  dock: { hide() {}, show() {} },
  focus() {},
}

const dialog = {
  // Electron overloads these as (options) or (parent, options). The desktop
  // helpers call both shapes, so read whichever argument is the options object.
  async showOpenDialog(...args: unknown[]) {
    const options = args.length > 1 ? args[1] : args[0]
    const path = await adapter()?.pickOpenPath?.(options)
    return path ? { canceled: false, filePaths: [path] } : { canceled: true, filePaths: [] }
  },
  async showSaveDialog(...args: unknown[]) {
    const options = (args.length > 1 ? args[1] : args[0]) as
      | { defaultPath?: string }
      | undefined
    const name =
      String(options?.defaultPath || 'Untitled presentation.pptx')
        .replace(/\\/g, '/')
        .split('/')
        .pop() || 'Untitled presentation.pptx'
    const path = await adapter()?.pickSavePath?.(name, options)
    return path ? { canceled: false, filePath: path } : { canceled: true, filePath: undefined }
  },
  async showMessageBox() {
    return { response: 1, checkboxChecked: false }
  },
  async showMessageBoxSync() {
    return 1
  },
  async showErrorBox(_title: string, content: string) {
    console.error('[slides-host]', content)
  },
}

const shell = {
  openExternal(url: string) {
    adapter()?.openExternal?.(url)
    return Promise.resolve()
  },
  openPath(path: string) {
    adapter()?.openExternal?.(path)
    return Promise.resolve('')
  },
  showItemInFolder() {},
  beep() {},
}

const clipboard = {
  readText: () => '',
  writeText: () => {},
  readImage: () => nativeImage.createEmpty(),
  writeImage: () => {},
  read: () => [],
  write: () => {},
  clear: () => {},
  availableFormats: () => [],
}

const nativeImage = {
  createEmpty() {
    return {
      isEmpty: () => true,
      toPNG: () => new Uint8Array(),
      toJPEG: () => new Uint8Array(),
      toDataURL: () => '',
      getSize: () => ({ width: 0, height: 0 }),
      resize: () => nativeImage.createEmpty(),
    }
  },
  createFromBuffer() {
    return nativeImage.createEmpty()
  },
  createFromDataURL() {
    return nativeImage.createEmpty()
  },
  createFromPath() {
    return nativeImage.createEmpty()
  },
}

const webContents = {
  fromId(id: number) {
    void id
    return fakeSender
  },
  getAllWebContents() {
    return [fakeSender]
  },
}

const webUtils = {
  getPathForFile(file: File) {
    return (file as File & { path?: string }).path || file.name
  },
}

const contextBridge = {
  exposeInMainWorld(name: string, value: unknown) {
    Object.defineProperty(window, name, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    })
  },
}

const session = {
  defaultSession: {
    setDisplayMediaRequestHandler() {},
    setPermissionRequestHandler() {},
    resolveProxy: async () => 'DIRECT',
  },
  fromPartition: () => session.defaultSession,
}

const Menu = {
  buildFromTemplate: () => ({ popup() {}, closePopup() {} }),
  setApplicationMenu() {},
  getApplicationMenu: () => null,
}

const net = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  resolveProxy: async () => 'DIRECT',
}

const systemPreferences = {
  getAccentColor: () => '0078d4',
  getEffectiveAppearance: () => 'light',
  isDarkMode: () => false,
  subscribeNotification: () => {},
}

class Notification {
  show() {}
  close() {}
  static isSupported() {
    return false
  }
}

export {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  ipcRenderer,
  dialog,
  shell,
  clipboard,
  nativeImage,
  webContents,
  webUtils,
  contextBridge,
  session,
  Menu,
  net,
  systemPreferences,
  Notification,
}
export const screen = {
  getPrimaryDisplay: () => ({ bounds: { width: 0, height: 0 }, scaleFactor: 1 }),
  getAllDisplays: () => [],
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  getDisplayMatching: () => ({ bounds: { width: 0, height: 0 }, scaleFactor: 1 }),
}
export const globalShortcut = {
  register: () => true,
  unregister: () => {},
  unregisterAll: () => {},
  isRegistered: () => false,
}
export const desktopCapturer = {
  getSources: async () => [],
}
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
}
export const utilityProcess = {
  fork: () => null,
}
export const protocol = {
  registerSchemesAsPrivileged() {},
  handle() {},
}
export const crashReporter = {
  start() {},
}
export const powerMonitor = {
  on() {},
}
export const screenCapture = {}
export const defaultSession = session.defaultSession
export type WebContents = typeof fakeSender
export type BrowserWindowType = typeof BrowserWindow
export type IpcRendererEvent = { sender: unknown }
export type FakeEvent = { sender: typeof fakeSender; returnValue?: unknown }
