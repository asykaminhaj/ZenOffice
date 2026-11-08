/* GenOffice Android shell: desktop-style home, file tabs and persistent iframes. */
;(function () {
  'use strict'

  const LS = 'genoffice.shell.'
  const RECENTS_KEY = LS + 'recents.v1'
  const STARRED_KEY = LS + 'starred.v1'
  const TABS_KEY = LS + 'tabs.v2'
  const ACTIVE_KEY = LS + 'active.v2'
  const THEME_KEY = LS + 'theme.v1'

  const APP_META = {
    docs: { title: 'Docs', sub: '.docx', icon: 'file-docx.png' },
    sheets: { title: 'Sheets', sub: '.xlsx', icon: 'file-xlsx.png' },
    slides: { title: 'Slides', sub: '.pptx', icon: 'file-pptx.png' },
    pdf: { title: 'PDF', sub: '.pdf', icon: 'file-pdf.png' },
    markdown: { title: 'Markdown', sub: '.md', icon: 'file-md.png' },
    html: { title: 'HTML', sub: '.html', icon: 'file-html.png' },
  }

  const EXT_APP = {
    docx: 'docs',
    xlsx: 'sheets',
    xlsm: 'sheets',
    csv: 'sheets',
    pptx: 'slides',
    odp: 'slides',
    pdf: 'pdf',
    md: 'markdown',
    markdown: 'markdown',
    txt: 'markdown',
    html: 'html',
    htm: 'html',
  }

  const NEW_DEFS = {
    docx: { app: 'docs', name: 'Untitled.docx' },
    xlsx: { app: 'sheets', name: 'Untitled.xlsx' },
    pptx: { app: 'slides', name: 'Untitled.pptx' },
    md: { app: 'markdown', name: 'Untitled.md' },
    html: { app: 'html', name: 'Untitled.html' },
    pdf: { app: 'pdf', name: 'Untitled.pdf' },
  }

  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'docs', label: 'Docs' },
    { id: 'sheets', label: 'Sheets' },
    { id: 'slides', label: 'Slides' },
    { id: 'pdf', label: 'PDFs' },
    { id: 'markdown', label: 'Notes' },
    { id: 'html', label: 'Web' },
  ]

  const $ = (sel) => document.querySelector(sel)

  const el = {
    app: $('#app'),
    tabstrip: $('#tabstrip'),
    tabMenu: $('#tabbar-menu'),
    home: $('#home'),
    homeView: $('#home-view'),
    homeScroll: $('#home-scroll'),
    frames: $('#frames'),
    loading: $('#frame-loading'),
    popover: $('#popover'),
    toast: $('#toast'),
    openLocal: $('#open-local'),
    brandHome: $('#brand-home'),
    aboutButton: $('#about-button'),
  }

  const state = {
    tabs: [],
    active: 'home',
    view: 'recent',
    filter: 'all',
    query: '',
    recents: readJson(RECENTS_KEY, []),
    starred: readJson(STARRED_KEY, {}),
    files: [],
    filesLoaded: false,
    theme: readJson(THEME_KEY, 'system'),
    popoverHandlers: [],
    loadingTab: null,
  }

  // ── storage helpers ──────────────────────────────────────────────────────

  function readJson(key, fallback) {
    try {
      const value = localStorage.getItem(key)
      if (value == null) return fallback
      return JSON.parse(value)
    } catch (e) {
      return fallback
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
      /* private mode / quota: the current session still works */
    }
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'tab_' + window.crypto.randomUUID().slice(0, 13)
    }
    return 'tab_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }

  // ── naming / icons / dates ───────────────────────────────────────────────

  function basename(path) {
    const value = String(path || '').replace(/\\/g, '/')
    return value.slice(value.lastIndexOf('/') + 1) || 'Untitled'
  }

  function extension(name) {
    const base = basename(name)
    const i = base.lastIndexOf('.')
    return i > 0 ? base.slice(i + 1).toLowerCase() : ''
  }

  function stem(name) {
    const base = basename(name)
    const i = base.lastIndexOf('.')
    return i > 0 ? base.slice(0, i) : base
  }

  function appForName(name) {
    return EXT_APP[extension(name)] || ''
  }

  function iconForName(name) {
    const app = appForName(name)
    if (app) return './shim/assets/' + APP_META[app].icon
    const ext = extension(name)
    if (ext === 'txt') return './shim/assets/file-txt.svg'
    return './shim/assets/file-docx.png'
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0
    if (n <= 0) return '—'
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB'
    return (n / (1024 * 1024)).toFixed(1) + ' MB'
  }

  function formatDate(value) {
    const date = new Date(Number(value) || 0)
    if (!date.getTime()) return '—'
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (day === start) return 'Today, ' + time
    if (day === start - 86400000) return 'Yesterday'
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
    return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
  }

  function greeting() {
    const hour = new Date().getHours()
    if (hour < 5) return 'Good night'
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }

  // ── theme ────────────────────────────────────────────────────────────────

  function applyTheme() {
    const theme = state.theme === 'dark' || state.theme === 'light' ? state.theme : 'system'
    document.documentElement.setAttribute('data-theme', theme)
  }

  function toggleTheme() {
    const darkNow =
      state.theme === 'dark' ||
      (state.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
    state.theme = darkNow ? 'light' : 'dark'
    writeJson(THEME_KEY, state.theme)
    applyTheme()
    toast(state.theme === 'dark' ? 'Dark mode on' : 'Light mode on')
  }

  // ── recent files / stars ─────────────────────────────────────────────────

  function recordRecent(input) {
    if (!input || !input.path) return
    const path = input.path
    const now = Date.now()
    const name = input.name || basename(path)
    const app = input.app || appForName(path) || appForName(name)
    const prior = state.recents.find((item) => item.path === path)
    const next = {
      path: path,
      name: name,
      app: app,
      at: now,
      size: Number(input.size) || (prior && prior.size) || 0,
      modified: Number(input.modified) || (prior && prior.modified) || now,
      fileBlobId: input.fileBlobId || (prior && prior.fileBlobId) || null,
    }
    state.recents = [next, ...state.recents.filter((item) => item.path !== path)].slice(0, 60)
    writeJson(RECENTS_KEY, state.recents)
  }

  function isStarred(path) {
    return !!(path && state.starred[path])
  }

  function toggleStar(path) {
    if (!path) return
    if (state.starred[path]) delete state.starred[path]
    else state.starred[path] = Date.now()
    writeJson(STARRED_KEY, state.starred)
    if (state.view === 'starred') renderHome()
    else renderFileRows()
  }

  function fileEntryFromDisk(file) {
    const name = file && file.name ? file.name : ''
    if (!name || !appForName(name)) return null
    return {
      path: 'ZenOffice/' + basename(name),
      name: name,
      app: appForName(name),
      at: Number(file.mtime) || 0,
      modified: Number(file.mtime) || 0,
      size: Number(file.size) || 0,
      onDisk: true,
    }
  }

  function collectionEntries() {
    const byPath = new Map()
    for (const item of state.recents) {
      if (!item || !item.path) continue
      byPath.set(item.path, {
        path: item.path,
        name: item.name || basename(item.path),
        app: item.app || appForName(item.name || item.path),
        at: item.at || 0,
        modified: item.modified || item.at || 0,
        size: item.size || 0,
        fileBlobId: item.fileBlobId || null,
      })
    }
    for (const file of state.files) {
      if (!file) continue
      const prior = byPath.get(file.path) || {}
      byPath.set(
        file.path,
        Object.assign({}, prior, file, {
          at: prior.at || file.modified || 0,
          modified: file.modified || prior.modified || 0,
          size: file.size || prior.size || 0,
          fileBlobId: prior.fileBlobId || file.fileBlobId || null,
        }),
      )
    }
    let entries = Array.from(byPath.values())
    if (state.view === 'starred') entries = entries.filter((item) => isStarred(item.path))
    if (state.filter && state.filter !== 'all') {
      entries = entries.filter((item) => item.app === state.filter)
    }
    if (state.query) {
      const q = state.query.toLowerCase()
      entries = entries.filter((item) => String(item.name || '').toLowerCase().includes(q))
    }
    entries.sort((a, b) => {
      if (state.view === 'files') return (b.modified || 0) - (a.modified || 0)
      return (b.at || b.modified || 0) - (a.at || a.modified || 0)
    })
    return entries
  }

  function openTabForPath(path) {
    return state.tabs.find((tab) => tab.path && tab.path === path) || null
  }

  function tabTitle(name) {
    return stem(name || 'Untitled') || 'Untitled'
  }

  // ── tab strip ────────────────────────────────────────────────────────────

  // ── "+" new-file popup (WPS style) ───────────────────────────────────────

  // Animasi close (meniru pop-out ghost di android-shim): fade 150ms + scale kecil, lalu dibuang
  const zenReduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  function ghostOut(node, cls) {
    if (!node || !node.isConnected) return
    if (zenReduceMotion) {
      node.remove()
      return
    }
    node.classList.add(cls)
    node.setAttribute('aria-hidden', 'true')
    try { node.inert = true } catch (e) { /* engine lama */ }
    setTimeout(function () { node.remove() }, 180)
  }

  function closeNewMenu() {
    const m = document.getElementById('zen-newmenu')
    if (!m) return
    m.removeAttribute('id')
    ghostOut(m, 'zen-out-pop')
  }

  function showNewMenu(anchor) {
    if (document.getElementById('zen-newmenu')) {
      closeNewMenu()
      return
    }
    const def = getPrefs().format
    const item = function (kind, label, file) {
      const isDef = kind === def
      return '<button type="button" class="zen-new-item' + (isDef ? ' is-default' : '') + '" data-new-kind="' + kind + '">' +
        '<img src="' + iconForName(file) + '" alt="" /><span>' + label + '</span>' +
        (isDef ? '<small>Default</small>' : '') +
        '<em class="zen-new-ext">' + file.slice(file.lastIndexOf('.')) + '</em></button>'
    }
    const m = document.createElement('div')
    m.id = 'zen-newmenu'
    m.className = 'zen-newmenu'
    m.setAttribute('role', 'menu')
    m.innerHTML =
      '<div class="zen-new-banner"><svg viewBox="0 0 440 96" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">' +
      '<path d="M0 66Q110 22 220 58T440 36V96H0Z" opacity=".35"/>' +
      '<path d="M0 80Q120 40 240 74T440 56V96H0Z" opacity=".45"/>' +
      '<path class="zen-new-wave3" d="M0 92Q140 62 260 88T440 76V96H0Z" opacity=".5"/></svg><h4>New</h4></div>' +
      '<div class="zen-new-label">Office Document</div>' +
      '<div class="zen-new-grid">' + item('docx', 'Docs', 'x.docx') + item('xlsx', 'Sheets', 'x.xlsx') +
      item('pptx', 'Slides', 'x.pptx') + item('pdf', 'PDF', 'x.pdf') + '</div>' +
      '<div class="zen-new-label">Notes &amp; Web</div>' +
      '<div class="zen-new-grid">' + item('md', 'Markdown', 'x.md') + item('html', 'HTML', 'x.html') + '</div>' +
      '<button type="button" class="zen-new-open" data-new-open>Open local file…</button>'
    document.body.appendChild(m)
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(340, window.innerWidth - 16)
    m.style.width = width + 'px'
    m.style.left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8) + 'px'
    m.style.top = rect.bottom + 6 + 'px'
    m.addEventListener('click', function (e) {
      const k = e.target.closest('[data-new-kind]')
      if (k) {
        closeNewMenu()
        void newFile(k.dataset.newKind)
        return
      }
      if (e.target.closest('[data-new-open]')) {
        closeNewMenu()
        void openLocalFile()
      }
    })
  }

  document.addEventListener('click', function (e) {
    const m = document.getElementById('zen-newmenu')
    if (m && !m.contains(e.target)) closeNewMenu()
  })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeNewMenu()
  })

  // Split screen / jendela kecil: tab menempel ke atas (tanpa inset atas)
  function syncWindowMode() {
    const windowed = window.innerWidth < screen.width * 0.92 || window.innerHeight < screen.height * 0.88
    document.documentElement.classList.toggle('zen-windowed', windowed)
  }
  window.addEventListener('resize', syncWindowMode)
  window.addEventListener('orientationchange', syncWindowMode)
  syncWindowMode()

  // Menus (hamburger popover + "New" popup) close on any press outside them,
  // including presses inside editor iframes, which never reach this document.
  function dismissShellMenus() {
    closeNewMenu()
    if (!el.popover.hidden) closePopover()
  }
  function hookFrameDismiss(frame) {
    try {
      const d = frame.contentDocument
      if (d) d.addEventListener('pointerdown', dismissShellMenus, true)
    } catch (e) {
      /* cross-origin frame: the window blur below still covers it */
    }
  }
  document.addEventListener('pointerdown', function (e) {
    const t = e.target
    if (t instanceof Element && t.closest('#popover, #zen-newmenu, #tabbar-menu, [data-new-tab]')) return
    dismissShellMenus()
  }, true)
  window.addEventListener('blur', dismissShellMenus)

  let tabEnterId = null
  let tabEnterAt = 0
  const TAB_ANIM_MS = 480
  const TAB_LEAVE_MS = 400
  let tabBounceId = null
  let tabBounceAt = 0
  const TAB_BOUNCE_MS = 380
  function tabFx(id) {
    const now = performance.now()
    if (id === tabEnterId && now - tabEnterAt < TAB_ANIM_MS) {
      return { cls: ' tab-enter', style: ' style="animation-delay:-' + Math.round(now - tabEnterAt) + 'ms"' }
    }
    if (id === tabBounceId && now - tabBounceAt < TAB_BOUNCE_MS) {
      return { cls: ' tab-bounce', style: ' style="animation-delay:-' + Math.round(now - tabBounceAt) + 'ms"' }
    }
    return { cls: '', style: '' }
  }

  function renderTabs() {
    const homeFx = tabFx('home')
    const home = `
      <div class="tab tab-home ${state.active === 'home' ? 'active' : ''}${homeFx.cls}"${homeFx.style} role="tab"
           tabindex="0" aria-selected="${state.active === 'home'}" data-tab="home">
        <img class="tab-icon tab-icon-home" src="./shim/assets/zenoffice-logo.png" alt="" />
        <span class="tab-title">ZenOffice</span>
      </div>`

    const tabs = state.tabs
      .map((tab) => {
        const active = state.active === tab.id
        const fx = tabFx(tab.id)
        return `
        <div class="tab ${active ? 'active' : ''}${fx.cls}"${fx.style} role="tab" tabindex="${active ? '0' : '-1'}"
             aria-selected="${active}" data-tab="${escapeHtml(tab.id)}"
             title="${escapeHtml(tab.path || tab.name || '')}">
          <img class="tab-icon" src="${iconForName(tab.name)}" alt="" />
          <span class="tab-title">${escapeHtml(tabTitle(tab.name))}</span>
          ${tab.dirty ? '<span class="tab-dot" title="Unsaved changes"></span>' : ''}
          <button class="tab-close" type="button" data-close="${escapeHtml(tab.id)}"
                  aria-label="Close ${escapeHtml(tabTitle(tab.name))}">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>
          </button>
        </div>`
      })
      .join('')

    const plus = `
      <button class="icon-btn tab-new" type="button" data-new-tab aria-label="New" aria-haspopup="menu">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
      </button>`
    el.tabstrip.innerHTML = home + tabs + plus
    const activeEl = el.tabstrip.querySelector('.tab.active')
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function persistTabs() {
    const restorable = state.tabs
      .filter((tab) => tab.path)
      .map((tab) => ({
        id: tab.id,
        app: tab.app,
        name: tab.name,
        path: tab.path,
      }))
    writeJson(TABS_KEY, restorable)
    writeJson(ACTIVE_KEY, state.active)
  }

  function restoreTabs() {
    const saved = readJson(TABS_KEY, [])
    if (!Array.isArray(saved)) return
    const seen = new Set()
    state.tabs = saved
      .filter((item) => item && item.path && item.app && APP_META[item.app])
      .filter((item) => {
        if (seen.has(item.path)) return false
        seen.add(item.path)
        return true
      })
      .slice(0, 10)
      .map((item) => ({
        id: item.id || uid(),
        app: item.app,
        name: item.name || basename(item.path),
        path: item.path,
        pending: false,
        newKind: '',
        dirty: false,
        autoSave: true,
      }))
    const active = readJson(ACTIVE_KEY, 'home')
    if (active && active !== 'home' && state.tabs.some((tab) => tab.id === active)) {
      state.active = active
    }
  }

  // Android back button handler
  window.__genofficeHandleBack = async function() {
    try {
      // If we're in a tab (editor), check for unsaved changes
      if (state.active && state.active !== 'home') {
        const tab = state.tabs.find((item) => item.id === state.active)
        if (tab && tab.dirty) {
          const action = await showCloseConfirmDialog(tab)
          if (action === 'cancel') return true
          if (action === 'save') {
            try {
              await requestSave(tab)
            } catch (e) {
              toast('Could not save: ' + e.message)
              return true
            }
          }
          // action === 'discard' falls through to close
        }
        activateTab('home')
        return true
      }
      // We're on home - let app exit
      return false
    } catch (e) {
      return false
    }
  }
  window.__genofficeShouldExitApp = function() {
    return !(state.active && state.active !== 'home')
  }

  function activateTab(id) {
    if (id !== 'home' && !state.tabs.some((tab) => tab.id === id)) return
    dismissShellMenus()
    const prevActive = state.active
    state.active = id
    if (id !== prevActive && !(id === tabEnterId && performance.now() - tabEnterAt < TAB_ANIM_MS)) {
      tabBounceId = id
      tabBounceAt = performance.now()
    }
    renderTabs()
    persistTabs()

    if (id === 'home') {
      el.home.classList.remove('is-hidden')
      el.frames.classList.add('is-hidden')
      el.loading.hidden = true
      renderHome()
      el.homeScroll.scrollTop = 0
      if (prevActive !== 'home') playViewEnter()
      return
    }

    const tab = state.tabs.find((item) => item.id === id)
    el.home.classList.add('is-hidden')
    el.frames.classList.remove('is-hidden')

    const frames = el.frames.querySelectorAll('.doc-frame')
    for (const frame of frames) {
      frame.classList.toggle('active', frame.dataset.tab === id)
    }

    ensureFrame(tab)
    updateLoading(tab)
  }

  function ensureFrame(tab) {
    let frame = el.frames.querySelector(`.doc-frame[data-tab="${cssEscape(tab.id)}"]`)
    if (frame && frame.dataset.loaded === '1') {
      // activateTab flips existing frames before ensureFrame runs, but a
      // frame created during this activation still belongs to the active tab.
      frame.classList.toggle('active', state.active === tab.id)
      return frame
    }
    if (!frame) {
      frame = document.createElement('iframe')
      frame.className = 'doc-frame'
      frame.dataset.tab = tab.id
      frame.dataset.loaded = '0'
      frame.classList.toggle('active', state.active === tab.id)
      frame.setAttribute('title', tabTitle(tab.name))
      frame.setAttribute('allow', 'clipboard-read; clipboard-write')
      el.frames.appendChild(frame)
      frame.addEventListener('load', function () {
        frame.dataset.loaded = '1'
        hookFrameDismiss(frame)
        frame.classList.toggle('active', state.active === tab.id)
        if (state.active === tab.id) updateLoading(tab)
      })
      frame.src = frameSource(tab)
    } else if (!frame.src) {
      frame.src = frameSource(tab)
      frame.classList.toggle('active', state.active === tab.id)
    }
    return frame
  }

  function frameSource(tab) {
    const url = new URL('./' + tab.app + '/index.html', window.location.href)
    url.searchParams.set('tab', tab.id)
    url.searchParams.set('shell', '1')
    if (tab.path) url.searchParams.set('path', tab.path)
    else if (tab.newKind) url.searchParams.set('new', tab.newKind)
    else url.searchParams.set('handoff', 'tab:' + tab.id)
    if (tab.fileBlobId) url.searchParams.set('fileBlobId', tab.fileBlobId)
    return url.href
  }

  function updateLoading(tab) {
    if (!tab || state.active !== tab.id) {
      el.loading.hidden = true
      return
    }
    const frame = el.frames.querySelector(`.doc-frame[data-tab="${cssEscape(tab.id)}"]`)
    if (frame && frame.dataset.loaded === '1') {
      el.loading.hidden = true
      state.loadingTab = null
    } else {
      el.loading.hidden = false
      state.loadingTab = tab.id
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
    return String(value).replace(/["\\]/g, '\\$&')
  }

  async function createTab(options) {
    const def = NEW_DEFS[options.kind || '']
    const app = options.app || (def && def.app) || appForName(options.name)
    if (!app || !APP_META[app]) {
      toast('This file type is not supported yet')
      return null
    }
    if (options.path && openTabForPath(options.path)) {
      activateTab(openTabForPath(options.path).id)
      return openTabForPath(options.path)
    }

    const id = uid()
    let file = options.file || null
    if (options.kind === 'pdf' && !file && !options.path) {
      try {
        file = new File([makeBlankPdf()], 'Untitled.pdf', { type: 'application/pdf' })
      } catch (e) {
        console.error(e)
      }
    }
    if (file) {
      const bridge = window.__genofficeAndroid
      if (!bridge || !bridge.putPending) {
        toast('File bridge unavailable')
        return null
      }
      try {
        await bridge.putPending('tab:' + id, file)
      } catch (e) {
        console.error(e)
        toast('Could not prepare the file')
        return null
      }
    }

    console.log('[createTab] Creating tab:', { app, name: options.name, path: options.path, fileBlobId: options.fileBlobId, pending: !!file })

    const tab = {
      id: id,
      app: app,
      name: options.name || (file && file.name) || (def && def.name) || 'Untitled',
      path: options.path || '',
      pending: !!file,
      newKind: options.path || file ? '' : options.kind || '',
      dirty: false,
      autoSave: true,
      fileBlobId: options.fileBlobId || null,
    }
    state.tabs.unshift(tab)
    tabEnterId = tab.id
    tabEnterAt = performance.now()
    renderTabs()
    activateTab(tab.id)
    persistTabs()
    return tab
  }

  async function closeTab(id) {
    const tab = state.tabs.find((item) => item.id === id)
    if (!tab || tab.closing) return false
    if (tab.dirty) {
      const action = await showCloseConfirmDialog(tab)
      if (action === 'cancel') return false
      if (action === 'save') {
        try {
          await requestSave(tab)
        } catch (e) {
          toast('Could not save: ' + e.message)
          return false
        }
      }
      if (action === 'discard' && tab.path && window.__zenRecovery) {
        try { window.__zenRecovery.clear(tab.path).catch(function () {}) } catch (e) {}
      }
      // action === 'discard' falls through to close without saving
    }
    tab.closing = true
    const leaveEl = el.tabstrip.querySelector('.tab[data-tab="' + cssEscape(id) + '"]')
    if (leaveEl && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      leaveEl.classList.add('tab-leave')
      await new Promise(function (r) { setTimeout(r, TAB_LEAVE_MS) })
    }
    const index = state.tabs.indexOf(tab)
    if (index < 0) return false
    state.tabs.splice(index, 1)
    const frame = el.frames.querySelector(`.doc-frame[data-tab="${cssEscape(id)}"]`)
    if (frame) frame.remove()

    if (state.active === id) {
      const next = state.tabs[Math.max(0, index - 1)] || state.tabs[index]
      activateTab(next ? next.id : 'home')
    } else {
      renderTabs()
      persistTabs()
    }
    return true
  }

  function closeOtherTabs() {
    dismissShellMenus()
    const keep = state.active === 'home' ? null : state.active
    for (const tab of state.tabs.slice()) {
      if (tab.id !== keep) closeTab(tab.id)
    }
    toast('Other tabs closed')
  }

  // Expose API for apps to open new tabs
  window.__genofficeOpenTab = function(options) {
    return createTab(options)
  }

  function findTabByMessage(data, source) {
    if (data && data.tab) {
      const byId = state.tabs.find((tab) => tab.id === data.tab)
      if (byId) return byId
    }
    const frames = el.frames.querySelectorAll('.doc-frame')
    for (const frame of frames) {
      if (frame.contentWindow === source) return state.tabs.find((tab) => tab.id === frame.dataset.tab)
    }
    return null
  }

  function prepareFrameForPrint(tabId) {
    const frame = el.frames.querySelector(`.doc-frame[data-tab="${cssEscape(tabId)}"]`)
    if (!frame) throw new Error('The print preview tab is not available')
    const doc = frame.contentDocument
    if (!doc) throw new Error('The print preview is not ready')
    const prev = {
      width: frame.style.width,
      height: frame.style.height,
      visibility: frame.style.visibility,
    }
    document.documentElement.classList.add('genoffice-print-mode')
    try {
      const page = doc.querySelector('.pv-page, .page-wrap, .doc-page')
      const preview = doc.querySelector('.pagination-preview')
      const scroller = preview && preview.querySelector('.pv-scroll')
      const width = Math.max(
        document.documentElement.clientWidth || 0,
        (page && page.getBoundingClientRect().width) || 0,
        (page && page.offsetWidth) || 0,
      )
      if (width > 0) frame.style.width = Math.ceil(width) + 'px'
      frame.style.visibility = 'visible'
      // Force the iframe to lay out at its new width before measuring how many
      // stacked .pv-page sheets have to fit in the printable document.
      void frame.offsetWidth
      let height = Math.max(
        (doc.documentElement && doc.documentElement.scrollHeight) || 0,
        (doc.body && doc.body.scrollHeight) || 0,
        (scroller && scroller.scrollHeight) || 0,
      )
      if (height < 400) height = Math.max(frame.clientHeight || 0, 1200)
      frame.style.height = Math.ceil(height + 16) + 'px'
      try {
        frame.contentWindow.scrollTo(0, 0)
        frame.contentWindow.dispatchEvent(new Event('resize'))
      } catch (e) {
        /* layout measurement above is enough */
      }
      void frame.offsetHeight
    } catch (err) {
      document.documentElement.classList.remove('genoffice-print-mode')
      frame.style.width = prev.width
      frame.style.height = prev.height
      frame.style.visibility = prev.visibility
      throw err
    }
    return function restore() {
      document.documentElement.classList.remove('genoffice-print-mode')
      frame.style.width = prev.width
      frame.style.height = prev.height
      frame.style.visibility = prev.visibility
    }
  }

  function replyToPrintRequest(source, origin, id, payload) {
    try {
      source.postMessage(Object.assign({ __genofficePrintResult: true, id: id }, payload), origin)
    } catch (e) {
      /* the tab was closed while printing */
    }
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return
    const data = event.data
    if (!data || data.__genofficePrint !== true) return
    const id = String(data.id || '')
    const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PdfExport
    if (!plugin) {
      replyToPrintRequest(event.source, event.origin, id, {
        error: 'Native PDF export is not available in this build',
      })
      return
    }
    let restore = null
    void (async function () {
      try {
        let result
        if (data.method === 'printSystem') {
          result = await plugin.printSystem({
            html: String(data.html || ''),
            baseUrl: String(data.baseUrl || window.location.href),
            jobName: String(data.jobName || 'ZenOffice'),
            delayMs: Number(data.delayMs) || 700,
            widthIn: Number(data.widthIn) || 8.27,
            heightIn: Number(data.heightIn) || 11.69,
            monochrome: data.monochrome === true,
            duplex: String(data.duplex || 'simplex'),
          })
          replyToPrintRequest(event.source, event.origin, id, {
            ok: !!result && result.ok !== false,
            canceled: !!result && result.canceled === true,
          })
          return
        }
        if (data.method === 'printCurrent') {
          const tab = findTabByMessage(data, event.source)
          if (!tab) throw new Error('The print preview tab is not available')
          restore = prepareFrameForPrint(tab.id)
          result = await plugin.printCurrent({
            widthIn: Number(data.widthIn) || 8.27,
            heightIn: Number(data.heightIn) || 11.69,
            delayMs: 550,
          })
        } else {
          result = await plugin.printHtml({
            html: String(data.html || ''),
            baseUrl: String(data.baseUrl || window.location.href),
            delayMs: Number(data.delayMs) || 700,
            widthIn: Number(data.widthIn) || 8.27,
            heightIn: Number(data.heightIn) || 11.69,
          })
        }
        if (!result || !result.base64) throw new Error('The PDF engine returned no document')
        replyToPrintRequest(event.source, event.origin, id, {
          base64: result.base64,
          size: Number(result.size) || 0,
        })
      } catch (err) {
        replyToPrintRequest(event.source, event.origin, id, {
          error: String((err && err.message) || err),
        })
      } finally {
        if (restore) restore()
      }
    })()
  })

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return
    const data = event.data
    if (!data || data.__genofficeShell !== true) return
    const tab = findTabByMessage(data, event.source)
    if (!tab) return

    if (data.type === 'opened' || data.type === 'saved') {
      if (data.path) tab.path = data.path
      if (data.fileBlobId && !tab.fileBlobId) tab.fileBlobId = data.fileBlobId
      if (data.name) tab.name = data.name || basename(data.path)
      if (!tab.name && tab.path) tab.name = basename(tab.path)
      tab.pending = false
      tab.newKind = ''
      if (data.type === 'saved') tab.dirty = false
      recordRecent({ path: tab.path, name: tab.name, app: tab.app, size: data.size, fileBlobId: tab.fileBlobId })
      renderTabs()
      persistTabs()
      if (state.view !== 'about') renderFileRows()
      return
    }

    if (data.type === 'dirty') {
      tab.dirty = !!data.dirty
      renderTabs()
      return
    }

    if (data.type === 'close-state') {
      tab.dirty = !!data.dirty
      tab.autoSave = data.autoSave !== false
      renderTabs()
      return
    }

    if (data.type === 'title' && data.title) {
      tab.name = data.title
      renderTabs()
    }

    if (data.type === 'file-not-found') {
      // File blob not found in persistent storage (file was deleted/moved)
      // Show error and clean up recent entry
      toast('file tidak ditemukan')
      if (!data.fileBlobId && data.path) {
        state.recents = state.recents.filter((item) => item.path !== data.path)
        writeJson(RECENTS_KEY, state.recents)
        renderFileRows()
      }
      // Remove recent entry by fileBlobId
      if (data.fileBlobId) {
        const recents = state.recents.filter((item) => item.fileBlobId !== data.fileBlobId)
        state.recents = recents
        writeJson(RECENTS_KEY, state.recents)
        renderFileRows()
      }
      // Close the tab that failed to open
      if (tab) closeTab(tab.id)
      return
    }
  })

  // ── home view ────────────────────────────────────────────────────────────

  function quickCard(kind) {
    const def = NEW_DEFS[kind]
    if (!def) return ''
    const meta = APP_META[def.app]
    return `
      <button class="quick-card" type="button" data-new="${kind}">
        <img src="./shim/assets/${meta.icon}" alt="" />
        <span class="quick-text">
          <span class="quick-title">${meta.title}</span>
          <span class="quick-sub">${meta.sub}</span>
        </span>
      </button>`
  }

  function renderHero() {
    if (state.view !== 'recent') {
      const title = state.view === 'starred' ? 'Starred' : state.view === 'files' ? 'Files' : 'About'
      const sub =
        state.view === 'starred'
          ? 'Files you marked for quick access.'
          : state.view === 'files'
            ? 'Everything stored in Documents/ZenOffice.'
            : ''
      return `
        <div class="hero">
          <div class="hero-greeting">ZenOffice</div>
          <h1 class="hero-title">${title}</h1>
          ${sub ? `<p class="hero-sub">${sub}</p>` : ''}
        </div>`
    }
    return `
      <div class="hero">
        <div class="hero-greeting">${greeting()}</div>
        <h1 class="hero-title">What would you like to create today?</h1>
        <p class="hero-sub">Open a file or start something new. Everything stays on this device.</p>
      </div>`
  }

  function renderQuickCards() {
    if (state.view !== 'recent') return ''
    return `
      <div class="quick-cards" aria-label="Create new">
        ${quickCard('docx')}
        ${quickCard('xlsx')}
        ${quickCard('pptx')}
        ${quickCard('md')}
        ${quickCard('html')}
        ${quickCard('pdf')}
      </div>`
  }

  function viewTitle() {
    if (state.view === 'starred') return 'Starred'
    if (state.view === 'files') return 'Files'
    return 'Recent'
  }

  function renderHome() {
    applyTheme()
    const navItems = document.querySelectorAll('[data-view]')
    for (const item of navItems) {
      item.classList.toggle('active', item.dataset.view === state.view)
    }

    if (state.view === 'about') {
      el.homeView.innerHTML = renderAbout()
      return
    }

    el.homeView.innerHTML =
      renderHero() +
      renderQuickCards() +
      `<section class="recents-section">
        <div class="recents-toolbar">
          <div class="recents-heading">
            <span class="section-label">${viewTitle()}</span>
            <span class="file-count" id="file-count"></span>
          </div>
          <div class="recents-actions">
            <label class="search-box">
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.6" cy="8.6" r="5.2"/><path d="m12.6 12.6 3.8 3.8"/></svg>
              <input id="file-search" type="search" placeholder="Search files" autocomplete="off" value="${escapeHtml(state.query)}" />
            </label>
            <div class="filter-pills" role="group" aria-label="Filter files">
              ${FILTERS.map(
                (item) =>
                  `<button class="filter-pill ${state.filter === item.id ? 'active' : ''}" type="button" data-filter="${item.id}">${item.label}</button>`,
              ).join('')}
            </div>
          </div>
        </div>
        <div id="file-list"></div>
      </section>`

    const search = $('#file-search')
    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value
        renderFileRows()
      })
    }
    renderFileRows()
  }

  function renderFileRows() {
    const list = $('#file-list')
    if (!list) return
    const entries = collectionEntries()
    const count = $('#file-count')
    if (count) count.textContent = '· ' + entries.length + (entries.length === 1 ? ' file' : ' files')

    if (!entries.length) {
      const starred = state.view === 'starred'
      const searching = !!state.query || state.filter !== 'all'
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-art">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/>
            </svg>
          </div>
          <p class="empty-title">${searching ? 'No matching files' : starred ? 'Nothing starred yet' : 'No files yet'}</p>
          <p class="empty-copy">${
            searching
              ? 'Try a different filter or clear the search.'
              : starred
                ? 'Tap the star beside a file to keep it here.'
                : 'Create a document or open a file from this device to get started.'
          }</p>
          ${
            searching
              ? '<button class="secondary-btn" type="button" data-clear-filters>Clear filters</button>'
              : '<button class="primary-btn" type="button" data-open-local>Open a file</button>'
          }
        </div>`
      return
    }

    list.innerHTML = `
      <div class="file-table" role="table" aria-label="${viewTitle()} files">
        <div class="file-row header" role="row">
          <span></span><span></span><span>Name</span>
          <span class="file-modified">Modified</span>
          <span class="file-size">Size</span>
          <span></span>
        </div>
        ${entries.map(renderFileRow).join('')}
      </div>`
  }

  function renderFileRow(entry) {
    const open = openTabForPath(entry.path)
    const starred = isStarred(entry.path)
    const fileBlobIdAttr = entry.fileBlobId ? ` data-file-blob-id="${escapeHtml(entry.fileBlobId)}"` : ''
    return `
      <div class="file-row" role="row" data-path="${escapeHtml(entry.path)}" data-open-path="${escapeHtml(entry.path)}"${fileBlobIdAttr}>
        <button class="file-star ${starred ? 'is-starred' : ''}" type="button"
                data-star="${escapeHtml(entry.path)}" aria-label="${starred ? 'Unstar' : 'Star'} ${escapeHtml(entry.name)}">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 3 2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7L3.2 8l4.7-.7L10 3Z"/></svg>
        </button>
        <img class="file-icon" src="${iconForName(entry.name)}" alt="" />
        <span class="file-name-cell">
          <span class="file-name">${escapeHtml(entry.name)}</span>
          ${open ? '<span class="file-badge-open">Open</span>' : ''}
        </span>
        <span class="file-meta file-modified">${formatDate(entry.modified || entry.at)}</span>
        <span class="file-meta file-size">${formatBytes(entry.size)}</span>
        <span class="file-actions">
          <button class="file-more" type="button" data-more="${escapeHtml(entry.path)}" aria-label="Actions for ${escapeHtml(entry.name)}">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="16" cy="10" r="1.3"/></svg>
          </button>
        </span>
      </div>`
  }

  // ── ZenOffice: preferences, about page, file preview ─────────────────────

  const PREFS_KEY = LS + 'prefs.v1'
  const ANDROID_LS = 'genoffice.android.'
  const APP_VERSION = '0.1.0-beta' // keep in sync with versionName in android/app/build.gradle
  const APP_PACKAGE = 'com.minhaj.zenoffice' // applicationId
  const LANG_NAMES = {
    zh: '中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch',
    es: 'Español', th: 'ไทย', id: 'Bahasa Indonesia', ru: 'Русский', ar: 'العربية',
  }
  const FORMAT_LABELS = { docx: '.docx', xlsx: '.xlsx', pptx: '.pptx', md: '.md' }
  const KIND_LABELS = {
    docx: 'Word document', xlsx: 'Spreadsheet', xlsm: 'Spreadsheet', csv: 'CSV table',
    pptx: 'Presentation', odp: 'Presentation', pdf: 'PDF document', md: 'Markdown note',
    markdown: 'Markdown note', txt: 'Text file', html: 'HTML page', htm: 'HTML page',
  }
  const ICONS = {
    info: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM10 9v4.5M10 6.6v.1',
    folder: 'M3 6.2c0-.7.6-1.2 1.3-1.2h3l1.5 1.7h6.9c.7 0 1.3.6 1.3 1.3v6c0 .7-.6 1.3-1.3 1.3H4.3c-.7 0-1.3-.6-1.3-1.3V6.2Z',
    gear: 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.4 1.4M13.6 13.6 15 15M15 5l-1.4 1.4M6.4 13.6 5 15',
    wrench: 'M12.5 4a3.5 3.5 0 0 0-3.2 4.8L3.5 14.6a1.4 1.4 0 0 0 2 2l5.8-5.8A3.5 3.5 0 0 0 16 7.5l-2 2-2-.5-.5-2 2-2a3.5 3.5 0 0 0-1-.9Z',
    code: 'M7 6 3 10l4 4M13 6l4 4-4 4M11.2 4.5 8.8 15.5',
    moon: 'M16 11.5A6.5 6.5 0 0 1 8.5 4a6.5 6.5 0 1 0 7.5 7.5Z',
    globe: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM3 10h14M10 3c2 2 3 4.3 3 7s-1 5-3 7c-2-2-3-4.3-3-7s1-5 3-7Z',
    save: 'M4 4h9l3 3v9H4V4ZM7 4v4h5V4M7 16v-5h6v5',
    eye: 'M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10ZM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    file: 'M6 3h5l4 4v10H6V3ZM11 3v4h4',
    refresh: 'M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3h-3',
    trash: 'M5 6h10M8 6V4h4v2M6 6l.7 10h6.6L14 6',
    heart: 'M10 16s-6-3.6-6-8a3.4 3.4 0 0 1 6-2 3.4 3.4 0 0 1 6 2c0 4.4-6 8-6 8Z',
    shield: 'M10 3 4 5.5v4.5c0 3.5 2.6 5.6 6 7 3.4-1.4 6-3.5 6-7V5.5L10 3Z',
    chev: 'm8 5 5 5-5 5',
  }
  function ico(name) {
    return '<svg class="about-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="' + ICONS[name] + '"/></svg>'
  }

  function getPrefs() {
    const p = readJson(PREFS_KEY, {}) || {}
    return { preview: p.preview !== false, format: FORMAT_LABELS[p.format] ? p.format : 'docx' }
  }
  function setPref(key, value) {
    const p = getPrefs()
    p[key] = value
    writeJson(PREFS_KEY, p)
  }
  function readAndroid(key, fallback) {
    try {
      const raw = localStorage.getItem(ANDROID_LS + key)
      return raw == null ? fallback : JSON.parse(raw)
    } catch (e) {
      return fallback
    }
  }
  function fsPlugin() {
    const cap = window.Capacitor
    return cap && cap.Plugins && cap.Plugins.Filesystem ? cap.Plugins.Filesystem : null
  }

  async function probeStorage() {
    const fs = fsPlugin()
    let ok = false
    if (fs) {
      try {
        await fs.stat({ path: 'ZenOffice', directory: 'DOCUMENTS' })
        ok = true
      } catch (e) {
        ok = false
      }
    }
    const changed = state.storageOk !== ok
    state.storageOk = ok
    if (changed && state.view === 'about') renderHome()
  }

  // dialogs
  function closeDialog() {
    document.querySelectorAll('.zen-modal-backdrop:not(.zen-out)').forEach(function (n) { ghostOut(n, 'zen-out') })
  }
  function openDialog(html) {
    closeDialog()
    const wrap = document.createElement('div')
    wrap.className = 'zen-modal-backdrop'
    wrap.innerHTML = '<div class="zen-modal" role="dialog" aria-modal="true">' + html + '</div>'
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) closeDialog()
    })
    document.body.appendChild(wrap)
    return wrap
  }

  // Show confirmation dialog when closing a tab with unsaved changes
  // Returns a Promise that resolves to: 'cancel' | 'discard' | 'save'
  function showCloseConfirmDialog(tab) {
    return new Promise(function (resolve) {
      const tabName = (tab && (tab.title || tab.name || tab.fileName)) || ''
      const html =
        '<div class="zc-head"><span class="zc-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 3 19h18L12 4z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg></span><h3>Leave editor?</h3></div>' +
        '<div class="zen-modal-body"><p>Your current changes have not been saved.</p></div>' +
        '<div class="zc-row"><span class="zc-row-name"></span><span class="zc-row-note">Unsaved</span></div>' +
        '<div class="zen-modal-actions">' +
        '<button type="button" class="zc-btn zc-cancel" data-action="cancel">Cancel</button>' +
        '<button type="button" class="zc-btn zc-discard" data-action="discard">Discard</button>' +
        '<button type="button" class="zc-btn zc-save" data-action="save">Save</button>' +
        '</div>'
      const wrap = openDialog(html)
      const card = wrap.querySelector('.zen-modal')
      if (card) card.classList.add('zen-modal-confirm')
      const rowEl = wrap.querySelector('.zc-row')
      if (rowEl) {
        if (tabName) wrap.querySelector('.zc-row-name').textContent = tabName
        else rowEl.remove()
      }
      wrap.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-action]')
        if (!btn) return
        const action = btn.dataset.action
        closeDialog()
        resolve(action)
      })
      // Escape key and backdrop click = Cancel
      const escHandler = function (e) {
        if (e.key === 'Escape') {
          closeDialog()
          document.removeEventListener('keydown', escHandler)
          resolve('cancel')
        }
      }
      document.addEventListener('keydown', escHandler)
      // Clean up esc handler when dialog closes
      const observer = new MutationObserver(function () {
        if (!document.body.contains(wrap)) {
          document.removeEventListener('keydown', escHandler)
          observer.disconnect()
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
  }

  // Send save message to iframe and wait for saved response
  function requestSave(tab) {
    return new Promise(function (resolve, reject) {
      const frame = el.frames.querySelector('.doc-frame[data-tab="' + cssEscape(tab.id) + '"]')
      if (!frame || !frame.contentWindow) {
        reject(new Error('Frame not found'))
        return
      }
      const timeout = setTimeout(function () {
        cleanup()
        reject(new Error('Save timeout'))
      }, 10000)
      function cleanup() {
        clearTimeout(timeout)
        window.removeEventListener('message', handler)
      }
      function handler(event) {
        if (event.origin !== window.location.origin) return
        const data = event.data
        if (!data || data.__genofficeShell !== true) return
        if (data.type === 'saved' && data.tab === tab.id) {
          cleanup()
          resolve()
        } else if (data.type === 'save-error' && data.tab === tab.id) {
          cleanup()
          reject(new Error(data.error || 'Save failed'))
        }
      }
      window.addEventListener('message', handler)
      frame.contentWindow.postMessage({ __genofficeShell: true, type: 'save' }, window.location.origin)
    })
  }

  function openChoice(title, options, current, onPick) {
    const items = options.map(function (o) {
      const on = o.value === current
      return '<button type="button" class="zen-choice' + (on ? ' on' : '') + '" data-val="' + escapeHtml(o.value) + '"><span>' + escapeHtml(o.label) + '</span>' + (on ? '<b>✓</b>' : '') + '</button>'
    }).join('')
    const wrap = openDialog('<h3>' + escapeHtml(title) + '</h3><div class="zen-choice-list">' + items + '</div>')
    wrap.addEventListener('click', function (e) {
      const b = e.target.closest('[data-val]')
      if (!b) return
      closeDialog()
      onPick(b.dataset.val)
    })
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDialog()
  })

  function handlePref(kind) {
    if (kind === 'theme') {
      const cur = state.theme === 'dark' || state.theme === 'light' ? state.theme : 'system'
      openChoice('App theme', [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'System default' },
      ], cur, function (v) {
        state.theme = v
        writeJson(THEME_KEY, v)
        applyTheme()
        renderHome()
      })
    } else if (kind === 'lang') {
      const cur = readAndroid('lang', null) || ''
      const opts = [{ value: '', label: 'System default' }].concat(
        Object.keys(LANG_NAMES).map(function (k) { return { value: k, label: LANG_NAMES[k] } }),
      )
      openChoice('Language', opts, cur, function (v) {
        try {
          if (v) localStorage.setItem(ANDROID_LS + 'lang', JSON.stringify(v))
          else localStorage.removeItem(ANDROID_LS + 'lang')
        } catch (e) {}
        toast('Applying language…')
        setTimeout(function () { window.location.reload() }, 400)
      })
    } else if (kind === 'preview') {
      setPref('preview', !getPrefs().preview)
      renderHome()
    } else if (kind === 'format') {
      openChoice('Default format', Object.keys(FORMAT_LABELS).map(function (k) {
        return { value: k, label: FORMAT_LABELS[k] }
      }), getPrefs().format, function (v) {
        setPref('format', v)
        renderHome()
      })
    }
  }

  function showAboutDialog(kind) {
    if (kind === 'licenses') {
      openDialog(
        '<h3>Third-party licenses</h3><div class="zen-modal-body">' +
        '<p><b>ZenOffice</b> is based on <b>GenOffice</b>, Copyright 2026 Mainfunc, Inc., licensed under the Apache License 2.0. The full license text is the LICENSE file of the source repository, and its NOTICE file is kept unchanged.</p>' +
        '<p>Android wrapper dependencies:</p><ul>' +
        '<li>Capacitor core, Android and Filesystem: MIT</li>' +
        '<li>SheetJS (xlsx 0.18.5): Apache-2.0</li>' +
        '<li>ExcelJS: MIT</li></ul>' +
        '<p>The shared renderers bundle more components and fonts. Their licenses are documented in the repository (apps/docs/src/renderer/fonts/README.md, and THIRD-PARTY-NOTICES.txt generated by tools/gen-third-party-notices.mjs).</p></div>' +
        '<div class="zen-modal-actions"><button class="secondary-btn" type="button" data-zen-close>Close</button></div>',
      )
    } else if (kind === 'thanks') {
      openDialog(
        '<h3>Special thanks</h3><div class="zen-modal-body"><ul>' +
        '<li>Mainfunc, Inc. and the GenOffice contributors, whose open source work this app is built on.</li>' +
        '<li>The Capacitor project, which makes the Android wrapper possible.</li>' +
        '<li>SheetJS, ExcelJS and every open source library and font bundled with the renderers.</li></ul></div>' +
        '<div class="zen-modal-actions"><button class="secondary-btn" type="button" data-zen-close>Close</button></div>',
      )
    }
  }

  document.addEventListener('click', function (event) {
    const pref = event.target.closest('[data-pref]')
    if (pref) {
      handlePref(pref.dataset.pref)
      return
    }
    const info = event.target.closest('[data-about]')
    if (info) {
      showAboutDialog(info.dataset.about)
      return
    }
    const op = event.target.closest('[data-zen-open]')
    if (op) {
      const p = op.dataset.zenOpen
      closeDialog()
      void openPath(p)
      return
    }
    if (event.target.closest('[data-zen-close]')) closeDialog()
  })

  // file preview (zip containers read with DecompressionStream, no extra libs)
  const PV_MAX = 30 * 1024 * 1024
  function b64ToBytes(b64) {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  function unxml(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  }
  function zipIndex(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const min = Math.max(0, bytes.length - 65557)
    let p = bytes.length - 22
    while (p >= min && dv.getUint32(p, true) !== 0x06054b50) p--
    if (p < min) return null
    const count = dv.getUint16(p + 10, true)
    let off = dv.getUint32(p + 16, true)
    const ents = {}
    const dec = new TextDecoder()
    for (let i = 0; i < count; i++) {
      if (off + 46 > bytes.length || dv.getUint32(off, true) !== 0x02014b50) break
      const method = dv.getUint16(off + 10, true)
      const csize = dv.getUint32(off + 20, true)
      const n = dv.getUint16(off + 28, true)
      const x = dv.getUint16(off + 30, true)
      const c = dv.getUint16(off + 32, true)
      const lo = dv.getUint32(off + 42, true)
      ents[dec.decode(bytes.subarray(off + 46, off + 46 + n))] = { method: method, csize: csize, off: lo }
      off += 46 + n + x + c
    }
    return ents
  }
  async function zipFile(bytes, ents, name) {
    const e = ents[name]
    if (!e || e.csize === 0xffffffff) return null
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true)
    const raw = bytes.subarray(start, start + e.csize)
    if (e.method === 0) return raw.slice()
    if (e.method !== 8) return null
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  async function zipText(bytes, ents, name) {
    const u8 = await zipFile(bytes, ents, name)
    return u8 ? new TextDecoder().decode(u8) : null
  }
  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || '')
    if (!m) return 0
    let n = 0
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
    return n - 1
  }
  function pvNote(text) {
    return '<p class="zen-pv-note">' + escapeHtml(text) + '</p>'
  }
  async function buildPreview(entry, ext) {
    if (ext === 'pdf' || !KIND_LABELS[ext]) return pvNote('No inline preview for this format. Tap Open to view it.')
    const fs = fsPlugin()
    if (!fs) return pvNote('Preview needs access to local storage.')
    if (entry.size > PV_MAX) return pvNote('This file is too large for a quick preview.')
    let r
    try {
      r = await fs.readFile({ path: entry.path, directory: 'DOCUMENTS' })
    } catch (e) {
      return pvNote('The file could not be read from Documents/ZenOffice.')
    }
    const bytes = b64ToBytes(r.data)
    if (ext === 'md' || ext === 'markdown' || ext === 'txt' || ext === 'html' || ext === 'htm' || ext === 'csv') {
      const text = new TextDecoder().decode(bytes.subarray(0, 4000)).slice(0, 1500)
      return '<pre class="zen-pv-text">' + escapeHtml(text) + '</pre>'
    }
    const ents = zipIndex(bytes)
    if (!ents) return pvNote('This file could not be read for a preview.')
    if (ext === 'docx') {
      const xml = await zipText(bytes, ents, 'word/document.xml')
      if (!xml) return pvNote('No readable text found.')
      const out = []
      let total = 0
      for (const p of xml.split('</w:p>')) {
        const t = Array.from(p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)).map(function (m) { return unxml(m[1]) }).join('')
        if (t.trim()) {
          out.push(t.trim())
          total += t.length
          if (out.length >= 14 || total > 1500) break
        }
      }
      return out.length ? out.map(function (t) { return '<p>' + escapeHtml(t) + '</p>' }).join('') : pvNote('This document has no text.')
    }
    if (ext === 'xlsx' || ext === 'xlsm') {
      const wb = (await zipText(bytes, ents, 'xl/workbook.xml')) || ''
      const names = Array.from(wb.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)).map(function (m) { return unxml(m[1]) })
      const ssXml = (await zipText(bytes, ents, 'xl/sharedStrings.xml')) || ''
      const strings = ssXml.split('<si').slice(1).map(function (si) {
        return Array.from(si.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)).map(function (m) { return unxml(m[1]) }).join('')
      })
      const sheet = (await zipText(bytes, ents, 'xl/worksheets/sheet1.xml')) || ''
      const rows = []
      for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = []
        for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = /\br="([A-Z]+\d+)"/.exec(cm[1])
          const t = /\bt="(\w+)"/.exec(cm[1])
          const body = cm[2] || ''
          let val = ''
          const v = /<v>([^<]*)<\/v>/.exec(body)
          if (t && t[1] === 's' && v) val = strings[Number(v[1])] || ''
          else if (t && t[1] === 'inlineStr') {
            const it = /<t(?:\s[^>]*)?>([^<]*)<\/t>/.exec(body)
            val = it ? unxml(it[1]) : ''
          } else if (v) val = unxml(v[1])
          const ci = ref ? colIndex(ref[1]) : cells.length
          if (ci < 6) cells[ci] = val
        }
        rows.push(cells)
        if (rows.length >= 8) break
      }
      const head = names.length ? '<p class="zen-pv-note">Sheets: ' + escapeHtml(names.join(', ')) + '</p>' : ''
      if (!rows.length) return head + pvNote('The first sheet is empty.')
      const table = rows.map(function (cells) {
        let tds = ''
        for (let i = 0; i < Math.min(6, Math.max(cells.length, 1)); i++) tds += '<td>' + escapeHtml(cells[i] || '') + '</td>'
        return '<tr>' + tds + '</tr>'
      }).join('')
      return head + '<div class="zen-pv-scroll"><table class="zen-pv-table">' + table + '</table></div>'
    }
    if (ext === 'pptx') {
      const count = Object.keys(ents).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n) }).length
      const thumb = await zipFile(bytes, ents, 'docProps/thumbnail.jpeg')
      let html = '<p class="zen-pv-note">' + count + (count === 1 ? ' slide' : ' slides') + '</p>'
      if (thumb) {
        html = '<img class="zen-pv-thumb" alt="" src="' + URL.createObjectURL(new Blob([thumb], { type: 'image/jpeg' })) + '" />' + html
      }
      const s1 = await zipText(bytes, ents, 'ppt/slides/slide1.xml')
      if (s1) {
        const texts = Array.from(s1.matchAll(/<a:t>([^<]*)<\/a:t>/g)).map(function (m) { return unxml(m[1]) }).filter(Boolean).slice(0, 6)
        if (texts.length) html += '<div class="zen-pv-slide">' + texts.map(function (t) { return '<p>' + escapeHtml(t) + '</p>' }).join('') + '</div>'
      }
      return html
    }
    return pvNote('No inline preview for this format. Tap Open to view it.')
  }
  async function showPreview(path) {
    const entry = collectionEntries().find(function (e) { return e.path === path }) ||
      { path: path, name: basename(path), size: 0, modified: 0, at: 0 }
    const ext = (entry.name.split('.').pop() || '').toLowerCase()
    const meta = [KIND_LABELS[ext] || ext.toUpperCase(), formatBytes(entry.size), formatDate(entry.modified || entry.at)].filter(function (x) { return x && x !== '—' }).join(' · ')
    const wrap = openDialog(
      '<div class="zen-pv-head"><img class="file-icon" src="' + iconForName(entry.name) + '" alt="" /><div><h3>' + escapeHtml(entry.name) + '</h3><small>' + escapeHtml(meta) + '</small></div></div>' +
      '<div class="zen-modal-body zen-pv-body">Loading preview…</div>' +
      '<div class="zen-modal-actions"><button class="secondary-btn" type="button" data-zen-close>Close</button>' +
      '<button class="primary-btn" type="button" data-zen-open="' + escapeHtml(path) + '">Open</button></div>',
    )
    let html
    try {
      html = await buildPreview(entry, ext)
    } catch (e) {
      html = pvNote('Preview unavailable: ' + String((e && e.message) || e))
    }
    const slot = wrap.querySelector('.zen-pv-body')
    if (slot && document.body.contains(wrap)) slot.innerHTML = html
  }

  // about page
  function kv(k, v) {
    return '<div class="about-kv"><span>' + k + '</span><span>' + v + '</span></div>'
  }
  function infoRow(icon, title, sub, attrs, chevron) {
    const tag = attrs ? 'button type="button" ' + attrs : 'div'
    const close = attrs ? 'button' : 'div'
    return '<' + tag + ' class="about-row">' + ico(icon) +
      '<span class="about-row-label"><b>' + title + '</b><small>' + sub + '</small></span>' +
      (chevron ? ico('chev') : '') + '</' + close + '>'
  }
  function prefRow(kind, icon, label, value) {
    return '<button type="button" class="about-row" data-pref="' + kind + '">' + ico(icon) +
      '<span class="about-row-label"><b>' + label + '</b></span>' +
      '<span class="about-row-value">' + escapeHtml(value) + '</span>' + ico('chev') + '</button>'
  }
  function maintCard(icon, title, desc, command, button) {
    return '<div class="about-maint"><span class="about-maint-ico">' + ico(icon) + '</span><div><b>' + title + '</b><small>' + desc + '</small>' +
      '<button class="secondary-btn" type="button" data-command="' + command + '">' + button + '</button></div></div>'
  }

  function renderAbout() {
    if (state.storageOk === undefined) void probeStorage()
    const total = state.files.reduce(function (sum, f) { return sum + (Number(f.size) || 0) }, 0)
    const prefs = getPrefs()
    const am = /Android ([\d.]+)/.exec(navigator.userAgent)
    const cm = /Chrome\/([\d.]+)/.exec(navigator.userAgent)
    const ok = state.storageOk
    const status = ok === true
      ? '<span class="about-dot ok"></span><span class="about-ok">Running normally</span>'
      : ok === false
        ? '<span class="about-dot bad"></span><span class="about-bad">Storage not accessible</span>'
        : '<span class="about-dot"></span><span>Checking…</span>'
    const banner = ok === false
      ? '<div class="about-banner bad"><b>Local storage is not available</b><small>Documents/ZenOffice could not be read. Check the storage permission of the app.</small></div>'
      : '<div class="about-banner' + (ok ? '' : ' wait') + '"><b>' + (ok ? 'Local storage is accessible' : 'Checking local storage…') + '</b><small>Your documents are stored locally on this device.</small></div>'
    const theme = state.theme === 'dark' ? 'Dark' : state.theme === 'light' ? 'Light' : 'System default'
    const lang = readAndroid('lang', null)
    const nFiles = state.files.length
    return '<div class="about-page">' +
      '<div class="about-hero"><img src="./shim/assets/zenoffice-logo.png" alt="" /><div>' +
      '<h1>ZenOffice</h1><div class="about-tag">Your Office, Reimagined</div>' +
      '<p>A powerful and modern office suite for Android. Create, edit, and manage your documents, spreadsheets, and presentations, anytime, anywhere.</p></div></div>' +
      '<div class="about-grid">' +
      '<section class="about-card"><h2>' + ico('info') + 'App Information</h2>' +
      kv('App Name', 'ZenOffice') + kv('Version', APP_VERSION) + kv('Platform', escapeHtml(am ? 'Android ' + am[1] : 'Android')) +
      kv('WebView', escapeHtml(cm ? 'Chrome ' + cm[1] : 'unknown')) + kv('Package Name', APP_PACKAGE) +
      kv('Status', '<span class="about-status">' + status + '</span>') + '</section>' +
      '<section class="about-card"><h2>' + ico('folder') + 'Local Workspace</h2>' +
      infoRow('folder', 'Storage Location', 'Documents/ZenOffice') +
      infoRow('file', 'Document Files', nFiles + (nFiles === 1 ? ' file' : ' files'), 'data-view="files"', true) +
      infoRow('save', 'Total Size', formatBytes(total)) +
      infoRow('refresh', 'Recent List', state.recents.length + (state.recents.length === 1 ? ' item' : ' items')) +
      banner + '</section>' +
      '<section class="about-card"><h2>' + ico('gear') + 'Preferences</h2>' +
      prefRow('theme', 'moon', 'App Theme', theme) +
      prefRow('lang', 'globe', 'Language', lang ? (LANG_NAMES[lang] || lang) : 'System default') +
      prefRow('preview', 'eye', 'File Preview', prefs.preview ? 'On' : 'Off') +
      prefRow('format', 'file', 'Default Format', FORMAT_LABELS[prefs.format]) + '</section>' +
      '</div>' +
      '<section class="about-card about-wide"><h2>' + ico('wrench') + 'Maintenance</h2><p class="about-sub">Manage your app data and performance.</p>' +
      '<div class="about-maint-grid">' +
      maintCard('refresh', 'Refresh File Index', 'Re-scan local files and update the index.', 'refresh', 'Refresh') +
      maintCard('trash', 'Clear Recent Files', 'Remove your recent file history.', 'clear-recents', 'Clear') +
      maintCard('refresh', 'Reload Application', 'Restart the app to apply changes.', 'reload', 'Reload') +
      '</div></section>' +
      '<div class="about-grid about-grid-2">' +
      '<section class="about-card"><h2>' + ico('code') + 'Open Source &amp; Credits</h2><p class="about-sub">ZenOffice uses and builds upon several open source projects.</p>' +
      infoRow('shield', 'Third-party Licenses', 'View licenses for included components', 'data-about="licenses"', true) +
      infoRow('heart', 'Special Thanks', 'To all contributors and open source projects', 'data-about="thanks"', true) + '</section>' +
      '<section class="about-card"><h2>' + ico('info') + 'About ZenOffice</h2>' +
      '<p class="about-text">ZenOffice is an Android port of GenOffice, brought to mobile for a more flexible and productive experience. This is an independent project and is not affiliated with, endorsed by, or officially connected to GenOffice or its original developers.</p>' +
      '<p class="about-text about-small">Based on GenOffice, Copyright 2026 Mainfunc, Inc., licensed under the Apache License 2.0. Changes: Android port, rename and interface adaptations.</p>' +
      '<div class="about-foot"><img src="./shim/assets/zenoffice-logo.png" alt="" /><b>ZenOffice</b><span>Your Office, Reimagined</span></div></section>' +
      '</div></div>'
  }

  // ── opening files ────────────────────────────────────────────────────────

  function supportedAccept() {
    return '.docx,.xlsx,.xlsm,.csv,.pptx,.odp,.pdf,.md,.markdown,.txt,.html,.htm'
  }

  function pickFileFallback(accept) {
    return new Promise(function (resolve) {
      try {
        var input = document.createElement('input')
        input.type = 'file'
        if (accept) input.accept = accept
        input.style.display = 'none'
        var done = false
        function finish(file) {
          if (done) return
          done = true
          if (input.parentNode) input.parentNode.removeChild(input)
          resolve(file || null)
        }
        input.addEventListener('change', function () {
          finish(input.files && input.files[0])
        })
        input.addEventListener('cancel', function () {
          finish(null)
        })
        document.body.appendChild(input)
        input.click()
      } catch (e) {
        resolve(null)
      }
    })
  }

  async function openLocalFile() {
    const bridge = window.__genofficeAndroid
    let file = null
    try {
      if (bridge && typeof bridge.pickFile === 'function') {
        file = await bridge.pickFile(supportedAccept())
      } else if (typeof window.pickFile === 'function') {
        file = await window.pickFile(supportedAccept())
      } else {
        file = await pickFileFallback(supportedAccept())
      }
    } catch (e) {
      console.error(e)
      try {
        file = await pickFileFallback(supportedAccept())
      } catch (e2) {
        toast('Could not open the picker')
        return
      }
    }
    if (!file) {
      console.log('[openLocalFile] No file selected')
      return
    }
    console.log('[openLocalFile] File picked:', file.name, file.size, file.type)
    const app = appForName(file.name)
    if (!app) {
      toast('This file type is not supported yet')
      return
    }
    // Store file blob persistently for recent files
    let fileBlobId = null
    if (bridge && typeof bridge.putFileBlob === 'function') {
      try {
        fileBlobId = await bridge.putFileBlob(file)
        console.log('[openLocalFile] putFileBlob succeeded:', fileBlobId)
      } catch (e) {
        console.warn('[openLocalFile] Failed to store file blob:', e)
      }
    } else {
      console.warn('[openLocalFile] putFileBlob not available on bridge')
    }
    await createTab({ app: app, name: file.name, file: file, fileBlobId: fileBlobId })
  }

  // open-with-intent: files other apps hand to ZenOffice (Open with / ACTION_VIEW)
  async function openFileObject(file) {
    const app = appForName(file.name)
    if (!app) {
      toast('This file type is not supported yet')
      return
    }
    const bridge = window.__genofficeAndroid
    let fileBlobId = null
    if (bridge && typeof bridge.putFileBlob === 'function') {
      try {
        fileBlobId = await bridge.putFileBlob(file)
      } catch (e) {
        console.warn('[openFileObject] Failed to store file blob:', e)
      }
    }
    await createTab({ app: app, name: file.name, file: file, fileBlobId: fileBlobId })
  }

  async function consumeOpenIntents() {
    const cap = window.Capacitor
    const plugin = cap && cap.Plugins && cap.Plugins.OpenIntent
    const fs = cap && cap.Plugins && cap.Plugins.Filesystem
    if (!plugin || !fs) return
    let res = null
    try {
      res = await plugin.takePending()
    } catch (e) {
      return
    }
    const files = (res && res.files) || []
    for (const item of files) {
      try {
        const r = await fs.readFile({ path: item.path, directory: 'CACHE' })
        const bin = atob(r.data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        await openFileObject(new File([bytes], item.name, { type: item.type || '' }))
      } catch (e) {
        console.warn('[consumeOpenIntents] failed:', e)
        toast('Could not open ' + item.name)
      } finally {
        try {
          await fs.deleteFile({ path: item.path, directory: 'CACHE' })
        } catch (e2) {}
      }
    }
  }

  ;(function watchOpenIntents() {
    const cap = window.Capacitor
    const plugin = cap && cap.Plugins && cap.Plugins.OpenIntent
    if (plugin && typeof plugin.addListener === 'function') {
      try {
        plugin.addListener('pending', function () {
          consumeOpenIntents()
        })
      } catch (e) {}
    }
    setTimeout(consumeOpenIntents, 1200)
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) consumeOpenIntents()
    })
  })()

  async function openPath(path, fileBlobId) {
    console.log('[openPath] Called with:', { path, fileBlobId })
    if (!path) return
    // recent-blob-lookup: any caller may omit the id, so resolve it from recents
    if (!fileBlobId) {
      const known = state.recents.find((item) => item.path === path)
      fileBlobId = (known && known.fileBlobId) || null
    }
    const existing = openTabForPath(path)
    if (existing) {
      console.log('[openPath] Tab already exists, activating:', existing.id)
      activateTab(existing.id)
      return
    }
    const app = appForName(path)
    if (!app) {
      toast('This file type is not supported yet')
      return
    }
    const tab = await createTab({ app: app, path: path, name: basename(path), fileBlobId: fileBlobId })
    if (tab) recordRecent({ path: path, name: basename(path), app: app, fileBlobId: fileBlobId })
    persistTabs()
  }

  async function newFile(kind) {
    if (!NEW_DEFS[kind]) return
    const tab = await createTab({ kind: kind })
    if (tab && kind === 'pptx') {
      // A deck gets its real path when the app saves. The blank tab is kept
      // in memory until then; auto-save creates the file shortly after edits.
    }
  }

  async function refreshFiles() {
    const cap = window.Capacitor
    const fs = cap && cap.Plugins && cap.Plugins.Filesystem
    if (!fs) {
      state.filesLoaded = true
      if (state.view === 'files') {
        state.query = ''
        renderHome()
      }
      return
    }
    try {
      let result
      try {
        result = await fs.readdir({ path: 'ZenOffice', directory: 'DOCUMENTS' })
      } catch (e) {
        await fs.mkdir({ path: 'ZenOffice', directory: 'DOCUMENTS', recursive: true })
        result = { files: [] }
      }
      state.files = (result.files || [])
        .filter((file) => file && file.type !== 'directory')
        .map(fileEntryFromDisk)
        .filter(Boolean)
      state.filesLoaded = true
      if (state.view !== 'about') renderFileRows()
      else renderHome()
    } catch (e) {
      console.warn('Could not list files', e)
      state.filesLoaded = true
    }
  }

  // ── blank PDF ────────────────────────────────────────────────────────────

  function makeBlankPdf() {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>',
      '<< /Length 0 >>\nstream\n\nendstream',
    ]
    let out = '%PDF-1.4\n'
    const offsets = []
    for (let i = 0; i < objects.length; i++) {
      offsets.push(out.length)
      out += i + 1 + ' 0 obj\n' + objects[i] + '\nendobj\n'
    }
    const xref = out.length
    out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n'
    for (const offset of offsets) out += String(offset).padStart(10, '0') + ' 00000 n \n'
    out +=
      'trailer\n<< /Size ' +
      (objects.length + 1) +
      ' /Root 1 0 R >>\nstartxref\n' +
      xref +
      '\n%%EOF\n'
    return new TextEncoder().encode(out)
  }

  // ── popovers ─────────────────────────────────────────────────────────────

  function popoverButton(label, command, danger) {
    return `<button type="button" data-pop="${command}" ${danger ? 'style="color:var(--danger)"' : ''}>${escapeHtml(label)}</button>`
  }

  function openPopover(items, anchor) {
    clearTimeout(popoverCloseTimer)
    el.popover.classList.remove('zen-out-pop')
    state.popoverHandlers = []
    el.popover.innerHTML = items
      .map((item) => {
        if (item.sep) return '<div class="popover-sep"></div>'
        const index = state.popoverHandlers.push(item.run) - 1
        return `<button type="button" data-pop-index="${index}" ${item.danger ? 'style="color:var(--danger)"' : ''}>${escapeHtml(item.label)}</button>`
      })
      .join('')
    el.popover.hidden = false

    // Anchor the menu near the trigger and keep it inside the viewport.
    const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null
    const width = 218
    if (rect) {
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
      const below = rect.bottom + 5
      const estimated = Math.min(360, items.length * 34 + 14)
      const top = below + estimated > window.innerHeight ? Math.max(8, rect.top - estimated - 5) : below
      el.popover.style.left = left + 'px'
      el.popover.style.right = 'auto'
      el.popover.style.top = top + 'px'
    } else {
      el.popover.style.left = 'auto'
      el.popover.style.right = '8px'
      el.popover.style.top = 'calc(43px + var(--safe-top))'
    }
  }

  var popoverCloseTimer = 0
  function closePopover() {
    state.popoverHandlers = []
    if (el.popover.hidden) return
    if (zenReduceMotion) {
      el.popover.hidden = true
      return
    }
    el.popover.classList.add('zen-out-pop')
    clearTimeout(popoverCloseTimer)
    popoverCloseTimer = setTimeout(function () {
      el.popover.hidden = true
      el.popover.classList.remove('zen-out-pop')
    }, 160)
  }

  function showMainMenu(anchor, includeCloseOthers) {
    const items = [
      { label: 'Open file…', run: openLocalFile },
      { label: 'New document', run: () => newFile('docx') },
      { label: 'New spreadsheet', run: () => newFile('xlsx') },
      { label: 'New presentation', run: () => newFile('pptx') },
      { sep: true },
      { label: 'New Markdown note', run: () => newFile('md') },
      { label: 'New HTML page', run: () => newFile('html') },
      { label: 'New PDF', run: () => newFile('pdf') },
      { sep: true },
      { label: 'Toggle dark mode', run: toggleTheme },
      { label: 'Refresh files', run: refreshFiles },
      { label: 'About', run: () => showView('about') },
    ]
    if (includeCloseOthers && state.tabs.length > 1) {
      items.push({ sep: true })
      items.push({ label: 'Close other tabs', run: closeOtherTabs })
    }
    openPopover(items, anchor)
  }

  function showFileMenu(path, anchor) {
    const entry =
      state.recents.find((item) => item.path === path) ||
      state.files.find((item) => item.path === path)
    if (!entry) return
    const open = openTabForPath(path)
    const items = [
      { label: 'Open', run: () => openPath(path, entry.fileBlobId || null) },
      {
        label: isStarred(path) ? 'Remove star' : 'Add star',
        run: () => toggleStar(path),
      },
    ]
    if (open) {
      items.push({ label: 'Close tab', run: () => closeTab(open.id) })
    }
    items.push({ sep: true })
    items.push({
      label: 'Remove from recent',
      danger: true,
      run: () => {
        state.recents = state.recents.filter((item) => item.path !== path)
        writeJson(RECENTS_KEY, state.recents)
        renderFileRows()
      },
    })
    openPopover(items, anchor)
  }

  let viewAnimTimer = 0
  function playViewEnter() {
    const v = el.homeView
    if (!v) return
    clearTimeout(viewAnimTimer)
    v.classList.remove('view-enter')
    void v.offsetWidth // restart the animation
    v.classList.add('view-enter')
    viewAnimTimer = setTimeout(function () { v.classList.remove('view-enter') }, 700)
  }

  function showView(view) {
    const changed = state.view !== view
    state.view = view
    closePopover()
    if (state.active !== 'home') {
      // called from a document tab: switch to the ZenOffice home tab, which renders the view
      activateTab('home')
      if (view === 'files') refreshFiles()
      return
    }
    if (view === 'about') {
      renderHome()
      if (changed) playViewEnter()
      return
    }
    renderHome()
    if (changed) playViewEnter()
    if (view === 'files') refreshFiles()
    el.homeScroll.scrollTop = 0
  }

  // ── toast ────────────────────────────────────────────────────────────────

  let toastTimer = 0
  function toast(message) {
    if (!message) return
    clearTimeout(toastTimer)
    el.toast.textContent = message
    el.toast.classList.add('show')
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600)
  }

  // ── event wiring ─────────────────────────────────────────────────────────

  el.tabstrip.addEventListener('click', async function (event) {
    const close = event.target.closest('[data-close]')
    if (close) {
      event.stopPropagation()
      await closeTab(close.dataset.close)
      return
    }
    const tab = event.target.closest('[data-tab]')
    if (tab) activateTab(tab.dataset.tab)
  })

  el.tabstrip.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const tab = event.target.closest('[data-tab]')
    if (tab) {
      event.preventDefault()
      activateTab(tab.dataset.tab)
    }
  })

  el.tabstrip.addEventListener('click', function (event) {
    const b = event.target.closest('[data-new-tab]')
    if (!b) return
    event.stopPropagation()
    closePopover()
    showNewMenu(b)
  })

  el.tabMenu.addEventListener('click', function (event) {
    event.stopPropagation()
    closeNewMenu()
    showMainMenu(el.tabMenu, true)
  })

  el.openLocal.addEventListener('click', openLocalFile)
  el.brandHome.addEventListener('click', () => activateTab('home'))
  el.aboutButton.addEventListener('click', () => showView('about'))

  // Tab switching shortcuts
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        if (state.active === 'home') {
          if (state.tabs.length > 0) activateTab(state.tabs[state.tabs.length - 1].id)
        } else {
          var idx = state.tabs.findIndex(function(t){ return t.id === state.active })
          if (idx > 0) activateTab(state.tabs[idx - 1].id)
          else if (state.tabs.length > 0) activateTab(state.tabs[state.tabs.length - 1].id)
        }
      } else {
        if (state.active === 'home') {
          if (state.tabs.length > 0) activateTab(state.tabs[0].id)
        } else {
          var idx = state.tabs.findIndex(function(t){ return t.id === state.active })
          if (idx >= 0 && idx < state.tabs.length - 1) activateTab(state.tabs[idx + 1].id)
          else if (state.tabs.length > 0) activateTab(state.tabs[0].id)
        }
      }
    }
  })

  document.addEventListener('click', function (event) {
    const nav = event.target.closest('[data-view]')
    if (nav) {
      showView(nav.dataset.view)
      return
    }

    const newButton = event.target.closest('[data-new]')
    if (newButton) {
      void newFile(newButton.dataset.new)
      return
    }

    const filter = event.target.closest('[data-filter]')
    if (filter) {
      state.filter = filter.dataset.filter
      renderHome()
      return
    }

    const star = event.target.closest('[data-star]')
    if (star) {
      event.stopPropagation()
      toggleStar(star.dataset.star)
      return
    }

    const more = event.target.closest('[data-more]')
    if (more) {
      event.stopPropagation()
      showFileMenu(more.dataset.more, more)
      return
    }

    if (event.target.closest('[data-open-local]')) {
      void openLocalFile()
      return
    }

    if (event.target.closest('[data-clear-filters]')) {
      state.query = ''
      state.filter = 'all'
      renderHome()
      return
    }

    const command = event.target.closest('[data-command]')
    if (command) {
      runCommand(command.dataset.command)
      return
    }

    const row = event.target.closest('[data-open-path]')
    if (row && !el.popover.hidden) closePopover()
    if (row) {
      if (!event.target.closest('[data-star],[data-more]') && getPrefs().preview) void showPreview(row.dataset.openPath)
      else void openPath(row.dataset.openPath, row.dataset.fileBlobId || null)
      return
    }

    if (!el.popover.hidden && !event.target.closest('#popover')) closePopover()
  })

  el.popover.addEventListener('click', function (event) {
    const button = event.target.closest('[data-pop-index]')
    if (!button) return
    const handler = state.popoverHandlers[Number(button.dataset.popIndex)]
    closePopover()
    if (typeof handler === 'function') void handler()
  })

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closePopover()
      return
    }
    // Tab switching shortcuts
    // Ctrl+Tab or Ctrl+PageDown - next tab
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key === 'Tab') {
        event.preventDefault()
        const allTabs = ['home', ...state.tabs.map(t => t.id)]
        const currentIndex = allTabs.indexOf(state.active)
        if (currentIndex === -1) return
        const nextIndex = event.shiftKey 
          ? (currentIndex - 1 + allTabs.length) % allTabs.length
          : (currentIndex + 1) % allTabs.length
        activateTab(allTabs[nextIndex])
        return
      }
      if (event.key === 'PageDown') {
        event.preventDefault()
        const allTabs = ['home', ...state.tabs.map(t => t.id)]
        const currentIndex = allTabs.indexOf(state.active)
        if (currentIndex === -1) return
        activateTab(allTabs[(currentIndex + 1) % allTabs.length])
        return
      }
      if (event.key === 'PageUp') {
        event.preventDefault()
        const allTabs = ['home', ...state.tabs.map(t => t.id)]
        const currentIndex = allTabs.indexOf(state.active)
        if (currentIndex === -1) return
        activateTab(allTabs[(currentIndex - 1 + allTabs.length) % allTabs.length])
        return
      }
      // Ctrl+1..9 to switch to tab
      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault()
        const num = parseInt(event.key)
        if (num === 1) {
          activateTab('home')
        } else if (state.tabs[num - 2]) {
          activateTab(state.tabs[num - 2].id)
        }
        return
      }
    }
  })

  window.addEventListener('beforeunload', persistTabs)

  function runCommand(command) {
    closePopover()
    if (command === 'open' || command === 'open-local') void openLocalFile()
    else if (command === 'new-docx') void newFile('docx')
    else if (command === 'new-xlsx') void newFile('xlsx')
    else if (command === 'new-pptx') void newFile('pptx')
    else if (command === 'new-md') void newFile('md')
    else if (command === 'new-default') void newFile(getPrefs().format)
    else if (command === 'new-html') void newFile('html')
    else if (command === 'new-pdf') void newFile('pdf')
    else if (command === 'theme') toggleTheme()
    else if (command === 'refresh') void refreshFiles()
    else if (command === 'close-others') closeOtherTabs()
    else if (command === 'reload') window.location.reload()
    else if (command === 'clear-recents') {
      state.recents = []
      writeJson(RECENTS_KEY, [])
      toast('Recent list cleared')
      renderHome()
    }
  }

  // ── boot ─────────────────────────────────────────────────────────────────

  applyTheme()
  restoreTabs()
  renderTabs()
  renderHome()

  if (state.active !== 'home') {
    activateTab(state.active)
  } else {
    el.home.classList.remove('is-hidden')
    el.frames.classList.add('is-hidden')
  }

  void refreshFiles()
  void probeStorage()
  window.setInterval(() => {
    if (state.active === 'home') renderFileRows()
  }, 60000)
})()
;(function zenBackRoute () {
  if (window.__zenBack) return
  window.__zenBack = function () {
    var fr = document.querySelectorAll('iframe')
    for (var i = 0; i < fr.length; i++) {
      var f = fr[i], r = f.getBoundingClientRect(), cs = getComputedStyle(f)
      if (!r.width || !r.height || cs.display === 'none' || cs.visibility === 'hidden') continue
      if (r.right <= 0 || r.left >= window.innerWidth) continue
      try { if (f.contentWindow.__zenBack && f.contentWindow.__zenBack()) return true } catch (_) {}
    }
    return false
  }
})()

;(function zenStorageAccess () {
  function plugin () {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.OpenIntent
  }
  async function granted () {
    try {
      var p = plugin()
      if (!p || !p.storageAccessStatus) return true
      return (await p.storageAccessStatus()).granted !== false
    } catch (e) { return true }
  }
  var denied = null
  document.addEventListener('visibilitychange', async function () {
    if (document.visibilityState !== 'visible' || denied !== true) return
    if (await granted()) { denied = false; location.reload() }
  })
  setTimeout(async function () {
    denied = !(await granted())
    if (!denied) return
    var KEY = 'zenoffice.storageAsked.v1'
    try { if (localStorage.getItem(KEY)) return; localStorage.setItem(KEY, '1') } catch (e) {}
    if (window.confirm('ZenOffice needs "All files access" to list documents that other apps or your file manager put in Documents/ZenOffice. Files stay on your device. Open settings now?')) {
      try { await plugin().requestStorageAccess() } catch (e) {}
    }
  }, 1500)
})()
