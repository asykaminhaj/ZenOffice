/*
 * GenOffice Android shim.
 *
 * The desktop renderers talk to Electron's main process through objects that the
 * preload scripts expose with contextBridge (window.desktop, window.desktopApi,
 * window.slidesApi, window.pdfApi, window.markdownApi, window.htmlApi,
 * window.projectApi). Inside a Capacitor WebView there is no preload, so this
 * script (loaded before the app bundle) installs replacements:
 *
 *   - Docs: real .docx open / save / Save As via the file picker + Filesystem.
 *   - Markdown and HTML: real text open / save / Save As through the launcher.
 *   - HTML: same-origin preview page + postMessage instead of html-preview://.
 *   - PDF: open and render for reading (editing/saving stays desktop-only).
 *   - Sheets: live .xlsx editing via SheetJS/ExcelJS in the WebView.
 *   - Slides: real .pptx editing via a bundled desktop main/preload host.
 *
 * Plain classic script on purpose: it must run before the module bundle.
 */
;(function () {
  'use strict'
  if (window.__genofficeAndroidShim) return
  window.__genofficeAndroidShim = true
  // perf paths measured on 700p (mobile/README.md, Update perf 2/3): on by default; a flag set to false before load wins
  ;['__zenDecoInc', '__zenTabDecoInc', '__zenLocalDom', '__zenJustifyInc', '__zenSkipCjk', '__zenSkipJustify', '__zenSkipTab', '__zenDeferMeasure', '__zenNoGapBatch', '__zenNoFastTabs', '__zenNoFastGap', '__zenSkipLineFactor', '__zenSkipListNumbering', '__zenSkipAnchorLine', '__zenSkipDropCap', '__zenSkipResolvedComment', '__zenSkipSdt', '__zenChunked', '__zenFastSlices', '__zenMaxPasses'].forEach(function (k) {
    if (window[k] === undefined) window[k] = true
  })
  // debounce for deferred measure - INCREASED for 50ms/char target
  if (window.__zenDeferMs === undefined) window.__zenDeferMs = 10000
  // max follow-up pagination passes (default 3 for 50ms/char target, was 6)
  if (window.__zenMaxPasses === undefined) window.__zenMaxPasses = 3

  var LS = 'genoffice.android.'
  var DIR = 'ZenOffice'
  var LANGS = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar']
  var UNSUPPORTED = { ok: false, error: 'Not supported on Android yet' }

  // ---------- dialog motion: pop-out ghost + pop-in fallback (all apps) ----------
  ;(function dialogMotion() {
    try {
      if (typeof document === 'undefined' || !window.MutationObserver) return
      var SEL = '.modal-backdrop, .dialog-backdrop'
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      var style = document.createElement('style')
      style.setAttribute('data-zen-dialog-motion', '')
      style.textContent =
        '@keyframes zen-pop-in{from{opacity:0;scale:.94}to{opacity:1;scale:1}}' +
        '@keyframes zen-fade-out{from{opacity:1}to{opacity:0}}' +
        '@keyframes zen-scale-out{from{scale:1}to{scale:.94}}' +
        '.zen-pop-in{animation:zen-pop-in 170ms cubic-bezier(.2,.9,.3,1) both}' +
        '.zen-ghost{pointer-events:none!important;animation:zen-fade-out 150ms ease-in forwards!important}' +
        '.zen-ghost>*{animation:zen-scale-out 150ms ease-in forwards!important}' +
        '@media (prefers-reduced-motion:reduce){.zen-pop-in{animation:none}}'
      ;(document.head || document.documentElement).appendChild(style)
      var ghosts = new WeakSet()
      function isBackdrop(node) {
        return node && node.nodeType === 1 && node.matches && node.matches(SEL)
      }
      function onAdded(node) {
        if (reduce || !isBackdrop(node) || ghosts.has(node)) return
        var inner = node.firstElementChild
        if (!inner) return
        requestAnimationFrame(function () {
          try {
            var cs = getComputedStyle(inner)
            if (cs.animationName !== 'none' || parseFloat(cs.transitionDuration) > 0) return
            inner.classList.add('zen-pop-in')
            setTimeout(function () { inner.classList.remove('zen-pop-in') }, 260)
          } catch (e) { /* keep dialog as-is */ }
        })
      }
      function onRemoved(node) {
        if (reduce || !isBackdrop(node) || ghosts.has(node) || node.isConnected) return
        ghosts.add(node)
        node.classList.add('zen-ghost')
        node.setAttribute('aria-hidden', 'true')
        try { node.inert = true } catch (e) { /* older engines */ }
        ;(document.body || document.documentElement).appendChild(node)
        setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node)
        }, 220)
      }
      new MutationObserver(function (records) {
        for (var r = 0; r < records.length; r++) {
          var rec = records[r]
          for (var i = 0; i < rec.addedNodes.length; i++) onAdded(rec.addedNodes[i])
          for (var j = 0; j < rec.removedNodes.length; j++) onRemoved(rec.removedNodes[j])
        }
      }).observe(document.documentElement, { childList: true, subtree: true })
    } catch (e) {
      console.error('dialogMotion', e)
    }
  })()

  // Tab ribbon (Home, Insert, ...) tetap terjangkau di jendela sempit: bisa digeser horizontal
  ;(function installRibbonTabScroll() {
    try {
      var style = document.createElement('style')
      style.setAttribute('data-zen-ribbon-tab-scroll', '')
      style.textContent =
        '.ribbon-tabs{overflow-x:auto!important;overflow-y:hidden!important;flex-wrap:nowrap!important;' +
        'scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;touch-action:pan-x}' +
        '.ribbon-tabs::-webkit-scrollbar{display:none}' +
        '.ribbon-tabs>*{flex:none!important;white-space:nowrap}' +
        '.ribbon-tabs>.ribbon-tabs-spacer{flex:1 0 8px!important}'
      ;(document.head || document.documentElement).appendChild(style)
    } catch (e) {
      console.error('ribbonTabScroll', e)
    }
  })()

  // Roda mouse vertikal di atas ribbon -> scroll horizontal (listener hanya di wadah ribbon, bukan document)
  ;(function installRibbonWheelScroll() {
    try {
      if (typeof document === 'undefined') return
      var SEL = '.ribbon, .ribbon-body, [data-ribbon-body], .toolbar, [role="toolbar"]'
      function onWheel(e) {
        if (e.ctrlKey || e.shiftKey || e.metaKey) return
        var dy = e.deltaY
        if (!dy || Math.abs(e.deltaX) >= Math.abs(dy)) return
        var k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1
        for (var n = e.target; n && n.nodeType === 1; n = n.parentElement) {
          var cs = getComputedStyle(n)
          var ox = cs.overflowX
          var oy = cs.overflowY
          var canY = (oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1
          if (!canY && (ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) {
            n.scrollLeft += dy * k
            e.preventDefault()
            return
          }
          if (n === this) break
        }
      }
      document.addEventListener('mouseover', function (e) {
        var t = e.target
        var root = t && t.closest ? t.closest(SEL) : null
        if (!root || root.__zenWheel) return
        root.__zenWheel = true
        root.addEventListener('wheel', onWheel, { passive: false })
      }, true)
    } catch (e) {
      console.error('ribbonWheelScroll', e)
    }
  })()

  // Menu File/Editing di dalam .ribbon-tabs (overflow clip) -> position:fixed, posisi dari tombol induk
  ;(function installFloatingRibbonMenus() {
    try {
      if (typeof document === 'undefined') return
      var st = document.createElement('style')
      st.setAttribute('data-zen-floating-menus', '')
      st.textContent = '.ribbon-tabs .file-menu,.ribbon-tabs .zen-menu{position:fixed!important;z-index:100000!important;right:auto!important;bottom:auto!important;margin:0!important}'
      ;(document.head || document.documentElement).appendChild(st)
      function place() {
        var menus = document.querySelectorAll('.ribbon-tabs .file-menu, .ribbon-tabs .zen-menu')
        for (var i = 0; i < menus.length; i++) {
          var m = menus[i]
          var a = m.parentElement
          if (!a) continue
          var r = a.getBoundingClientRect()
          var w = m.offsetWidth
          var left = m.classList.contains('zen-menu') ? r.right - w : r.left
          left = Math.min(Math.max(8, left), window.innerWidth - w - 8)
          m.style.setProperty('left', left + 'px', 'important')
          m.style.setProperty('top', r.bottom + 6 + 'px', 'important')
        }
      }
      document.addEventListener('click', function () { requestAnimationFrame(place) }, true)
      window.addEventListener('resize', place)
      document.addEventListener('scroll', function (e) {
        var t = e.target
        if (t && t.classList && t.classList.contains('ribbon-tabs')) place()
      }, true)
    } catch (e) {
      console.error('floatingRibbonMenus', e)
    }
  })()

  // Tab ribbon yang tidak muat dilipat ke tombol "»" (seperti Word); pilih lewat popup
  ;(function installRibbonTabFold() {
    try {
      if (typeof document === 'undefined') return
      var style = document.createElement('style')
      style.setAttribute('data-zen-ribbon-tab-fold', '')
      style.textContent =
        '.zen-tab-more-btn{font-weight:600;letter-spacing:.02em;cursor:pointer}' +
        '.zen-tab-more{position:fixed;z-index:100000;min-width:168px;max-width:calc(100vw - 16px);padding:6px;' +
        'border:1px solid var(--border-strong,#d0d0d0);border-radius:12px;background:var(--surface,Canvas);' +
        'color:var(--text-primary,var(--text,CanvasText));box-shadow:0 6px 28px rgba(0,0,0,.18);' +
        'transform-origin:top left;animation:zen-pop-in 170ms cubic-bezier(.2,.9,.3,1) both}' +
        '.zen-tab-more button{display:block;width:100%;height:38px;padding:0 14px;border:0;border-radius:8px;' +
        'background:transparent;color:inherit;font:inherit;font-size:14px;text-align:left;cursor:pointer}' +
        '.zen-tab-more button:hover,.zen-tab-more button:active{background:rgba(127,127,127,.16)}' +
        '.workbook-status{flex:0 1 auto!important;min-width:0!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      ;(document.head || document.documentElement).appendChild(style)

      var row = null
      var pop = null
      var raf = 0
      var mo = null
      var ro = null
      var MO_CFG = { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected'] }

      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'ribbon-tab zen-tab-more-btn'
      btn.textContent = '\u00bb'
      btn.setAttribute('aria-label', 'More tabs')
      btn.setAttribute('aria-haspopup', 'menu')

      function tabsOf(r) {
        var list = Array.prototype.filter.call(r.querySelectorAll('.ribbon-tab, [role="tab"]'), function (t) {
          return t !== btn && !t.classList.contains('ribbon-tab-file') && !t.closest('.file-tab-wrap')
        })
        if (list.length) return list
        // Sheets: tombol polos di antara .qa-sep terakhir dan spacer
        var seps = r.querySelectorAll(':scope > .qa-sep')
        var sep = seps[seps.length - 1]
        var out = []
        for (var n = sep && sep.nextElementSibling; n && !n.classList.contains('ribbon-tabs-spacer'); n = n.nextElementSibling) {
          if (n !== btn && n.tagName === 'BUTTON') out.push(n)
        }
        return out
      }
      function isActive(t) {
        return t.classList.contains('active') || t.getAttribute('aria-selected') === 'true'
      }
      function isFolded(t) {
        return t.style.display === 'none'
      }
      function closePop(instant) {
        if (!pop) return
        var p = pop
        pop = null
        if (instant) {
          p.remove()
          return
        }
        p.style.animation = 'zen-fade-out 120ms ease-in forwards'
        p.style.pointerEvents = 'none'
        setTimeout(function () { p.remove() }, 140)
      }
      function openPop() {
        closePop(true)
        if (!row) return
        var list = tabsOf(row).filter(isFolded)
        if (!list.length) return
        pop = document.createElement('div')
        pop.className = 'zen-tab-more'
        pop.setAttribute('role', 'menu')
        list.forEach(function (t) {
          var b = document.createElement('button')
          b.type = 'button'
          b.setAttribute('role', 'menuitem')
          b.textContent = (t.textContent || '').trim()
          b.addEventListener('click', function () {
            closePop()
            t.click()
          })
          pop.appendChild(b)
        })
        document.body.appendChild(pop)
        var r = btn.getBoundingClientRect()
        var w = pop.offsetWidth
        pop.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + 'px'
        pop.style.top = r.bottom + 4 + 'px'
      }
      btn.addEventListener('click', function (e) {
        e.stopPropagation()
        if (pop) closePop()
        else openPop()
      })
      document.addEventListener('pointerdown', function (e) {
        if (pop && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closePop()
      }, true)
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closePop()
      })

      function layout() {
        if (!row || !row.isConnected) return
        if (mo) mo.disconnect()
        try {
          var tabs = tabsOf(row)
          tabs.forEach(function (t) { t.style.removeProperty('display') })
          if (btn.parentNode) btn.parentNode.removeChild(btn)
          if (tabs.length > 1 && row.scrollWidth > row.clientWidth + 1) {
            tabs[tabs.length - 1].insertAdjacentElement('afterend', btn)
            var order = tabs.slice().reverse().filter(function (t) { return !isActive(t) })
            for (var i = 0; i < order.length; i++) {
              order[i].style.setProperty('display', 'none', 'important')
              var vis = tabs.filter(function (t) { return !isFolded(t) })
              ;(vis.length ? vis[vis.length - 1] : tabs[0]).insertAdjacentElement('afterend', btn)
              if (row.scrollWidth <= row.clientWidth + 1) break
            }
          }
          if (!btn.parentNode) closePop(true)
        } finally {
          if (mo) mo.observe(row, MO_CFG)
        }
      }
      function schedule() {
        if (raf) return
        raf = requestAnimationFrame(function () {
          raf = 0
          layout()
        })
      }
      function setup(r) {
        row = r
        r.setAttribute('data-zen-tabfold', '')
        if (mo) mo.disconnect()
        if (ro) ro.disconnect()
        mo = new MutationObserver(schedule)
        mo.observe(r, MO_CFG)
        if (window.ResizeObserver) {
          ro = new ResizeObserver(schedule)
          ro.observe(r)
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule)
        schedule()
      }
      setInterval(function () {
        if (row && row.isConnected) return
        var r = document.querySelector('.ribbon-tabs')
        if (r) setup(r)
      }, 600)
    } catch (e) {
      console.error('ribbonTabFold', e)
    }
  })()

  function lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(LS + key)
      return v == null ? fallback : JSON.parse(v)
    } catch (e) {
      return fallback
    }
  }
  function lsSet(key, value) {
    try {
      localStorage.setItem(LS + key, JSON.stringify(value))
    } catch (e) {
      /* storage can be unavailable; the shim must keep working without it */
    }
  }

  function language() {
    var l = String(lsGet('lang', null) || navigator.language || 'en')
      .slice(0, 2)
      .toLowerCase()
    return LANGS.indexOf(l) >= 0 ? l : 'en'
  }

  // The shell owns the appearance preference for every tab. The renderers use
  // their own preferences keys, so read the shell key directly and follow its
  // storage events when the user switches theme without reloading a tab.
  function shellTheme() {
    try {
      var raw = localStorage.getItem('genoffice.shell.theme.v1')
      var value = raw == null ? 'system' : JSON.parse(raw)
      return value === 'dark' || value === 'light' ? value : 'system'
    } catch (e) {
      return 'system'
    }
  }

  function subscribeShellTheme(handler) {
    if (typeof handler !== 'function') return noop
    var notify = function () {
      try {
        handler(shellTheme())
      } catch (e) {
        /* a renderer that unmounted mid-notification must not break the tab */
      }
    }
    var onStorage = function (event) {
      if (!event || event.key === 'genoffice.shell.theme.v1') notify()
    }
    var onMessage = function (event) {
      if (event.origin !== location.origin) return
      if (event.data && event.data.__genofficeTheme === true) notify()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('message', onMessage)
    return function () {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('message', onMessage)
    }
  }

  // Android ships without AI. The desktop renderers still contain their AI
  // panel/ribbon code, so close every remembered panel and hide the entry
  // points before the app module first renders. This also keeps the AI code
  // from requesting settings/network on launch.
  ;(function installAiRemoval() {
    ;['aidocs.showAi', 'ai-sheets-show-ai', 'ai-slides-show-ai'].forEach(function (key) {
      try { localStorage.setItem(key, '0') } catch (e) { /* storage is optional */ }
    })
    try {
      var style = document.createElement('style')
      style.setAttribute('data-genoffice-ai-removal', '')
      style.textContent = [
        '.ai-dock, .ai-panel, .ai-ask-trigger, .ai-ask-pop,',
        '.stage-ai-bar, .ai-entry, [data-ai="true"],',
        '.rb-big:has(.ai-feature-icon),',
        '.ribbon-tool:has(.ai-feature-icon),',
        '.ribbon-group:has(.ai-entry) { display: none !important; }',
        /* Drop groups that only contained AI buttons, but keep mixed groups
           (e.g. Proofing, which also has ordinary spelling/comment actions). */
        '.ribbon-group:has(.ai-feature-icon):not(:has(> .ribbon-group-items > :not(:has(.ai-feature-icon)))) { display: none !important; }',
        '.ribbon-group:has(.ai-entry) + .ribbon-sep,',
        '.ribbon-group:has(.ai-feature-icon) + .ribbon-sep { display: none !important; }',
      ].join('\n')
      ;(document.head || document.documentElement).appendChild(style)
    } catch (e) {
      /* CSS is a progressive enhancement; the prefs below still keep AI closed */
    }
  })()

  function noop() {}
  function unsubscribe() {
    return noop
  }

  // ---------- which app are we in? ----------

  function appId() {
    var m = /^\/(docs|sheets|slides|pdf|markdown|html)(?:\/|$)/.exec(location.pathname)
    return m ? m[1] : 'home'
  }

  // The shell opens each file in its own iframe and tags the URL with a tab id.
  // The query string is also the fallback transport for restarts/reloads when
  // the one-shot IndexedDB record has already been consumed.
  var params = new URLSearchParams(location.search)
  var shellTab = params.get('tab') || ''
  var handoffKey = params.get('handoff') || shellTab
  var queryPath = params.get('path') || ''
  var queryNew = params.get('new') || ''
  var queryFileBlobId = params.get('fileBlobId') || ''

  function isEmbedded() {
    try {
      return window.parent && window.parent !== window
    } catch (e) {
      return false
    }
  }

  // Capacitor injects its native bridge into the top-level document only. File
  // tabs live in same-origin iframes, so plugin calls made there would never
  // reach Android. The shim proxies the Filesystem methods through the shell
  // document, where the real plugin is available.
  var embeddedFilesystem = null
  var fsRequestId = 0
  var fsPending = Object.create(null)
  var FS_METHODS = {
    stat: true,
    readdir: true,
    mkdir: true,
    readFile: true,
    writeFile: true,
    appendFile: true,
    deleteFile: true,
    rename: true,
    copy: true,
    getUri: true,
    checkPermissions: true,
    requestPermissions: true,
  }

  function rawNativeFilesystem() {
    return window.Capacitor &&
      window.Capacitor.Plugins &&
      window.Capacitor.Plugins.Filesystem
      ? window.Capacitor.Plugins.Filesystem
      : null
  }

  function installFilesystemProxy() {
    var proxy = {}
    Object.keys(FS_METHODS).forEach(function (method) {
      proxy[method] = function (options) {
        return new Promise(function (resolve, reject) {
          var id = 'fs_' + Date.now().toString(36) + '_' + ++fsRequestId
          var timer = setTimeout(function () {
            delete fsPending[id]
            reject(new Error('Filesystem request timed out: ' + method))
          }, 30000)
          fsPending[id] = function (error, result) {
            clearTimeout(timer)
            delete fsPending[id]
            if (error) reject(new Error(error))
            else resolve(result)
          }
          try {
            window.parent.postMessage(
              { __genofficeFs: true, id: id, method: method, options: options || {} },
              location.origin,
            )
          } catch (e) {
            clearTimeout(timer)
            delete fsPending[id]
            reject(e)
          }
        })
      }
    })
    return proxy
  }

  function filesystem() {
    var nativeFs = rawNativeFilesystem()
    if (!isEmbedded() && nativeFs) return nativeFs
    if (!embeddedFilesystem) embeddedFilesystem = installFilesystemProxy()
    return embeddedFilesystem
  }

  if (isEmbedded()) {
    window.addEventListener('message', function (event) {
      if (event.origin !== location.origin) return
      var data = event.data
      if (!data || data.__genofficeFsResult !== true || !data.id) return
      var callback = fsPending[data.id]
      if (callback) callback(data.error || null, data.result)
    })
  } else {
    // The shell is the only top-level GenOffice page; service its tab iframes.
    window.addEventListener('message', async function (event) {
      if (event.origin !== location.origin) return
      var data = event.data
      if (!data || data.__genofficeFs !== true || !FS_METHODS[data.method]) return
      var source = event.source
      if (!source) return
      var reply = { __genofficeFsResult: true, id: data.id }
      try {
        var nativeFs = rawNativeFilesystem()
        if (!nativeFs || typeof nativeFs[data.method] !== 'function') {
          throw new Error('Filesystem plugin unavailable')
        }
        reply.result = await nativeFs[data.method](data.options || {})
      } catch (e) {
        reply.error = String((e && e.message) || e)
      }
      try {
        source.postMessage(reply, event.origin)
      } catch (e) {
        /* the tab was closed while the request was in flight */
      }
    })
  }

  function notifyShell(type, payload) {
    if (!isEmbedded()) return
    try {
      window.parent.postMessage(
        Object.assign(
          {
            __genofficeShell: true,
            type: type,
            app: appId(),
            tab: shellTab,
            at: Date.now(),
          },
          payload || {},
        ),
        location.origin,
      )
    } catch (e) {
      /* the app still works standalone when the shell is unavailable */
    }
  }

  function notifySaved(path, size) {
    if (!path) return
    notifyShell('saved', { path: path, name: baseName(path), size: Number(size) || 0 })
  }

  // Expose notifyShell for apps to use
  window.__genofficeShellNotify = notifyShell

  // Handle save request from shell
  if (isEmbedded()) {
    window.addEventListener('message', function (event) {
      if (event.origin !== location.origin) return
      var data = event.data
      if (!data || data.__genofficeShell !== true || data.type !== 'save') return
      // Dispatch event for app to handle
      var saveEvent = new CustomEvent('genoffice-shell-save', { detail: { source: event.source } })
      window.dispatchEvent(saveEvent)
    })
  }


  // ---------- native bridge for iframes: clipboard / share / selection toolbar ----------
  // Capacitor plugins are not reachable from tab iframes; calls are proxied to the shell.

  var ZEN_NATIVE_OPS = { setEnabled: 1, readClipboard: 1, webSearch: 1, share: 1, shareFile: 1 }
  var zenSeq = 0
  var zenWaiters = Object.create(null)

  function zenNativeCall(method, args) {
    if (!ZEN_NATIVE_OPS[method]) return Promise.reject(new Error('op not allowed: ' + method))
    if (!isEmbedded()) {
      if (!window.Capacitor || !window.Capacitor.nativePromise) {
        return Promise.reject(new Error('Capacitor unavailable'))
      }
      return window.Capacitor.nativePromise('SelectionMenu', method, args || {})
    }
    return new Promise(function (resolve, reject) {
      var id = 'zn_' + Date.now().toString(36) + '_' + ++zenSeq
      var timer = setTimeout(function () {
        delete zenWaiters[id]
        reject(new Error('native call timed out'))
      }, 15000)
      zenWaiters[id] = { resolve: resolve, reject: reject, timer: timer }
      try {
        window.parent.postMessage(
          { __zenNative: true, id: id, method: method, args: args || {} },
          location.origin,
        )
      } catch (e) {
        clearTimeout(timer)
        delete zenWaiters[id]
        reject(e)
      }
    })
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin) return
    var d = event.data
    if (!d) return
    if (d.__zenNative === true && !isEmbedded() && event.source && event.source !== window) {
      zenNativeCall(d.method, d.args).then(
        function (result) {
          event.source.postMessage(
            { __zenNativeResult: true, id: d.id, ok: true, result: result },
            location.origin,
          )
        },
        function (err) {
          event.source.postMessage(
            { __zenNativeResult: true, id: d.id, ok: false, error: String((err && err.message) || err) },
            location.origin,
          )
        },
      )
      return
    }
    if (d.__zenNativeResult === true && zenWaiters[d.id]) {
      var w = zenWaiters[d.id]
      delete zenWaiters[d.id]
      clearTimeout(w.timer)
      if (d.ok) w.resolve(d.result)
      else w.reject(new Error(d.error || 'native call failed'))
    }
  })

  window.__zenNative = { call: zenNativeCall }

  // Toolbar seleksi native hanya dimatikan saat jari menyentuh editor dokumen
  // (menu ZenOffice menggantikannya); di app lain tetap normal.
  document.addEventListener(
    'pointerdown',
    function () {
      zenNativeCall('setEnabled', { enabled: appId() === 'docs' }).catch(function () {})
    },
    true,
  )

  // ---------- native PDF printing (shell -> Capacitor PdfExport) ----------
  //
  // File tabs live in same-origin iframes, so Capacitor plugins are not
  // reachable from them. Print requests are proxied to the shell, which calls
  // the native offscreen-WebView PdfExport plugin and posts the PDF bytes back.

  var printSeq = 0
  var printWaiters = Object.create(null)

  function nativePrint(options) {
    return new Promise(function (resolve, reject) {
      if (!isEmbedded()) {
        reject(new Error('Native PDF export requires the ZenOffice shell'))
        return
      }
      var id = 'print_' + Date.now().toString(36) + '_' + ++printSeq
      var waiter = { resolve: resolve, reject: reject, timer: null }
      waiter.timer = setTimeout(function () {
        if (!printWaiters[id]) return
        delete printWaiters[id]
        reject(new Error('Native PDF export timed out'))
      }, 300000)
      printWaiters[id] = waiter
      try {
        window.parent.postMessage(
          Object.assign(
            { __genofficePrint: true, id: id, app: appId(), tab: shellTab },
            options || {},
          ),
          location.origin,
        )
      } catch (e) {
        clearTimeout(waiter.timer)
        delete printWaiters[id]
        reject(e)
      }
    })
  }

  if (isEmbedded()) {
    window.addEventListener('message', function (event) {
      if (event.origin !== location.origin) return
      var data = event.data
      if (!data || data.__genofficePrintResult !== true || !data.id) return
      var waiter = printWaiters[data.id]
      if (!waiter) return
      clearTimeout(waiter.timer)
      delete printWaiters[data.id]
      if (data.error) waiter.reject(new Error(data.error))
      else waiter.resolve(data)
    })
  }

  function pageSizeInches(pageSize, landscape) {
    var width = 8.27
    var height = 11.69
    if (pageSize && typeof pageSize === 'object') {
      width = Number(pageSize.width) || width
      height = Number(pageSize.height) || height
    } else {
      var known = {
        A3: [11.69, 16.54],
        A4: [8.27, 11.69],
        A5: [5.83, 8.27],
        Legal: [8.5, 14],
        Letter: [8.5, 11],
        Tabloid: [11, 17],
      }
      var pair = known[String(pageSize || 'A4')] || known.A4
      width = pair[0]
      height = pair[1]
    }
    if (landscape && width < height) {
      var swap = width
      width = height
      height = swap
    }
    return { widthIn: width, heightIn: height }
  }

  async function saveBase64Pdf(defaultName, base64, outPath) {
    var bytes = fromBase64(base64)
    if (typeof outPath === 'string' && outPath.length > 0) {
      var direct = await writeDocument(outPath, bytes)
      if (outPath.indexOf('.export-images-') < 0) notifySaved(direct, bytes.byteLength)
      return direct
    }
    var suggested = withExtension(safeName(defaultName || 'Export.pdf'), '.pdf')
    var asked = askName(suggested)
    if (!asked) return null
    var rel = await writeDocument(withExtension(asked, '.pdf'), bytes, { unique: true })
    notifySaved(rel, bytes.byteLength)
    return rel
  }

  // ---------- Docs print HTML (serialize the pagination preview) ----------
  //
  // Printing the active iframe directly is unreliable: an iframe is a
  // monolithic replaced element in CSS fragmentation, so its stacked pages can
  // be clipped to one sheet. Instead the preview is cloned into a standalone
  // document, with the print media rules promoted to normal rules, and printed
  // by the native offscreen WebView.

  function docsPrintCss() {
    var parts = []
    var sheets = document.styleSheets || []
    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i]
      var rules = null
      try {
        rules = sheet.cssRules
      } catch (e) {
        continue
      }
      if (!rules) continue
      for (var j = 0; j < rules.length; j++) {
        var rule = rules[j]
        try {
          if (rule.type === CSSRule.PAGE_RULE) {
            parts.push(rule.cssText)
          } else if (
            rule.type === CSSRule.MEDIA_RULE &&
            rule.media &&
            /(^|,)\s*print\b/i.test(rule.media.mediaText)
          ) {
            var inner = rule.cssRules || []
            for (var k = 0; k < inner.length; k++) parts.push(inner[k].cssText)
          }
        } catch (e) {
          /* a rule the engine cannot serialize: keep the rest */
        }
      }
    }
    return parts.join('\n')
  }

  async function dataUrlForBlob(src) {
    var blob = await (await fetch(src)).blob()
    return await new Promise(function (resolve, reject) {
      var reader = new FileReader()
      reader.onload = function () { resolve(reader.result) }
      reader.onerror = function () { reject(reader.error || new Error('read failed')) }
      reader.readAsDataURL(blob)
    })
  }

  async function inlinePreviewImages(root) {
    var images = root.querySelectorAll('img')
    for (var i = 0; i < images.length; i++) {
      var src = images[i].getAttribute('src') || ''
      if (src.indexOf('blob:') !== 0) continue
      try {
        images[i].setAttribute('src', await dataUrlForBlob(src))
      } catch (e) {
        /* an unreachable blob stays as-is; the rest of the page still prints */
      }
    }
  }

  function replacePreviewCanvases(original, clone) {
    var originals = original.querySelectorAll('canvas')
    var clones = clone.querySelectorAll('canvas')
    var limit = Math.min(originals.length, clones.length)
    for (var i = 0; i < limit; i++) {
      try {
        var src = originals[i]
        var target = clones[i]
        var image = document.createElement('img')
        image.src = src.toDataURL('image/png')
        var style = window.getComputedStyle(src)
        image.style.width = style.width
        image.style.height = style.height
        image.style.display = style.display
        target.parentNode.replaceChild(image, target)
      } catch (e) {
        /* a tainted canvas falls back to its blank clone */
      }
    }
  }

  // User-installed fonts (Documents/fonts, loaded as FontFace objects) are in no stylesheet, so the
  // serialized preview loses them in the offscreen print WebView: embed the ones the document uses.
  function fontDataToBase64(d) {
    if (!d) return ''
    if (typeof d === 'string') return d.replace(/^data:[^,]*,/, '')
    if (d instanceof ArrayBuffer) return toBase64(new Uint8Array(d))
    if (d.buffer instanceof ArrayBuffer) return toBase64(new Uint8Array(d.buffer, d.byteOffset || 0, d.byteLength))
    if (d.base64) return String(d.base64)
    if (d.data) return fontDataToBase64(d.data)
    return ''
  }

  async function docsUserFontCss(preview) {
    try {
      var F = window.__genofficeFonts
      if (!F || typeof F.faces !== 'function' || typeof F.faceData !== 'function') return ''
      var faces = await F.faces()
      if (!faces || !faces.length) return ''
      var used = Object.create(null)
      var seenFf = Object.create(null)
      var els = preview.querySelectorAll('.pv-content *')
      for (var i = 0; i < els.length; i++) {
        var ff = window.getComputedStyle(els[i]).fontFamily
        if (!ff || seenFf[ff]) continue
        seenFf[ff] = 1
        ff.split(',').forEach(function (n) {
          used[n.trim().replace(/^["']|["']$/g, '').toLowerCase()] = 1
        })
      }
      var css = ''
      for (var k = 0; k < faces.length; k++) {
        var f = faces[k]
        if (!f || !f.family || !used[String(f.family).toLowerCase()]) continue
        var b64 = fontDataToBase64(await F.faceData(f.id))
        if (!b64) continue
        var parts = String(f.id || '').split('|')
        var weight = parseInt(parts[1], 10) || (f.bold ? 700 : 400)
        var style = parts[2] === 'italic' || f.italic ? 'italic' : 'normal'
        css += '@font-face{font-family:"' + String(f.family).replace(/"/g, '') +
          '";src:url(data:font/ttf;base64,' + b64 + ');font-weight:' + weight + ';font-style:' + style + '}\n'
      }
      return css
    } catch (e) {
      return ''
    }
  }

  async function buildDocsPrintHtml(widthIn, heightIn) {
    var preview = document.querySelector('.pagination-preview')
    if (!preview) throw new Error('The pagination preview is not ready')
    var clone = preview.cloneNode(true)
    var skipped = clone.querySelectorAll('.pv-print-skip')
    for (var i = 0; i < skipped.length; i++) {
      if (skipped[i].parentNode) skipped[i].parentNode.removeChild(skipped[i])
    }
    var toolbars = clone.querySelectorAll('.pv-toolbar')
    for (var t = 0; t < toolbars.length; t++) {
      if (toolbars[t].parentNode) toolbars[t].parentNode.removeChild(toolbars[t])
    }
    replacePreviewCanvases(preview, clone)
    await inlinePreviewImages(clone)

    var head = '<meta charset="utf-8">'
    var links = document.querySelectorAll('link[rel="stylesheet"]')
    for (var l = 0; l < links.length; l++) {
      if (!links[l].href) continue
      head += '<link rel="stylesheet" href="' + links[l].href.replace(/"/g, '&quot;') + '">'
    }
    var styles = document.querySelectorAll('style')
    for (var st = 0; st < styles.length; st++) {
      head += '<style>' + styles[st].textContent + '</style>'
    }

    var userFontCss = await docsUserFontCss(preview)
    if (userFontCss) head += '<style>' + userFontCss + '</style>'

    var printCss = docsPrintCss()
    var pageCss =
      '@page{size:' + widthIn + 'in ' + heightIn + 'in;margin:0}' +
      'html,body{margin:0;padding:0;background:#fff}' +
      '.pagination-preview{display:block!important;position:static!important;background:none!important}' +
      '.pv-scroll{overflow:visible!important;padding:0!important;display:block!important}' +
      '.pv-page{margin:0!important;box-shadow:none!important;break-after:page!important;page-break-after:always!important}' +
      '.pv-page:last-child{break-after:auto!important;page-break-after:auto!important}'

    return (
      '<!doctype html><html><head>' +
      head +
      '<style>' + pageCss + '\n' + printCss + '</style>' +
      '</head><body><div class="app"><div class="pagination-preview">' +
      clone.innerHTML +
      '</div></div></body></html>'
    )
  }

  async function printDocsPreview(widthIn, heightIn) {
    var html = await buildDocsPrintHtml(widthIn, heightIn)
    return await nativePrint({
      method: 'printHtml',
      html: html,
      baseUrl: location.href,
      widthIn: widthIn,
      heightIn: heightIn,
    })
  }

  // ---------- file helpers ----------

  function pickFile(accept) {
    return new Promise(function (resolve) {
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
    })
  }

  function pickFiles(accept, multiple) {
    return new Promise(function (resolve) {
      var input = document.createElement('input')
      input.type = 'file'
      if (accept) input.accept = accept
      if (multiple !== false) input.multiple = true
      input.style.display = 'none'
      var done = false
      function finish(files) {
        if (done) return
        done = true
        if (input.parentNode) input.parentNode.removeChild(input)
        resolve(files || null)
      }
      input.addEventListener('change', function () {
        finish(input.files && input.files.length ? Array.prototype.slice.call(input.files) : null)
      })
      input.addEventListener('cancel', function () {
        finish(null)
      })
      document.body.appendChild(input)
      input.click()
    })
  }

  function toHex(buf) {
    var b = new Uint8Array(buf)
    var s = ''
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16)
    return s
  }

  async function sha256(bytes) {
    try {
      return toHex(await crypto.subtle.digest('SHA-256', bytes))
    } catch (e) {
      return 'nohash-' + bytes.byteLength
    }
  }

  function toBase64(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    var chunk = 0x8000
    var bin = ''
    for (var i = 0; i < u8.length; i += chunk) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk))
    }
    return btoa(bin)
  }

  function fromBase64(data) {
    var bin = atob(String(data || ''))
    var out = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }

  function bytesOf(value) {
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    if (typeof value === 'string') return new TextEncoder().encode(value)
    throw new TypeError('unsupported file data')
  }

  function textOf(bytes) {
    return new TextDecoder('utf-8').decode(bytes)
  }

  function safeName(name) {
    return String(name || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
  }

  function baseName(path) {
    var s = String(path || '').replace(/\\/g, '/')
    return s.slice(s.lastIndexOf('/') + 1) || 'Untitled'
  }

  /** Map any path the desktop app hands us to a relative Documents/ZenOffice path. */
  function documentPath(pathOrName) {
    var s = String(pathOrName || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (s.indexOf(DIR + '/') === 0 && s.indexOf('..') < 0) return s
    return DIR + '/' + safeName(baseName(s))
  }

  function splitExt(name) {
    // Keep any parent folder: uniquePath used to sanitize the whole relative
    // path, which turned "GenOffice/Untitled.docx" into a file in Documents/.
    var raw = String(name || 'Untitled').replace(/\\/g, '/')
    var slash = raw.lastIndexOf('/')
    var dir = slash >= 0 ? raw.slice(0, slash + 1) : ''
    var n = safeName(raw.slice(slash + 1) || 'Untitled')
    var i = n.lastIndexOf('.')
    if (i <= 0) return { dir: dir, stem: n, ext: '' }
    return { dir: dir, stem: n.slice(0, i), ext: n.slice(i) }
  }

  async function statPath(rel) {
    var fs = filesystem()
    if (!fs) return null
    try {
      return await fs.stat({ path: rel, directory: 'DOCUMENTS' })
    } catch (e) {
      return null
    }
  }

  async function exists(rel) {
    return !!(await statPath(rel))
  }

  async function uniquePath(rel) {
    if (!(await exists(rel))) return rel
    var p = splitExt(rel)
    for (var i = 2; i < 1000; i++) {
      var candidate = p.dir + p.stem + ' (' + i + ')' + p.ext
      if (!(await exists(candidate))) return candidate
    }
    return p.dir + p.stem + '-' + Date.now() + p.ext
  }

  /** Writes into Documents/ZenOffice/<name>; returns the stored relative path. */
  async function writeDocument(relOrName, data, options) {
    var fs = filesystem()
    if (!fs) throw new Error('Filesystem plugin unavailable (not running inside the Android app)')
    var rel = documentPath(relOrName)
    if (options && options.unique) rel = await uniquePath(rel)
    await fs.writeFile({
      path: rel,
      data: toBase64(bytesOf(data)),
      directory: 'DOCUMENTS',
      recursive: true,
    })
    return rel
  }

  async function readDocument(rel) {
    var fs = filesystem()
    if (!fs) throw new Error('Filesystem plugin unavailable (not running inside the Android app)')
    var r = await fs.readFile({ path: rel, directory: 'DOCUMENTS' })
    return fromBase64(r.data)
  }

  async function removeDocument(rel) {
    var fs = filesystem()
    if (!fs) return
    try {
      await fs.deleteFile({ path: rel, directory: 'DOCUMENTS' })
    } catch (e) {
      /* best effort */
    }
  }

  // Files opened from the launcher or the Android picker are kept in memory for
  // the lifetime of the renderer, so reads never depend on a content:// grant.
  var memoryFiles = Object.create(null)

  function remember(path, value) {
    memoryFiles[path] = value
    return path
  }

  async function bytesFor(path) {
    var key = documentPath(path)
    var hit = memoryFiles[key]
    if (hit && hit.bytes) return hit.bytes
    if (hit && hit.blob) {
      var b = new Uint8Array(await hit.blob.arrayBuffer())
      hit.bytes = b
      return b
    }
    var bytes = await readDocument(key)
    memoryFiles[key] = { bytes: bytes }
    return bytes
  }

  async function textFor(path) {
    var key = documentPath(path)
    var hit = memoryFiles[key]
    if (hit && typeof hit.text === 'string') return hit.text
    return textOf(await bytesFor(key))
  }

  // ---------- one-shot handoff from the launcher (IndexedDB, shared origin) ----------

  var DB_NAME = 'genoffice-android'
  var DB_STORE = 'pending'
  var DB_FILE_BLOBS = 'file-blobs'

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'))
      var req = indexedDB.open(DB_NAME, 3)
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(DB_STORE)) {
          req.result.createObjectStore(DB_STORE, { keyPath: 'app' })
        }
        if (!req.result.objectStoreNames.contains(DB_FILE_BLOBS)) {
          req.result.createObjectStore(DB_FILE_BLOBS, { keyPath: 'id' })
        }
      }
      req.onsuccess = function () {
        resolve(req.result)
      }
      req.onerror = function () {
        reject(req.error || new Error('IndexedDB open failed'))
      }
    })
  }

  async function idbPut(record) {
    var db = await openDb()
    await new Promise(function (resolve, reject) {
      var tx = db.transaction(DB_STORE, 'readwrite')
      tx.objectStore(DB_STORE).put(record)
      tx.oncomplete = resolve
      tx.onerror = function () {
        reject(tx.error)
      }
    })
    db.close()
  }

  async function idbTake(app) {
    var db = await openDb()
    var record = await new Promise(function (resolve, reject) {
      var tx = db.transaction(DB_STORE, 'readwrite')
      var store = tx.objectStore(DB_STORE)
      var req = store.get(app)
      req.onsuccess = function () {
        var value = req.result || null
        if (value) store.delete(app)
        resolve(value)
      }
      req.onerror = function () {
        reject(req.error)
      }
    })
    db.close()
    return record
  }

  async function putPending(app, file) {
    var record = {
      app: app,
      name: file.name,
      type: file.type || '',
      size: file.size,
      at: Date.now(),
      blob: file,
    }
    await idbPut(record)
    return { name: record.name, size: record.size, type: record.type }
  }

  async function takePending(app) {
    try {
      return await idbTake(app)
    } catch (e) {
      return null
    }
  }

  // ---------- persistent file blobs for recent files ----------
  // Stores file blobs with a persistent ID so they can be reopened from recents
  // even if the original file is outside Documents/ZenOffice.

  async function putFileBlob(file) {
    var id = 'blob_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    var record = {
      id: id,
      name: file.name,
      type: file.type || '',
      size: file.size,
      at: Date.now(),
      blob: file,
    }
    var db = await openDb()
    await new Promise(function (resolve, reject) {
      var tx = db.transaction(DB_FILE_BLOBS, 'readwrite')
      tx.objectStore(DB_FILE_BLOBS).put(record)
      tx.oncomplete = resolve
      tx.onerror = function () {
        reject(tx.error)
      }
    })
    db.close()
    return id
  }

  async function getFileBlob(id) {
    if (!id || !id.startsWith('blob_')) return null
    var db = await openDb()
    var record = await new Promise(function (resolve, reject) {
      var tx = db.transaction(DB_FILE_BLOBS, 'readonly')
      var req = tx.objectStore(DB_FILE_BLOBS).get(id)
      req.onsuccess = function () {
        resolve(req.result || null)
      }
      req.onerror = function () {
        reject(req.error)
      }
    })
    db.close()
    return record ? { blob: record.blob, name: record.name, type: record.type, size: record.size } : null
  }

  async function removeFileBlob(id) {
    if (!id || !id.startsWith('blob_')) return
    var db = await openDb()
    await new Promise(function (resolve, reject) {
      var tx = db.transaction(DB_FILE_BLOBS, 'readwrite')
      tx.objectStore(DB_FILE_BLOBS).delete(id)
      tx.oncomplete = resolve
      tx.onerror = function () {
        reject(tx.error)
      }
    })
    db.close()
  }

  async function rememberPending(app) {
    // A tab-specific key takes priority; the plain app key is kept for the
    // in-app Open buttons and for older launcher records.
    console.log('[rememberPending] Called for app:', app, { handoffKey, queryFileBlobId, queryPath })
    var record = null
    if (handoffKey) record = await takePending(handoffKey)
    if (!record && handoffKey !== app) record = await takePending(app)

    var path = ''
    var newBlobId = ''
    if (record) {
      console.log('[rememberPending] Found record via handoffKey')
      path = record.path
        ? documentPath(record.path)
        : await uniquePath(documentPath(record.name))
      if (record.blob) remember(path, { blob: record.blob, name: record.name })
      if (record.blob && !queryFileBlobId) {
        // salinan permanen: Recent bisa buka ulang file dari folder mana pun
        try {
          var keepFile =
            typeof File !== 'undefined' && record.blob instanceof File
              ? record.blob
              : new File([record.blob], record.name || baseName(path), {
                  type: record.type || record.blob.type || '',
                })
          newBlobId = await putFileBlob(keepFile)
        } catch (e) {
          console.warn('[rememberPending] putFileBlob failed:', e)
        }
      }
    } else if (queryFileBlobId) {
      console.log('[rememberPending] Trying fileBlobId:', queryFileBlobId)
      // Try to get file blob from persistent storage (for recent files from any folder)
      var blobRecord = await getFileBlob(queryFileBlobId)
      if (blobRecord && blobRecord.blob) {
        console.log('[rememberPending] Got blob from fileBlobId:', blobRecord.name)
        path = await uniquePath(documentPath(blobRecord.name))
        remember(path, { blob: blobRecord.blob, name: blobRecord.name })
        record = {
          app: app,
          name: blobRecord.name,
          path: path,
          size: blobRecord.size || 0,
          modified: Date.now(),
          type: blobRecord.type || '',
        }
      } else {
        console.warn('[rememberPending] No blob found for fileBlobId:', queryFileBlobId)
        // Notify shell that file was not found - shell will show error and clean up recent entry
        notifyShell('file-not-found', { fileBlobId: queryFileBlobId, path: queryPath || '' })
        return null
      }
    } else if (queryPath) {
      console.log('[rememberPending] Trying queryPath:', queryPath)
      path = documentPath(queryPath)
      var info = await statPath(path)
      if (!info) {
        notifyShell('file-not-found', { fileBlobId: '', path: queryPath })
        return null
      }
      if (!info) return null
      record = {
        app: app,
        name: baseName(path),
        path: path,
        size: Number(info.size) || 0,
        modified: Number(info.mtime) || Date.now(),
        type: '',
      }
    }

    if (!record) {
      console.warn('[rememberPending] No record found, returning null')
      return null
    }
    console.log('[rememberPending] Success, notifying shell:', { path, name: record.name })
    notifyShell('opened', {
      path: path,
      name: record.name || baseName(path),
      size: record.size || 0,
      fileBlobId: queryFileBlobId || newBlobId || '',
    })
    return { record: record, path: path }
  }

  // ---------- prompts ----------

  function askName(defaultName) {
    var value = window.prompt('File name', defaultName)
    if (value == null) return null
    value = value.trim()
    return value || null
  }

  function withExtension(name, ext) {
    if (ext && !new RegExp('\\' + ext + '$', 'i').test(name)) return name + ext
    return name
  }

  // ---------- generic defaults shared by all apps ----------

  var common = {
    getLanguage: async function () {
      return language()
    },
    getSystemLocale: async function () {
      return navigator.language || 'en-US'
    },
    getTheme: async function () {
      return shellTheme()
    },
    onThemeChanged: function (handler) {
      return subscribeShellTheme(handler)
    },
    getDocumentTheme: async function () {
      return 'follow'
    },
    getAutoSaveDefault: async function () {
      // app-owned-autosave: the shell no longer has an Auto Save preference.
      // Every editor starts from this fixed default and its own AutoSave pill
      // decides from there, so a stale shell value cannot lock the editors.
      return { on: false, updatedAt: 0 }
    },
    getAuthorName: async function () {
      return lsGet('author', 'Android user')
    },
    getUserDisplayName: async function () {
      return lsGet('author', 'Android user')
    },
    getAiPanelPrefs: async function () {
      // AI is not part of the Android build: always report the panel as off,
      // while preserving side/font preferences for file-format compatibility.
      var prefs = lsGet('aiPanelPrefs', null) || {}
      return {
        side: prefs.side || 'right',
        fontSize: prefs.fontSize || 'default',
        showAiSidebar: false,
        openInNewDocs: false,
        spellcheck: false,
      }
    },
    setAiPanelPrefs: async function (patch) {
      var prefs = lsGet('aiPanelPrefs', null) || {}
      lsSet('aiPanelPrefs', Object.assign({}, prefs, patch || {}, {
        showAiSidebar: false,
        openInNewDocs: false,
      }))
      return this.getAiPanelPrefs()
    },
    consumePendingOpenDocx: async function () {
      return null
    },
    consumeNewBlankDoc: async function () {
      return false
    },
    consumeAiDocContent: async function () {
      return null
    },
    consumeHeadlessExport: async function () {
      return null
    },
    confirmDocumentReplace: async function () {
      return window.confirm('Replace the current document?')
    },
    respondToZotero: noop,
    headlessExportDone: noop,
    setAutoSaveDefault: async function (on) {
      lsSet('autosave', !!on)
      return { on: !!on, updatedAt: Date.now() }
    },
  }

  // ---------- Sheets (browser .xlsx via SheetJS + live Univer snapshot) ----------

  var xlsxSessions = Object.create(null)
  var BASE_STYLE = {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    wrapText: false,
    diagonalUp: false,
    diagonalDown: false,
  }

  function uuid() {
    try {
      if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    } catch (e) {
      /* fall through */
    }
    var hex = '0123456789abcdef'
    var out = ''
    for (var i = 0; i < 32; i++) out += hex[Math.floor(Math.random() * 16)]
    return (
      out.slice(0, 8) +
      '-' +
      out.slice(8, 12) +
      '-4' +
      out.slice(13, 16) +
      '-a' +
      out.slice(17, 20) +
      '-' +
      out.slice(20)
    )
  }

  function sheetIdAt(index) {
    return 'sheet-' + String(index + 1)
  }

  function a1Address(row, column) {
    return XLSX.utils.encode_cell({ r: row, c: column })
  }

  function areaOf(startRow, startColumn, endRow, endColumn) {
    return {
      startRow: startRow,
      startColumn: startColumn,
      endRow: endRow,
      endColumn: endColumn,
    }
  }

  function parseWorkbookBytes(bytes, name, path, sha, fileBytes) {
    if (!window.XLSX) throw new Error('The spreadsheet engine is unavailable')
    var isCsv = /\.csv$/i.test(name || '')
    var wb = isCsv
      ? XLSX.read(textOf(bytes), { type: 'string', cellFormula: true, cellNF: true })
      : XLSX.read(bytes, {
          type: 'array',
          cellFormula: true,
          cellNF: true,
          cellStyles: true,
          cellDates: false,
          sheetStubs: false,
        })
    var names = wb.SheetNames && wb.SheetNames.length ? wb.SheetNames : ['Sheet1']
    if (!wb.Sheets[names[0]]) wb.Sheets[names[0]] = {}
    var sessionId = uuid()
    var sheets = []
    var sheetIds = []

    for (var i = 0; i < names.length; i++) {
      var ws = wb.Sheets[names[i]] || {}
      var ref = ws['!ref'] || 'A1'
      var decoded = XLSX.utils.decode_range(ref)
      var meta = wb.Workbook && wb.Workbook.Sheets && wb.Workbook.Sheets[i]
      var hidden = !!(meta && (meta.Hidden === 1 || meta.Hidden === 2 || meta.Hidden === true))
      var veryHidden = !!(meta && (meta.Hidden === 2 || meta.Hidden === 'veryHidden'))
      var columns = []
      if (ws['!cols']) {
        for (var c = 0; c < ws['!cols'].length; c++) {
          var col = ws['!cols'][c]
          if (!col) continue
          // WorkbookFile.columnWidths.width is OOXML character width, not
          // pixels. SheetJS exposes the original width as `width`, and `wch`
          // as its rounded character equivalent.
          var width
          if (typeof col.width === 'number') width = col.width
          else if (typeof col.wch === 'number') width = col.wch
          else if (typeof col.wpx === 'number') width = Math.round((col.wpx / 7) * 256) / 256
          columns.push({
            startColumn: c,
            endColumn: c,
            width: width,
            hidden: !!col.hidden,
          })
        }
      }
      var id = sheetIdAt(i)
      sheetIds.push(id)
      sheets.push({
        id: id,
        name: names[i],
        rowCount: Math.max(1000, decoded.e.r + 1),
        columnCount: Math.max(26, decoded.e.c + 1),
        columnWidths: columns,
        defaultRowHeight: null,
        defaultColumnWidth: null,
        freeze: null,
        hidden: hidden,
        veryHidden: veryHidden,
        tabColor: null,
        showGridLines: ws['!gridlines'] !== false,
        tables: [],
        comments: [],
        pivotRanges: [],
        pivotTables: [],
        sparklines: [],
        cellImages: [],
      })
    }

    var entryCount = 0
    for (var s = 0; s < names.length; s++) {
      var sheetObj = wb.Sheets[names[s]]
      if (!sheetObj) continue
      for (var key in sheetObj) {
        if (key.charAt(0) !== '!') entryCount++
      }
    }

    var definedNames = []
    var wbNames = wb.Workbook && wb.Workbook.Names
    if (Array.isArray(wbNames)) {
      for (var n = 0; n < wbNames.length; n++) {
        var def = wbNames[n]
        if (!def || !def.Name || !def.Ref) continue
        var entry = { name: def.Name, formula: '=' + String(def.Ref).replace(/^=/, '') }
        if (typeof def.Sheet === 'number' && def.Sheet >= 0) entry.sheetIndex = def.Sheet
        definedNames.push(entry)
      }
    }

    var activeTab = 0
    var view = wb.Workbook && wb.Workbook.WBView && wb.Workbook.WBView[0]
    if (view && typeof view.activeTab === 'number') activeTab = view.activeTab
    activeTab = Math.min(Math.max(0, activeTab), names.length - 1)

    var file = {
      sessionId: sessionId,
      name: name || baseName(path) || 'Untitled.xlsx',
      sha256: sha,
      fileBytes: fileBytes,
      entryCount: entryCount,
      sheets: sheets,
      activeTab: activeTab,
      styles: [BASE_STYLE],
      dxfStyles: [],
      visuals: [],
      definedNames: definedNames,
      readOnly: false,
      needsSaveAs: false,
      unsavedNew: false,
    }
    if (path) file.path = path

    return {
      file: file,
      wb: wb,
      names: names,
      ids: sheetIds,
      path: path || '',
      bytes: bytes,
    }
  }

  function blankWorkbookSession(path) {
    if (!window.XLSX) throw new Error('The spreadsheet engine is unavailable')
    var wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1')
    var bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true })
    var parsed = parseWorkbookBytes(new Uint8Array(bytes), baseName(path), '', '')
    parsed.path = path
    parsed.file.path = undefined
    parsed.file.unsavedNew = true
    parsed.file.needsSaveAs = false
    return parsed
  }

  async function makeWorkbookFile(session) {
    var sha = await sha256(session.bytes)
    session.file.sha256 = sha
    session.file.fileBytes = session.bytes.byteLength
    var copy = JSON.parse(JSON.stringify(session.file))
    if (session.path) copy.path = session.path
    return copy
  }

  function findSheetIndex(session, sheetId) {
    for (var i = 0; i < session.ids.length; i++) {
      if (session.ids[i] === sheetId) return i
    }
    return -1
  }

  function workbookRange(session, sheetId, range) {
    var index = findSheetIndex(session, sheetId)
    if (index < 0) throw new Error('Unknown sheet')
    var ws = session.wb.Sheets[session.names[index]] || {}
    var cells = []
    var rowLimit = range.endRow
    var columnLimit = range.endColumn

    for (var key in ws) {
      if (key.charAt(0) === '!') continue
      var pos
      try {
        pos = XLSX.utils.decode_cell(key)
      } catch (e) {
        continue
      }
      if (
        pos.r < range.startRow ||
        pos.r > rowLimit ||
        pos.c < range.startColumn ||
        pos.c > columnLimit
      ) {
        continue
      }
      var cell = ws[key]
      if (!cell) continue
      if (cell.v === undefined && !cell.f) continue
      var value = cell.v === undefined ? null : cell.v
      if (cell.t === 'e') value = cell.w || String(cell.v || '#VALUE!')
      var record = { row: pos.r, column: pos.c, value: value }
      if (cell.f) record.formula = '=' + String(cell.f).replace(/^=/, '')
      if (cell.F && String(cell.F).length <= 64) record.arrayRef = String(cell.F)
      cells.push(record)
    }

    var rows = []
    if (ws['!rows']) {
      for (var r = range.startRow; r <= Math.min(rowLimit, ws['!rows'].length - 1); r++) {
        var row = ws['!rows'][r]
        if (!row) continue
        var out = { row: r, hidden: !!row.hidden }
        if (typeof row.hpx === 'number') out.height = row.hpx
        else if (typeof row.hpt === 'number') out.height = (row.hpt * 96) / 72
        if (out.height !== undefined) out.customHeight = true
        rows.push(out)
      }
    }

    var merges = []
    if (ws['!merges']) {
      for (var m = 0; m < ws['!merges'].length; m++) {
        var merge = ws['!merges'][m]
        if (
          merge.e.r < range.startRow ||
          merge.s.r > rowLimit ||
          merge.e.c < range.startColumn ||
          merge.s.c > columnLimit
        ) {
          continue
        }
        merges.push(areaOf(merge.s.r, merge.s.c, merge.e.r, merge.e.c))
      }
    }

    var autoFilter = null
    if (ws['!autofilter'] && ws['!autofilter'].ref) {
      var af = XLSX.utils.decode_range(ws['!autofilter'].ref)
      autoFilter = areaOf(af.s.r, af.s.c, af.e.r, af.e.c)
    }

    return {
      cells: cells,
      rows: rows,
      merges: merges,
      hyperlinks: [],
      conditionalRules: [],
      autoFilter: autoFilter,
      autoFilterColumns: [],
      dataValidations: [],
      sheetProtection: null,
      rowBreaks: [],
      colBreaks: [],
      pageSetup: null,
      protectedRanges: [],
      // We parse the whole workbook up front, so every row is indexed. A
      // null here means "still indexing" to the streamed loader, which then
      // skips installing the visible range entirely.
      indexedThroughRow: Math.max(0, session.file.sheets[index].rowCount - 1),
      indexingComplete: true,
    }
  }

  function formulaCells(session, sheetId) {
    var index = findSheetIndex(session, sheetId)
    if (index < 0) return { cells: [], sharedGroups: [], indexingComplete: true, truncated: false }
    var ws = session.wb.Sheets[session.names[index]] || {}
    var cells = []
    for (var key in ws) {
      if (key.charAt(0) === '!') continue
      var cell = ws[key]
      if (!cell || !cell.f) continue
      var pos = XLSX.utils.decode_cell(key)
      cells.push({
        row: pos.r,
        column: pos.c,
        value: cell.v === undefined ? null : cell.v,
        formula: '=' + String(cell.f).replace(/^=/, ''),
      })
    }
    return { cells: cells, sharedGroups: [], indexingComplete: true, truncated: false }
  }

  function findCells(session, request) {
    var wantedIndex = request.sheetId ? findSheetIndex(session, request.sheetId) : -1
    var matches = []
    var needle = request.query
    var caseSensitive = !!request.matchCase
    var entire = !!request.matchEntireCell
    if (!caseSensitive) needle = needle.toLowerCase()
    var startSheet = wantedIndex >= 0 ? wantedIndex : 0
    var endSheet = wantedIndex >= 0 ? wantedIndex : session.names.length - 1

    for (var index = startSheet; index <= endSheet; index++) {
      var ws = session.wb.Sheets[session.names[index]] || {}
      for (var key in ws) {
        if (key.charAt(0) === '!') continue
        var cell = ws[key]
        if (!cell) continue
        var values = []
        if (request.lookIn !== 'formulas_only' && cell.v !== undefined && cell.v !== null) {
          values.push(String(cell.w !== undefined ? cell.w : cell.v))
        }
        if (request.lookIn !== 'values' && cell.f) {
          values.push('=' + String(cell.f).replace(/^=/, ''))
        }
        var matched = false
        for (var v = 0; v < values.length; v++) {
          var hay = caseSensitive ? values[v] : values[v].toLowerCase()
          if (entire ? hay === needle : hay.indexOf(needle) >= 0) {
            matched = true
            break
          }
        }
        if (!matched) continue
        var pos = XLSX.utils.decode_cell(key)
        var out = {
          sheetId: session.ids[index],
          row: pos.r,
          column: pos.c,
          value: cell.v === undefined ? null : cell.v,
          valueText: cell.v === undefined ? null : String(cell.w !== undefined ? cell.w : cell.v),
        }
        if (cell.f) out.formulaText = '=' + String(cell.f).replace(/^=/, '')
        matches.push(out)
        if (matches.length >= (request.limit || 1000)) {
          return {
            matches: matches,
            complete: false,
            nextCursor: {
              sheetId: session.ids[index],
              row: pos.r,
              column: pos.c + 1,
            },
            indexingComplete: true,
          }
        }
      }
    }
    return { matches: matches, complete: true, indexingComplete: true }
  }

  function makeSheetCell(value, formula, keepCache) {
    var cell
    if (formula) {
      cell = { f: String(formula).replace(/^=/, '') }
      if (typeof value === 'number') {
        cell.t = 'n'
        cell.v = value
      } else if (typeof value === 'boolean') {
        cell.t = 'b'
        cell.v = value
      } else if (typeof value === 'string') {
        cell.t = 's'
        cell.v = value
      } else if (keepCache && typeof keepCache.v === 'number') {
        cell.t = 'n'
        cell.v = keepCache.v
      }
      return cell
    }
    if (value === null || value === undefined) return null
    if (typeof value === 'number') return { t: 'n', v: value }
    if (typeof value === 'boolean') return { t: 'b', v: value }
    return { t: 's', v: String(value) }
  }

  function setBaseCell(wb, name, row, column, value, formula, keepCache) {
    var ws = wb.Sheets[name]
    if (!ws) {
      ws = {}
      wb.Sheets[name] = ws
    }
    var address = a1Address(row, column)
    var cell = makeSheetCell(value, formula, keepCache)
    if (!cell) {
      delete ws[address]
      return
    }
    var old = ws[address]
    if (
      !keepCache &&
      old &&
      old.f &&
      formula &&
      String(old.f).replace(/^=/, '') === String(formula).replace(/^=/, '') &&
      old.v !== undefined
    ) {
      cell.v = old.v
      cell.t = old.t
    }
    ws[address] = cell
  }

  function applyCellEdits(wb, session, edits) {
    if (!Array.isArray(edits)) return
    for (var i = 0; i < edits.length; i++) {
      var edit = edits[i]
      if (!edit) continue
      var index = findSheetIndex(session, edit.sheetId)
      if (index < 0) continue
      var name = session.names[index]
      if (edit.writeValue !== true && !edit.formula) continue
      setBaseCell(
        wb,
        name,
        edit.row,
        edit.column,
        edit.value === undefined ? null : edit.value,
        edit.formula,
        null,
      )
    }
  }

  function snapshotToWorkbook(session, request) {
    var api = window.__univerAPI
    var live = api && api.getActiveWorkbook && api.getActiveWorkbook()
    var snapshot = live && live.getSnapshot ? live.getSnapshot() : null
    if (!snapshot) throw new Error('The spreadsheet is not ready yet')

    // Start from the file's own workbook. The Univer snapshot only contains
    // the windows the streaming grid has loaded; rebuilding from it alone
    // would silently drop untouched rows and every sheet the user never
    // visited. Journal edits are replayed onto the base file first, then the
    // live snapshot overlays the regions it actually owns.
    var baseBytes = session.bytes && session.bytes.byteLength ? session.bytes : null
    var base
    if (baseBytes) {
      try {
        base = XLSX.read(baseBytes, {
          type: 'array',
          cellFormula: true,
          cellNF: true,
          cellStyles: true,
          cellDates: false,
          sheetStubs: true,
        })
      } catch (e) {
        base = null
      }
    }
    if (!base) {
      base = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(base, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1')
    }
    applyCellEdits(base, session, request && request.edits)

    var order = snapshot.sheetOrder && snapshot.sheetOrder.length
      ? snapshot.sheetOrder
      : Object.keys(snapshot.sheets || {})
    var wb = XLSX.utils.book_new()
    var sheetList = []
    var used = {}
    var lazy = window.__lazyState
    var loadedRanges = (lazy && lazy.loadedRanges) || null

    for (var i = 0; i < order.length; i++) {
      var id = order[i]
      var source = snapshot.sheets && snapshot.sheets[id]
      if (!source) continue
      var baseIndex = findSheetIndex(session, id)
      var baseName = baseIndex >= 0 ? session.names[baseIndex] : null
      var baseWs = baseName ? base.Sheets[baseName] : null
      var ws = baseWs ? JSON.parse(JSON.stringify(baseWs)) : {}
      var maxRow = 0
      var maxCol = 0
      var decoded = null
      if (ws['!ref']) {
        try {
          decoded = XLSX.utils.decode_range(ws['!ref'])
          maxRow = Math.max(0, decoded.e.r)
          maxCol = Math.max(0, decoded.e.c)
        } catch (e) {
          decoded = null
        }
      }

      var cellData = source.cellData || {}
      for (var rKey in cellData) {
        var row = Number(rKey)
        var rowCells = cellData[rKey] || {}
        for (var cKey in rowCells) {
          var column = Number(cKey)
          var data = rowCells[cKey]
          if (!data) continue
          var old = ws[a1Address(row, column)] || null
          var cell = makeSheetCell(
            data.v === undefined ? null : data.v,
            data.f,
            old && old.f && data.f && String(old.f).replace(/^=/, '') === String(data.f).replace(/^=/, '') ? old : null,
          )
          if (!cell) {
            delete ws[a1Address(row, column)]
            continue
          }
          ws[a1Address(row, column)] = cell
          maxRow = Math.max(maxRow, row)
          maxCol = Math.max(maxCol, column)
        }
      }

      var mergeData = source.mergeData || []
      if (mergeData.length) {
        ws['!merges'] = mergeData.map(function (merge) {
          return {
            s: { r: merge.startRow, c: merge.startColumn },
            e: { r: merge.endRow, c: merge.endColumn },
          }
        })
      }

      if (source.columnData) {
        var cols = ws['!cols'] || []
        for (var colKey in source.columnData) {
          var col = Number(colKey)
          var info = source.columnData[colKey] || {}
          var colOut = cols[col] || {}
          if (typeof info.w === 'number') colOut.width = Math.round((info.w / 8) * 256) / 256
          else if (typeof info.width === 'number') colOut.width = info.width
          if (info.hd || info.hidden) colOut.hidden = true
          cols[col] = colOut
          maxCol = Math.max(maxCol, col)
        }
        if (cols.length) ws['!cols'] = cols
      }
      if (source.rowData) {
        var rowsInfo = ws['!rows'] || []
        for (var rowKey in source.rowData) {
          var rowIdx = Number(rowKey)
          var rowInfo = source.rowData[rowKey] || {}
          var rowOut = rowsInfo[rowIdx] || {}
          if (typeof rowInfo.h === 'number') rowOut.hpx = rowInfo.h
          if (rowInfo.hd || rowInfo.hidden) rowOut.hidden = true
          rowsInfo[rowIdx] = rowOut
          maxRow = Math.max(maxRow, rowIdx)
        }
        if (rowsInfo.length) ws['!rows'] = rowsInfo
      }
      if (source.showGridlines === 0) ws['!gridlines'] = false
      else delete ws['!gridlines']
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } })

      var safeName = String(source.name || 'Sheet' + (i + 1)).slice(0, 31) || 'Sheet' + (i + 1)
      var baseCandidate = safeName
      var n = 2
      while (used[safeName]) {
        safeName = (baseCandidate.slice(0, 28) + ' (' + (n++) + ')').slice(0, 31)
      }
      used[safeName] = true
      sheetList.push(safeName)
      XLSX.utils.book_append_sheet(wb, ws, safeName)
    }

    if (!sheetList.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1')
      sheetList.push('Sheet1')
    }
    if (!wb.Workbook) wb.Workbook = {}
    wb.Workbook.Sheets = sheetList.map(function (_name, index) {
      var id = order[index]
      var sheet = snapshot.sheets && snapshot.sheets[id]
      var hidden = sheet && (sheet.hidden === 1 || sheet.hidden === true)
      return { Hidden: hidden ? 1 : 0 }
    })
    if (base.Workbook && base.Workbook.Names) wb.Workbook.Names = base.Workbook.Names
    return { wb: wb, order: order }
  }

  function serializeLiveWorkbookWithSheetJS(session, request) {
    var converted = snapshotToWorkbook(session, request)
    var bytes = new Uint8Array(
      XLSX.write(converted.wb, {
        bookType: 'xlsx',
        type: 'array',
        compression: true,
        cellStyles: false,
      }),
    )
    return { bytes: bytes, sheets: converted.order.length }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script')
      script.src = src
      script.onload = function () {
        resolve()
      }
      script.onerror = function () {
        reject(new Error('Could not load ' + src))
      }
      document.head.appendChild(script)
    })
  }

  async function ensureExcelJS() {
    if (window.ExcelJS) return
    if (!window.__genofficeExcelJSLoading) {
      window.__genofficeExcelJSLoading = loadScript('../shim/exceljs.min.js').catch(function (e) {
        console.warn('[genoffice] ExcelJS unavailable; using the basic writer', e)
      })
    }
    await window.__genofficeExcelJSLoading
  }

  function applyExcelCell(cell, value, formula) {
    if (formula) {
      var payload = { formula: String(formula).replace(/^=/, '') }
      if (value !== null && value !== undefined) payload.result = value
      cell.value = payload
    } else if (value === null || value === undefined) {
      cell.value = null
    } else {
      cell.value = value
    }
  }

  async function serializeLiveWorkbookWithExcelJS(session, request, snapshot) {
    var Workbook = window.ExcelJS.Workbook
    var workbook = new Workbook()
    if (session.bytes && session.bytes.byteLength) {
      var base = session.bytes.buffer.slice(
        session.bytes.byteOffset,
        session.bytes.byteOffset + session.bytes.byteLength,
      )
      await workbook.xlsx.load(base)
    } else {
      workbook.addWorksheet('Sheet1')
    }

    var byId = Object.create(null)
    for (var b = 0; b < session.ids.length; b++) {
      var baseSheet = workbook.getWorksheet(session.names[b])
      if (baseSheet) byId[session.ids[b]] = baseSheet
    }

    // Journal edits are in the screen's (post-structural-op) coordinates.
    if (Array.isArray(request && request.edits)) {
      for (var e = 0; e < request.edits.length; e++) {
        var edit = request.edits[e]
        if (!edit) continue
        var target = byId[edit.sheetId]
        if (!target) continue
        if (edit.writeValue !== true && !edit.formula) continue
        applyExcelCell(
          target.getCell(edit.row + 1, edit.column + 1),
          edit.value === undefined ? null : edit.value,
          edit.formula,
        )
      }
    }

    var order = snapshot.sheetOrder && snapshot.sheetOrder.length
      ? snapshot.sheetOrder
      : Object.keys(snapshot.sheets || {})
    var present = Object.create(null)
    for (var o = 0; o < order.length; o++) present[order[o]] = true

    // Drop deleted sheets before any final rename so name collisions clear.
    var all = workbook.worksheets.slice()
    for (var a = 0; a < all.length; a++) {
      var matched = false
      for (var mid in byId) {
        if (byId[mid] === all[a]) matched = true
      }
      if (!matched) workbook.removeWorksheet(all[a].id)
    }

    // Rename to temporary names first: swapping two sheet names must not
    // collide halfway through the final assignment.
    var tempIndex = 0
    for (var tid in byId) {
      byId[tid].name = '__genoffice_tmp_' + tempIndex++
    }

    var names = []
    var usedNames = Object.create(null)
    var finalSheets = []
    for (var i = 0; i < order.length; i++) {
      var id = order[i]
      var source = snapshot.sheets && snapshot.sheets[id]
      if (!source) continue
      var ws = byId[id]
      if (!ws) {
        ws = workbook.addWorksheet('Sheet' + (i + 1))
        byId[id] = ws
      }
      var safeName = String(source.name || 'Sheet' + (i + 1)).slice(0, 31) || 'Sheet' + (i + 1)
      var candidate = safeName
      var n = 2
      while (usedNames[safeName]) safeName = (candidate.slice(0, 28) + ' (' + (n++) + ')').slice(0, 31)
      usedNames[safeName] = true
      ws.name = safeName
      ws.orderNo = i
      names.push(safeName)
      finalSheets.push(ws)
      var hidden = source.hidden
      ws.state = hidden === 2 ? 'veryHidden' : hidden === 1 || hidden === true ? 'hidden' : 'visible'
    }

    for (var f = 0; f < order.length; f++) {
      var sid = order[f]
      var sheetSource = snapshot.sheets && snapshot.sheets[sid]
      var worksheet = byId[sid]
      if (!sheetSource || !worksheet) continue

      var cellData = sheetSource.cellData || {}
      for (var rKey in cellData) {
        var row = Number(rKey)
        var rowCells = cellData[rKey] || {}
        for (var cKey in rowCells) {
          var column = Number(cKey)
          var data = rowCells[cKey]
          if (!data) continue
          var cell = worksheet.getCell(row + 1, column + 1)
          applyExcelCell(
            cell,
            data.v === undefined ? null : data.v,
            data.f,
          )
        }
      }

      if (Array.isArray(sheetSource.mergeData)) {
        var existing = (worksheet.model.merges || []).slice()
        for (var em = 0; em < existing.length; em++) {
          try {
            worksheet.unMergeCells(existing[em])
          } catch (error) {
            /* ignore malformed merge ranges in damaged files */
          }
        }
        for (var nm = 0; nm < sheetSource.mergeData.length; nm++) {
          var merge = sheetSource.mergeData[nm]
          try {
            worksheet.mergeCells(
              merge.startRow + 1,
              merge.startColumn + 1,
              merge.endRow + 1,
              merge.endColumn + 1,
            )
          } catch (error) {
            /* skip an overlapping/invalid merge */
          }
        }
      }

      var columnData = sheetSource.columnData || {}
      for (var colKey in columnData) {
        var col = Number(colKey)
        var info = columnData[colKey] || {}
        var excelCol = worksheet.getColumn(col + 1)
        if (typeof info.w === 'number') excelCol.width = Math.max(0.25, Math.round((info.w / 8) * 256) / 256)
        else if (typeof info.width === 'number') excelCol.width = info.width
        if (info.hd || info.hidden) excelCol.hidden = true
      }
      var rowData = sheetSource.rowData || {}
      for (var rowKey in rowData) {
        var rowIdx = Number(rowKey)
        var rowInfo = rowData[rowKey] || {}
        var excelRow = worksheet.getRow(rowIdx + 1)
        if (typeof rowInfo.h === 'number') excelRow.height = (rowInfo.h * 72) / 96
        if (rowInfo.hd || rowInfo.hidden) excelRow.hidden = true
      }
    }

    // Sheet order must be applied after every sheet has its final orderNo.
    for (var s = 0; s < finalSheets.length; s++) finalSheets[s].orderNo = s
    var bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
    return { bytes: bytes, sheets: finalSheets.length }
  }

  async function serializeLiveWorkbook(session, request) {
    var api = window.__univerAPI
    var live = api && api.getActiveWorkbook && api.getActiveWorkbook()
    var snapshot = live && live.getSnapshot ? live.getSnapshot() : null
    if (!snapshot) throw new Error('The spreadsheet is not ready yet')
    try {
      await ensureExcelJS()
      if (window.ExcelJS) return await serializeLiveWorkbookWithExcelJS(session, request, snapshot)
    } catch (e) {
      console.warn('[genoffice] ExcelJS save failed; falling back to the basic writer', e)
    }
    return serializeLiveWorkbookWithSheetJS(session, request)
  }

  async function loadXlsxSession(path, pending) {
    var bytes = await bytesFor(path)
    var name = (pending && pending.record && pending.record.name) || baseName(path)
    var sha = await sha256(bytes)
    var session = parseWorkbookBytes(bytes, name, path, sha, bytes.byteLength)
    xlsxSessions[session.file.sessionId] = session
    return session
  }

  async function selectXlsxWorkbook() {
    if (!window.XLSX) return null
    var pending = await rememberPending('sheets')
    if (pending) {
      var opened = await loadXlsxSession(pending.path, pending)
      opened = await zenSheetsRecoveryOffer(opened)
      return await makeWorkbookFile(opened)
    }
    if (queryNew === 'xlsx') {
      var target = await uniquePath(documentPath('Untitled.xlsx'))
      var blank = blankWorkbookSession(target)
      xlsxSessions[blank.file.sessionId] = blank
      return await makeWorkbookFile(blank)
    }
    return null
  }

  // ---------- crash recovery (Sheets) ----------
  var zenSheetsPromptCb = null
  var zenSheetsPromptQueued = null
  var zenSheetsPromptDone = null
  var zenSheetsPromptTimer = 0
  function zenSheetsAsk(payload) {
    return new Promise(function (resolve) {
      zenSheetsPromptDone = resolve
      if (zenSheetsPromptCb) {
        zenSheetsPromptCb(payload)
        return
      }
      zenSheetsPromptQueued = payload
      zenSheetsPromptTimer = setTimeout(function () {
        if (zenSheetsPromptQueued) {
          zenSheetsPromptQueued = null
          zenSheetsPromptDone = null
          resolve('skip')
        }
      }, 8000)
    })
  }
  async function zenSheetsRecoveryOffer(session) {
    try {
      if (!session || !session.path) return session
      var key = 'xlsx:' + session.path
      var rec = await zenRecovery.get(key)
      if (!rec || !rec.bytes) return session
      var recBytes = new Uint8Array(rec.bytes)
      var recSha = await sha256(recBytes)
      if (recSha === (await sha256(session.bytes))) {
        zenRecoveryClear(key)
        return session
      }
      var name = baseName(session.path)
      var choice = await zenSheetsAsk({
        title: 'Recovered version found',
        body: 'Unsaved changes from the last session were found for ' + name + '. Restore the recovered version? Your original file is not changed until you save.',
        restoreLabel: 'Restore',
        discardLabel: 'Discard',
        fileName: name,
        savedAtMs: rec.at || Date.now(),
      })
      if (choice === 'discard') {
        zenRecoveryClear(key)
        return session
      }
      if (choice !== 'restore') return session
      var restored = parseWorkbookBytes(recBytes, name, session.path, recSha, recBytes.byteLength)
      restored.path = session.path
      restored.file.path = session.path
      restored.file.restoredFromRecovery = true
      delete xlsxSessions[session.file.sessionId]
      xlsxSessions[restored.file.sessionId] = restored
      return restored
    } catch (e) {
      return session
    }
  }

  var sheets = {
    hasQueuedWorkbook: async function () {
      return !!(queryPath || queryNew === 'xlsx' || handoffKey)
    },
    consumeNewBlankWorkbook: async function () {
      return queryNew === 'xlsx'
    },
    addFont: async function(fontName, fontData) {
      try {
        if (typeof window !== 'undefined' && window.__genofficeAddFont) {
          await window.__genofficeAddFont(fontName, fontData)
          return { ok: true }
        }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
      return { ok: true }
    },
    selectWorkbook: selectXlsxWorkbook,
    async reopenWorkbook(path) {
      var rel = documentPath(path)
      for (var id in xlsxSessions) {
        if (xlsxSessions[id].path === rel) return await makeWorkbookFile(xlsxSessions[id])
      }
      if (!(await exists(rel))) return null
      var session = await loadXlsxSession(rel, null)
      return await makeWorkbookFile(session)
    },
    async closeWorkbook(sessionId) {
      delete xlsxSessions[sessionId]
    },
    async readWorkbookRange(request) {
      var session = xlsxSessions[request.sessionId]
      if (!session) throw new Error('The spreadsheet session is no longer open')
      return workbookRange(session, request.sheetId, request.range)
    },
    async readWorkbookFormulas(request) {
      var session = xlsxSessions[request.sessionId]
      if (!session) throw new Error('The spreadsheet session is no longer open')
      return formulaCells(session, request.sheetId)
    },
    async findWorkbookCells(request) {
      var session = xlsxSessions[request.sessionId]
      if (!session) throw new Error('The spreadsheet session is no longer open')
      return findCells(session, request)
    },
    async readWorkbookRowOutline(request) {
      return { rows: [] }
    },
    async readWorkbookRedactions() {
      return { status: 'absent' }
    },
    async readPivotDefinition() {
      return null
    },
    async readWorkbookMedia() {
      return null
    },
    async writeWorkbookRecovery(request) {
      try {
        var rsession = request && xlsxSessions[request.sessionId]
        if (!rsession || !rsession.path) return { ok: false }
        var rkey = 'xlsx:' + rsession.path
        if (Date.now() - (zenRecClearedAt[rkey] || 0) < 4000) return { ok: true }
        var rbytes = (await serializeLiveWorkbook(rsession, request)).bytes
        await zenRecovery.put(rkey, new Uint8Array(bytesOf(rbytes)))
        return { ok: true }
      } catch (e) {
        return { ok: false }
      }
    },
    onRecoveryPrompt: function (cb) {
      zenSheetsPromptCb = cb
      if (zenSheetsPromptQueued) {
        var queued = zenSheetsPromptQueued
        zenSheetsPromptQueued = null
        clearTimeout(zenSheetsPromptTimer)
        cb(queued)
      }
      return function () {
        if (zenSheetsPromptCb === cb) zenSheetsPromptCb = null
      }
    },
    replyRecoveryPrompt: function (restore) {
      var done = zenSheetsPromptDone
      zenSheetsPromptDone = null
      if (done) done(restore === true ? 'restore' : 'discard')
    },
    async autoRenameWorkbook(sessionId, baseName) {
      var session = xlsxSessions[sessionId]
      if (!session) return { renamed: false }
      return { renamed: false }
    },
    async beginSaveEditsTransfer() {
      return { ok: true }
    },
    async sendSaveEditsChunk() {
      return { ok: true }
    },
    async abortSaveEditsTransfer() {
      return { ok: true }
    },
    async saveWorkbookEdits(request) {
      var session = xlsxSessions[request.sessionId]
      if (!session) return { canceled: false, error: 'The spreadsheet session is no longer open' }
      try {
        var targetName = session.file.name || 'Untitled.xlsx'
        var targetPath = session.path
        if (request.mode === 'save-as' || !targetPath) {
          var asked = request.targetPath
            ? baseName(request.targetPath)
            : askName(targetName)
          if (!asked) return { canceled: true }
          asked = withExtension(safeName(asked), '.xlsx')
          targetPath = documentPath(asked)
          if (!request.targetPath && (await exists(targetPath))) {
            if (!window.confirm('Replace "' + asked + '"?')) return { canceled: true }
          }
        }

        var bytes
        if (typeof request.csvContent === 'string' && /\.csv$/i.test(targetPath)) {
          bytes = new TextEncoder().encode(request.csvContent)
        } else {
          bytes = (await serializeLiveWorkbook(session, request)).bytes
        }
        var rel = await writeDocument(targetPath, bytes)
        zenRecoveryClear('xlsx:' + targetPath)
        zenRecoveryClear('xlsx:' + rel)
        var sha = await sha256(bytes)
        var parsed = parseWorkbookBytes(bytes, baseName(rel), rel, sha, bytes.byteLength)
        parsed.file.path = rel
        parsed.file.unsavedNew = false
        xlsxSessions[parsed.file.sessionId] = parsed
        remember(rel, { bytes: bytes })
        notifySaved(rel, bytes.byteLength)
        return {
          canceled: false,
          file: await makeWorkbookFile(parsed),
          touchedEntries: [],
        }
      } catch (e) {
        console.error('[genoffice] spreadsheet save failed', e)
        return { canceled: false, error: String((e && e.message) || e) }
      }
    },
    exportPdf: async function (request) {
      // Use native plugin to render HTML to PDF (stub)
      return UNSUPPORTED
    },
    exportCsv: async function (request) {
      // Write CSV to vfs (stub)
      return UNSUPPORTED
    },
    printWorkbook: async function (request) {
      // Use native plugin to print (stub)
      return { ok: false, error: 'Printing not supported on Android yet' }
    },
    listPrinters: async function () {
      return []
    },
  }

  // ---------- Docs (real .docx open/save) ----------

  var DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

  async function docxResultFromFile(file) {
    var bytes = new Uint8Array(await file.arrayBuffer())
    var blob = new Blob([bytes], { type: DOCX_MIME })
    var path = await uniquePath(documentPath(file.name))
    remember(path, { bytes: bytes, blob: blob, name: file.name })
    notifyShell('opened', { path: path, name: file.name, size: bytes.byteLength })
    return {
      path: path,
      name: file.name,
      // The renderer fetches this exactly once; a blob URL satisfies that.
      dataUrl: URL.createObjectURL(blob),
      hash: await sha256(bytes),
    }
  }

  // Add font support stub - try to load custom fonts
  function addFontSupport() {
    try {
      // Add a way to load custom fonts
      if (typeof document !== 'undefined') {
        // Create a simple font loader
        window.__genofficeAddFont = function(fontName, fontData) {
          try {
            var fontFace = new FontFace(fontName, fontData)
            document.fonts.add(fontFace)
            return fontFace.load()
          } catch (e) {
            console.error('addFont error:', e)
            return Promise.reject(e)
          }
        }
      }
    } catch (e) {}
  }
  addFontSupport()

  // ---------- crash-recovery copies (Docs) ----------
  var ZEN_REC_DB = 'zen-recovery'
  var ZEN_REC_STORE = 'docs'
  var zenRecClearedAt = {}
  function zenRecDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(ZEN_REC_DB, 1)
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(ZEN_REC_STORE)) {
          req.result.createObjectStore(ZEN_REC_STORE, { keyPath: 'path' })
        }
      }
      req.onsuccess = function () {
        resolve(req.result)
      }
      req.onerror = function () {
        reject(req.error)
      }
    })
  }
  function zenRecRun(mode, fn) {
    return zenRecDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(ZEN_REC_STORE, mode)
        var req = fn(tx.objectStore(ZEN_REC_STORE))
        tx.oncomplete = function () {
          db.close()
          resolve(req ? req.result : undefined)
        }
        tx.onerror = tx.onabort = function () {
          db.close()
          reject(tx.error)
        }
      })
    })
  }
  var zenRecovery = {
    put: function (path, bytes) {
      return zenRecRun('readwrite', function (s) {
        return s.put({ path: path, bytes: bytes, at: Date.now() })
      })
    },
    get: function (path) {
      return zenRecRun('readonly', function (s) {
        return s.get(path)
      })
    },
    clear: function (path) {
      zenRecClearedAt[path] = Date.now()
      return zenRecRun('readwrite', function (s) {
        return s.delete(path)
      })
    },
  }
  window.__zenRecovery = zenRecovery
  function zenRecoveryClear(path) {
    if (!path) return
    zenRecovery.clear(path).catch(function () {})
  }

  function zenRecoveryTime(ms) {
    var opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    var when = new Date(ms || Date.now())
    try {
      var loc = 'en'
      try {
        loc = language() || 'en'
      } catch (e) {}
      return when.toLocaleString(loc, opts)
    } catch (e) {
      try {
        return when.toLocaleString(undefined, opts)
      } catch (e2) {
        return ''
      }
    }
  }

  function zenRecoveryAsk(name, savedAt) {
    return new Promise(function (resolve) {
      var dark = false
      try {
        dark = shellTheme() === 'dark'
      } catch (e) {}
      var T = dark
        ? { surface: '#1e1e1e', subtle: '#2a2a2a', border: '#3a3a3a', strong: '#4a4a4a', text: '#e4e4e4', text2: '#a0a0a0', text3: '#a0a0a0', accent: '#6fcf97', soft: 'rgba(33,115,70,.32)', btnBorder: '#3a3a3a', btnBg: '#2a2a2a', btnText: '#e4e4e4', pBg: '#e4e4e4', pText: '#1e1e1e', shadow: '0 3px 30px rgba(0,0,0,.4)' }
        : { surface: '#ffffff', subtle: '#f6f7f9', border: '#e3e6ea', strong: '#d7dbe0', text: '#242424', text2: '#606366', text3: '#909499', accent: '#185c37', soft: '#e9f3ed', btnBorder: '#eaeaea', btnBg: '#f5f5f5', btnText: '#232425', pBg: '#232425', pText: '#ffffff', shadow: '0 3px 30px rgba(0,0,0,.08)' }
      function el(tag, css, text) {
        var n = document.createElement(tag)
        if (css) n.style.cssText = css
        if (text != null) n.textContent = text
        return n
      }
      var wrap = el('div', 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.5);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);font-family:system-ui,-apple-system,Roboto,sans-serif')
      wrap.setAttribute('role', 'dialog')
      wrap.setAttribute('aria-modal', 'true')
      var card = el('div', 'box-sizing:border-box;display:grid;gap:10px;width:min(480px,calc(100vw - 32px));max-width:100%;padding:14px;overflow:hidden;border:1px solid ' + T.strong + ';border-radius:16px;background:' + T.surface + ';color:' + T.text + ';box-shadow:' + T.shadow)
      var head = el('div', 'display:flex;align-items:center;gap:10px;min-width:0')
      var icon = el('span', 'display:grid;flex:none;place-items:center;width:34px;height:34px;border-radius:50%;color:' + T.accent + ';background:' + T.soft)
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 2.6-6.3" stroke-linecap="round"/><path d="M3 4.5V9h4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7.5V12l3.5 2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      head.appendChild(icon)
      head.appendChild(el('h2', 'margin:0;min-width:0;font-size:14px;font-weight:600', 'Recovered version found'))
      var desc = el('p', 'margin:0;overflow-wrap:anywhere;color:' + T.text2 + ';font-size:12px;line-height:1.5', 'Unsaved changes from the last session were found for ' + name + '. Restore the recovered version? Your original file is not changed until you save.')
      var row = el('div', 'display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0;padding:8px 10px;border:1px solid ' + T.border + ';border-radius:8px;background:' + T.subtle + ';font-size:12px')
      row.appendChild(el('span', 'flex:1;min-width:0;overflow:hidden;color:' + T.text + ';font-weight:600;white-space:nowrap;text-overflow:ellipsis', name))
      row.appendChild(el('span', 'flex:none;color:' + T.text3 + ';font-size:11px', zenRecoveryTime(savedAt)))
      var actions = el('div', 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px')
      function mk(label, primary, value) {
        var b = el('button', 'display:inline-flex;align-items:center;justify-content:center;height:32px;min-height:32px;padding:0 14px;border-radius:12px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;border:1px solid ' + (primary ? T.pBg : T.btnBorder) + ';background:' + (primary ? T.pBg : T.btnBg) + ';color:' + (primary ? T.pText : T.btnText), label)
        b.type = 'button'
        b.addEventListener('click', function () {
          wrap.remove()
          resolve(value)
        })
        return b
      }
      actions.appendChild(mk('Discard', false, false))
      actions.appendChild(mk('Restore', true, true))
      card.appendChild(head)
      card.appendChild(desc)
      card.appendChild(row)
      card.appendChild(actions)
      wrap.appendChild(card)
      document.body.appendChild(wrap)
    })
  }

  async function zenTextRecoveryOffer(path) {
    try {
      var key = 'text:' + path
      var rec = await zenRecovery.get(key)
      if (!rec || !rec.bytes) return null
      var recText = textOf(new Uint8Array(rec.bytes))
      var diskText = await textFor(path)
      if (recText === diskText) {
        zenRecoveryClear(key)
        return null
      }
      var restore = await zenRecoveryAsk(baseName(path), rec.at)
      if (!restore) {
        zenRecoveryClear(key)
        return null
      }
      return recText
    } catch (e) {
      return null
    }
  }

  async function zenRecoveryOffer(res) {
    if (!res || !res.path) return res
    try {
      var rec = await zenRecovery.get(res.path)
      if (!rec || !rec.bytes) return res
      var bytes = new Uint8Array(rec.bytes)
      if ((await sha256(bytes)) === res.hash) {
        zenRecoveryClear(res.path)
        return res
      }
      var restore = await zenRecoveryAsk(res.name || baseName(res.path), rec.at)
      if (!restore) {
        zenRecoveryClear(res.path)
        return res
      }
      var blob = new Blob([bytes], { type: DOCX_MIME })
      var url = URL.createObjectURL(blob)
      try {
        URL.revokeObjectURL(res.dataUrl)
      } catch (e) {}
      return Object.assign({}, res, { dataUrl: url, recovered: true })
    } catch (e) {
      return res
    }
  }

  var docs = {
    // File > Print: Android system print dialog (printers, copies, Save as PDF) via PrintManager
    print: async function (scale, job) {
      var preview = document.querySelector('.pagination-preview')
      var first = preview && preview.querySelector('.pv-page:not(.pv-print-skip)')
      var widthIn = first && first.offsetWidth > 0 ? Math.round((first.offsetWidth / 96) * 100) / 100 : 8.27
      var heightIn = first && first.offsetHeight > 0 ? Math.round((first.offsetHeight / 96) * 100) / 100 : 11.69
      var zoom = preview ? preview.style.getPropertyValue('--pv-print-zoom') : ''
      try {
        // native WebView lays out at CSS px and ignores the desktop print scale: drop the print zoom
        if (preview && zoom) preview.style.removeProperty('--pv-print-zoom')
        var html = await buildDocsPrintHtml(widthIn, heightIn)
        var r = await nativePrint({
          method: 'printSystem',
          html: html,
          baseUrl: location.href,
          jobName: (document.title || 'ZenOffice').slice(0, 60),
          widthIn: widthIn,
          heightIn: heightIn,
          duplex: job && job.duplex ? job.duplex : 'simplex',
          monochrome: !!(job && job.monochrome),
        })
        if (r && r.canceled) return { ok: false }
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      } finally {
        if (preview && zoom) preview.style.setProperty('--pv-print-zoom', zoom)
      }
    },
    listPrinters: async function () {
      return []
    },
    writeRecoveryCopy: async function (path, data) {
      try {
        if (!path) return { ok: false }
        if (Date.now() - (zenRecClearedAt[path] || 0) < 4000) return { ok: true }
        await zenRecovery.put(path, new Uint8Array(bytesOf(data)))
        return { ok: true }
      } catch (e) {
        return { ok: false }
      }
    },
    consumePendingOpenDocx: async function () {
      return zenRecoveryOffer(await docs.consumePendingOpenDocxBase())
    },
    consumePendingOpenDocxBase: async function () {
      var pending = await rememberPending('docs')
      if (!pending) return null
      var bytes = await bytesFor(pending.path)
      var blob = new Blob([bytes], { type: DOCX_MIME })
      if (memoryFiles[pending.path]) memoryFiles[pending.path].blob = blob
      return {
        path: pending.path,
        name: pending.record.name,
        dataUrl: URL.createObjectURL(blob),
        hash: await sha256(bytes),
      }
    },
    openDocx: async function () {
      var file = await pickFile('.docx,' + DOCX_MIME)
      return file ? docxResultFromFile(file) : null
    },
    openDocxPath: async function (path) {
      return zenRecoveryOffer(await docs.openDocxPathBase(path))
    },
    openDocxPathBase: async function (path) {
      var key = documentPath(path)
      if (!memoryFiles[key]) {
        try {
          await bytesFor(key)
        } catch (e) {
          return null
        }
      }
      var bytes = await bytesFor(key)
      var blob = new Blob([bytes], { type: DOCX_MIME })
      return {
        path: key,
        name: baseName(key),
        dataUrl: URL.createObjectURL(blob),
        hash: await sha256(bytes),
      }
    },
    saveDocx: async function (path, data) {
      try {
        var copy = new Uint8Array(bytesOf(data))
        var rel = await writeDocument(path, copy)
        zenRecoveryClear(path)
        zenRecoveryClear(rel)
        remember(rel, { bytes: copy })
        notifySaved(rel, copy.byteLength)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    saveDocxAs: async function (defaultName, data) {
      try {
        var name = withExtension(safeName(defaultName || 'Untitled.docx'), '.docx')
        var asked = askName(name)
        if (!asked) return { ok: true, canceled: true }
        var copy = new Uint8Array(bytesOf(data))
        var rel = await writeDocument(withExtension(asked, '.docx'), copy, { unique: true })
        remember(rel, { bytes: copy })
        notifySaved(rel, copy.byteLength)
        return { ok: true, path: rel }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    saveDocxNew: async function (defaultName, data) {
      try {
        var name = withExtension(safeName(defaultName || 'Untitled.docx'), '.docx')
        var copy = new Uint8Array(bytesOf(data))
        var rel = await writeDocument(name, copy, { unique: true })
        remember(rel, { bytes: copy })
        notifySaved(rel, copy.byteLength)
        return { ok: true, path: rel }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    getRecentFiles: async function () {
      return []
    },
    reportCloseCheck: function (state) {
      notifyShell('close-state', {
        dirty: !!(state && state.dirty),
        autoSave: !!(state && state.autoSave),
        path: (state && state.filePath) || '',
      })
    },
    pickImage: async function () {
      var file = await pickFile('image/png,image/jpeg,image/gif')
      if (!file) return null
      var bytes = new Uint8Array(await file.arrayBuffer())
      return { base64: toBase64(bytes), mime: file.type, name: file.name }
    },
    exportPdf: async function (a, wTwips, hTwips, outPath) {
      // Renderer calls (fileName, widthTwips, heightTwips, outPath, scale, links).
      var fileName = typeof a === 'string' ? a : (a && a.defaultName) || 'Document.docx'
      var widthIn = (Number(wTwips) || 11906) / 1440
      var heightIn = (Number(hTwips) || 16838) / 1440
      try {
        var printed = await printDocsPreview(widthIn, heightIn)
        var bytes = fromBase64(printed.base64)
        var hasOut = typeof outPath === 'string' && outPath.length > 0
        var target = hasOut
          ? outPath
          : withExtension(safeName(fileName.replace(/\.docx$/i, '')), '.pdf')
        var rel = await writeDocument(target, bytes, hasOut ? undefined : { unique: true })
        if (!hasOut) openExportedInShell(rel)
        return { ok: true, path: rel }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    exportHtml: async function (a, b) {
      // Renderer calls (fileName, html, outPath); also accept {defaultName, html}.
      var obj = a && typeof a === 'object'
      var defaultName = obj ? a.defaultName : a
      var html = obj ? a.html : b
      if (typeof defaultName !== 'string' || typeof html !== 'string') return UNSUPPORTED
      var name = withExtension(safeName(defaultName.replace(/\.docx$/i, '')), '.html')
      try {
        var rel = await writeDocument(name, html, { unique: true })
        openExportedInShell(rel)
        return { ok: true, path: rel }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    exportMarkdown: async function (a, b, c) {
      // Renderer calls (fileName, markdown, images, outPath); also accept an object.
      var obj = a && typeof a === 'object'
      var defaultName = obj ? a.defaultName : a
      var markdown = obj ? a.markdown : b
      var images = obj ? a.images : c
      if (typeof defaultName !== 'string' || typeof markdown !== 'string') return UNSUPPORTED
      var name = withExtension(safeName(defaultName.replace(/\.docx$/i, '')), '.md')
      try {
        var rel = await writeDocument(name, markdown, { unique: true })
        openExportedInShell(rel)
        return { ok: true, path: rel, imagesDropped: Array.isArray(images) ? images.length : 0 }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
  }

  // Opens an exported file in a new shell tab (shell lives in the parent frame).
  function openExportedInShell(rel) {
    try {
      var ext = String(rel).split('.').pop().toLowerCase()
      var app = ext === 'html' || ext === 'htm' ? 'html' : ext === 'md' ? 'markdown' : ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docs' : ext === 'xlsx' ? 'sheets' : ext === 'pptx' ? 'slides' : null
      var shell = window.parent && window.parent !== window ? window.parent : null
      if (app && shell && typeof shell.__genofficeOpenTab === 'function') {
        shell.__genofficeOpenTab({ app: app, path: rel, name: String(rel).split('/').pop() })
      }
    } catch (e) {
      console.error(e)
    }
  }

  docs.addFont = async function(fontName, fontData) {
    try {
      if (typeof window !== 'undefined' && window.__genofficeAddFont) {
        await window.__genofficeAddFont(fontName, fontData)
        return { ok: true }
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
    return { ok: true }
  }

  // ---------- Markdown (real text open/save) ----------

  var markdownState = { path: null }

  var markdown = {
    writeRecoveryCopy: async function (text) {
      try {
        var p = markdownState.path
        if (!p || typeof text !== 'string') return { ok: false }
        var key = 'text:' + p
        if (Date.now() - (zenRecClearedAt[key] || 0) < 4000) return { ok: true }
        await zenRecovery.put(key, new TextEncoder().encode(text))
        return { ok: true }
      } catch (e) {
        return { ok: false }
      }
    },
    takeRecovered: async function (path) {
      return zenTextRecoveryOffer(documentPath(path))
    },
    consumePending: async function () {
      var pending = await rememberPending('markdown')
      if (!pending) return null
      markdownState.path = pending.path
      return pending.path
    },
    readFile: async function (path) {
      return textFor(path)
    },
    openSourcePath: async function (path) {
      // The renderer asks the main process to route a wiki/citation path. The
      // Android build only has access to files it opened itself.
      var key = documentPath(path)
      if (memoryFiles[key]) {
        markdownState.path = key
        return key
      }
      return null
    },
    save: async function (request) {
      try {
        var text = String((request && request.text) || '')
        var path = markdownState.path
        if (!path || (request && request.mode === 'saveAs')) {
          var suggested = request && (request.suggestedName || request.defaultName)
          var suggestion = suggested || baseName(path) || 'Untitled.md'
          var name = withExtension(safeName(suggestion), '.md')
          // Save As always asks. An untitled save/autosave lands silently in
          // Documents, matching the desktop first-save behaviour.
          if (request && request.mode === 'saveAs') {
            var asked = askName(name)
            if (!asked) return { ok: true, canceled: true }
            name = withExtension(asked, '.md')
          }
          path = await writeDocument(name, text, {
            unique: !path || (request && request.mode === 'saveAs'),
          })
        } else {
          path = await writeDocument(path, text)
        }
        markdownState.path = path
        remember(path, { text: text })
        zenRecoveryClear('text:' + path)
        notifySaved(path, new Blob([text]).size)
        return { ok: true, path: path, writtenText: text }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    setDirty: function (dirty) {
      notifyShell('dirty', { dirty: !!dirty })
    },
    reportCloseCheck: function (state) {
      notifyShell('close-state', { dirty: !!(state && state.dirty), autoSave: !!(state && state.autoSave) })
    },
    pickImage: async function () {
      var file = await pickFile('image/png,image/jpeg,image/gif')
      if (!file) return null
      var bytes = new Uint8Array(await file.arrayBuffer())
      var ext = (file.name.split('.').pop() || 'png').toLowerCase()
      var rel = await writeDocument(
        DIR + '/assets/' + Date.now() + '-' + safeName(baseName(file.name)),
        bytes,
      )
      remember(rel, { bytes: bytes })
      return rel
    },
    saveImage: async function (args) {
      var bytes = fromBase64(args && args.base64)
      var ext = String((args && args.ext) || 'png').replace(/^\./, '')
      var rel = await writeDocument(DIR + '/assets/' + Date.now() + '.' + ext, bytes)
      remember(rel, { bytes: bytes })
      return rel
    },
    readImage: async function (path) {
      var bytes = await bytesFor(path)
      return 'data:image/png;base64,' + toBase64(bytes)
    },
    saveImageAs: async function (args) {
      return markdown.saveImage(args)
    },
    getImageHost: async function () {
      return 'documents'
    },
    setImageHost: async function (host) {
      lsSet('markdown.imageHost', host)
      return host
    },
    getMarkdownTheme: async function () {
      return lsGet('markdown.theme', 'light')
    },
    setMarkdownTheme: async function (theme) {
      lsSet('markdown.theme', theme)
      return theme
    },
    listWikiNotes: async function () {
      return []
    },
    resolveWikiLinks: async function () {
      return []
    },
    wikiBacklinks: async function () {
      return []
    },
    wikiGraph: async function () {
      return { nodes: [], edges: [] }
    },
    rememberWikiFragment: noop,
    takeWikiFragment: async function () {
      return ''
    },
    createWikiNote: async function () {
      return UNSUPPORTED
    },
    consumeHeadlessExport: async function () {
      return null
    },
    headlessExportDone: noop,
    exportPdf: async function(request) { return UNSUPPORTED },
    exportDocx: async function(request) { return UNSUPPORTED },
    exportHtml: async function(request) { return UNSUPPORTED },
  }

  // ---------- HTML (real text open/save + in-WebView preview) ----------

  var htmlState = { path: null, preview: '' }

  function previewUrl() {
    return location.origin + '/shim/html-preview.html'
  }

  function pushPreview() {
    var frames = document.querySelectorAll('iframe')
    for (var i = 0; i < frames.length; i++) {
      try {
        frames[i].contentWindow.postMessage({ __genofficeAndroidPreviewContent: htmlState.preview }, '*')
      } catch (e) {
        /* cross-origin frame without a usable window; the request handshake retries */
      }
    }
  }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || !data.__genofficeAndroidPreviewRequest) return
    try {
      event.source.postMessage({ __genofficeAndroidPreviewContent: htmlState.preview }, '*')
    } catch (e) {
      /* ignore */
    }
  })

  var html = {
    writeRecoveryCopy: async function (text) {
      try {
        var p = htmlState.path
        if (!p || typeof text !== 'string') return { ok: false }
        var key = 'text:' + p
        if (Date.now() - (zenRecClearedAt[key] || 0) < 4000) return { ok: true }
        await zenRecovery.put(key, new TextEncoder().encode(text))
        return { ok: true }
      } catch (e) {
        return { ok: false }
      }
    },
    takeRecovered: async function (path) {
      return zenTextRecoveryOffer(documentPath(path))
    },
    consumePending: async function () {
      var pending = await rememberPending('html')
      if (!pending) return null
      htmlState.path = pending.path
      return pending.path
    },
    readFile: async function (path) {
      return textFor(path)
    },
    openSourcePath: async function (path) {
      var key = documentPath(path)
      if (memoryFiles[key]) {
        htmlState.path = key
        return key
      }
      return null
    },
    getPreviewInfo: async function () {
      return { url: previewUrl() }
    },
    updatePreview: function (text) {
      htmlState.preview = String(text == null ? '' : text)
      pushPreview()
    },
    presentInNewTab: async function () {
      return null
    },
    setPresentFullScreen: async function () {
      return null
    },
    save: async function (request) {
      try {
        var text = String((request && request.text) || '')
        var path = htmlState.path
        if (!path || (request && request.mode === 'saveAs')) {
          var suggested = request && (request.suggestedName || request.defaultName)
          var suggestion = suggested || baseName(path) || 'Untitled.html'
          var name = withExtension(safeName(suggestion), '.html')
          if (request && request.mode === 'saveAs') {
            var asked = askName(name)
            if (!asked) return { ok: true, canceled: true }
            name = withExtension(asked, '.html')
          }
          path = await writeDocument(name, text, {
            unique: !path || (request && request.mode === 'saveAs'),
          })
        } else {
          path = await writeDocument(path, text)
        }
        htmlState.path = path
        remember(path, { text: text })
        zenRecoveryClear('text:' + path)
        notifySaved(path, new Blob([text]).size)
        return { ok: true, path: path }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    setDirty: function (dirty) {
      notifyShell('dirty', { dirty: !!dirty })
    },
    reportCloseCheck: function (state) {
      notifyShell('close-state', { dirty: !!(state && state.dirty), autoSave: !!(state && state.autoSave) })
    },
    onCloseSaveRequest: unsubscribe,
    pickImage: async function () {
      var file = await pickFile('image/png,image/jpeg,image/gif')
      if (!file) return null
      var bytes = new Uint8Array(await file.arrayBuffer())
      var rel = await writeDocument(
        DIR + '/assets/' + Date.now() + '-' + safeName(baseName(file.name)),
        bytes,
      )
      remember(rel, { bytes: bytes })
      return rel
    },
    saveImage: async function (args) {
      var bytes = fromBase64(args && args.base64)
      var ext = String((args && args.ext) || 'png').replace(/^\./, '')
      var rel = await writeDocument(DIR + '/assets/' + Date.now() + '.' + ext, bytes)
      remember(rel, { bytes: bytes })
      return rel
    },
    readImage: async function (path) {
      var bytes = await bytesFor(path)
      return { base64: toBase64(bytes), mime: 'image/png' }
    },
    saveImageAs: async function (args) {
      return html.saveImage(args)
    },
    resolveImage: async function (path) {
      return path
    },
    consumeHeadlessExport: async function () {
      return null
    },
    headlessExportDone: noop,
    exportPdf: async function(request) { return UNSUPPORTED },
    exportHtml: async function(request) { return UNSUPPORTED },
    exportDocx: async function(request) { return UNSUPPORTED },
  }

  // ---------- PDF (pdf-lib host; PDFium-only text/redaction stays desktop) ----------

  function pdfTools() {
    var tools = window.__genofficePdfTools
    if (!tools) throw new Error('Bundel PDF Android tidak termuat')
    return tools
  }

  function toolBytes(value) {
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    if (value && value.bytes) return toolBytes(value.bytes)
    throw new Error('PDF tool tidak mengembalikan data')
  }

  async function putPdf(rel, bytes) {
    var key = documentPath(rel)
    await writeDocument(key, bytes)
    remember(key, { bytes: bytes })
    notifySaved(key, bytes.byteLength)
    return key
  }

  async function putGeneratedPdf(name, bytes) {
    var rel = await uniquePath(documentPath(name || 'Untitled.pdf'))
    return putPdf(rel, bytes)
  }

  var pdf = {
    consumePending: async function () {
      var pending = await rememberPending('pdf')
      return pending ? pending.path : null
    },
    readFile: async function (path) {
      var bytes = await bytesFor(path)
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
    isUntitled: async function () {
      return false
    },
    getUsername: async function () {
      return lsGet('author', 'Android user')
    },
    autoRename: async function () {
      return { renamed: false }
    },
    listStaticFormFills: async function (path) {
      try {
        var fills = await pdfTools().readStaticFormFills(await bytesFor(path))
        return Array.isArray(fills) ? fills : []
      } catch (e) {
        return []
      }
    },
    listDigitalSignatures: async function () {
      return []
    },
    listSavedSignatures: async function () {
      return []
    },
    validateTextEdits: async function (request) {
      var edits = (request && request.edits) || []
      return edits.map(function () {
        return { reason: 'Editing teks langsung membutuhkan PDFium dan belum tersedia di Android' }
      })
    },
    listEditFonts: async function () {
      return []
    },
    canDrawText: async function () {
      return false
    },
    listPageImages: async function () {
      return []
    },
    setDirty: function (dirty) {
      notifyShell('dirty', { dirty: !!dirty })
    },
    save: async function (request) {
      try {
        if (!request || typeof request.path !== 'string') {
          return { ok: false, error: 'PDF path tidak valid' }
        }
        if (request.redactions && request.redactions.length) {
          return {
            ok: false,
            error: 'Redaksi permanen membutuhkan PDFium dan belum tersedia di Android. Simpan salinan biasa terlebih dahulu.',
          }
        }
        var source = request.path
        var target = typeof request.targetPath === 'string' ? request.targetPath : source
        var body = Object.assign(
          {
            markups: [],
            drawings: [],
            formValues: [],
            stamps: [],
          },
          request,
        )
        delete body.path
        delete body.targetPath
        var result = await pdfTools().applySaveRequest(await bytesFor(source), body)
        var saved = toolBytes(result)
        var skippedTextEdits = result && result.skippedTextEdits ? result.skippedTextEdits : []
        var skippedTextInserts = result && result.skippedTextInserts ? result.skippedTextInserts : []
        var skippedImageEdits = result && result.skippedImageEdits ? result.skippedImageEdits : []
        var path = await putPdf(target, saved)
        return {
          ok: true,
          path: path,
          skippedTextEdits: skippedTextEdits,
          skippedTextInserts: skippedTextInserts,
          skippedImageEdits: skippedImageEdits,
        }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    extractPages: async function (request) {
      try {
        var pages = (request && request.pages) || []
        var bytes = await pdfTools().extractPagesBytes(await bytesFor(request.path), pages)
        var path = await putGeneratedPdf(request.suggestedName || 'pages.pdf', bytes)
        return { ok: true, savedPath: path }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    insertPdf: async function (request) {
      try {
        var file = await pickFile('application/pdf,.pdf')
        if (!file) return { ok: true, canceled: true }
        var other = new Uint8Array(await file.arrayBuffer())
        var applied = await pdfTools().insertPdfBytes(
          await bytesFor(request.path),
          other,
          typeof request.afterPageIndex === 'number' ? request.afterPageIndex : -1,
        )
        await putPdf(request.path, toolBytes(applied.merged))
        return { ok: true, insertedCount: applied.count }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    insertBlankPage: async function (request) {
      try {
        var bytes = await pdfTools().insertBlankPageBytes(
          await bytesFor(request.path),
          typeof request.afterPageIndex === 'number' ? request.afterPageIndex : -1,
        )
        await putPdf(request.path, toolBytes(bytes))
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    splitPdf: async function (request) {
      try {
        var parts = await pdfTools().splitPdfBytes(
          await bytesFor(request.path),
          typeof request.chunkSize === 'number' ? request.chunkSize : 1,
        )
        var base = safeName(String(request.baseName || 'split')).replace(/\.pdf$/i, '') || 'split'
        for (var i = 0; i < parts.length; i++) {
          await putGeneratedPdf(base + '-' + (i + 1) + '.pdf', toolBytes(parts[i]))
        }
        return { ok: true, savedDir: DIR, count: parts.length }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    mergePdf: async function (request) {
      try {
        var files = await pickFiles('application/pdf,.pdf', true)
        if (!files || files.length === 0) return { ok: true, canceled: true }
        var others = []
        for (var i = 0; i < files.length; i++) {
          others.push(new Uint8Array(await files[i].arrayBuffer()))
        }
        var merged = await pdfTools().mergePdfBytes(await bytesFor(request.path), others)
        var path = await putGeneratedPdf(request.suggestedName || 'merged.pdf', toolBytes(merged.merged))
        return { ok: true, savedPath: path, appendedCount: merged.appended }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    mergePages: async function (request) {
      try {
        var bytes = await pdfTools().mergePagesBytes(await bytesFor(request.path), {
          perSheet: request.perSheet,
          direction: request.direction === 'horizontal' ? 'horizontal' : 'vertical',
          separator: request.separator === true,
        })
        var path = await putGeneratedPdf(request.suggestedName || 'merged-pages.pdf', toolBytes(bytes))
        return { ok: true, savedPath: path }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    replacePages: async function (request) {
      try {
        var file = await pickFile('application/pdf,.pdf')
        if (!file) return { ok: true, canceled: true }
        var applied = await pdfTools().replacePagesBytes(
          await bytesFor(request.path),
          new Uint8Array(await file.arrayBuffer()),
          (request && request.pages) || [],
        )
        await putPdf(request.path, toolBytes(applied.merged))
        return { ok: true, removed: applied.removed, inserted: applied.inserted }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    setPageSize: async function (request) {
      try {
        var bytes = await pdfTools().setPageSizeBytes(
          await bytesFor(request.path),
          Number(request.width),
          Number(request.height),
        )
        await putPdf(request.path, toolBytes(bytes))
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    splitPages: async function (request) {
      try {
        var bytes = await pdfTools().splitPagesBytes(
          await bytesFor(request.path),
          request.perPage,
        )
        var path = await putGeneratedPdf(request.suggestedName || 'split-pages.pdf', toolBytes(bytes))
        return { ok: true, savedPath: path }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    cropPages: async function (request) {
      try {
        var bytes = await pdfTools().cropPagesBytes(
          await bytesFor(request.path),
          (request && request.pages) || [],
          request && request.rect,
        )
        await putPdf(request.path, toolBytes(bytes))
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    exportImages: async function (request) {
      try {
        var images = (request && request.images) || []
        var numbers = (request && request.pageNumbers) || []
        var base = safeName(String(request.baseName || 'page')).replace(/\.[a-z0-9]+$/i, '') || 'page'
        var dir = DIR
        for (var i = 0; i < images.length; i++) {
          var num = Number(numbers[i] || i + 1)
          var name = base + '-page-' + String(num).padStart(2, '0') + '.png'
          await putGeneratedPdf(name, fromBase64(images[i]))
        }
        return { ok: true, savedDir: dir, count: images.length }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    requestRedactionCopy: async function () {
      return null
    },
    dirtyChanged: function (dirty) {
      notifyShell('dirty', { dirty: !!dirty })
    },
    reportCloseCheck: function (state) {
      notifyShell('close-state', { dirty: !!(state && state.dirty), autoSave: !!(state && state.autoSave) })
    },
    onCloseSaveRequest: unsubscribe,
    reportCloseSaveResult: noop,
    onSaveRequest: unsubscribe,
    onSaveAsFlow: unsubscribe,
    onSaveAsRequest: unsubscribe,
    consumeHeadlessExport: async function () {
      return null
    },
    headlessExportDone: noop,
    convertOffice: async function (format, payload) {
      try {
        var data = payload && Array.isArray(payload.pages) ? payload : null
        if (!data) return { ok: false, error: 'No text could be read from the PDF' }
        convertPayload = data
        var baseName = safeName(String(data.name || 'document').replace(/\.pdf$/i, '')) || 'document'
        var outputBytes
        var outputExt
        if (format === 'docx') {
          outputExt = 'docx'
          outputBytes = await createDocxFromPdf()
        } else if (format === 'xlsx') {
          outputExt = 'xlsx'
          outputBytes = createXlsxFromPdf()
        } else if (format === 'pptx') {
          outputExt = 'pptx'
          outputBytes = await createPptxFromPdf()
        } else if (format === 'md') {
          outputExt = 'md'
          outputBytes = createMdFromPdf()
        } else if (format === 'html') {
          outputExt = 'html'
          outputBytes = createHtmlFromPdf()
        } else {
          return { ok: false, error: 'Unsupported format: ' + format }
        }
        var rel = await writeDocument(baseName + '.' + outputExt, outputBytes, { unique: true })
        notifySaved(rel, outputBytes.byteLength)
        openExportedInShell(rel)
        return { ok: true, path: rel }
      } catch (e) {
        console.error('[pdf] convertOffice failed:', e)
        return { ok: false, error: String((e && e.message) || e) }
      } finally {
        convertPayload = null
      }
    },
  }

  // PDF Conversion Helpers
  // The PDF app extracts the text (pdf.js) and passes it in; these only build the files.
  var convertPayload = null
  var CV_NO_TEXT = '[No selectable text on this page (scanned image?)]'

  function cvEsc(s) {
    return String(s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  function cvParas(pg) {
    if (pg.paragraphs && pg.paragraphs.length) return pg.paragraphs
    return pg.noText ? [{ t: CV_NO_TEXT, rtl: false }] : []
  }

  function createDocxFromPdf() {
    return createZip(createDocxXml())
  }

  function createDocxXml() {
    var d = convertPayload
    var w = d.pageSize ? Math.round(d.pageSize[0] * 20) : 11906
    var h = d.pageSize ? Math.round(d.pageSize[1] * 20) : 16838
    var body = ''
    d.pages.forEach(function (pg, pi) {
      var paras = cvParas(pg)
      if (!paras.length) paras = [{ t: '', rtl: false }] // an empty page still keeps its page break
      paras.forEach(function (p, i) {
        var ppr = ''
        if (i === 0 && pi > 0) ppr += '<w:pageBreakBefore/>'
        if (p.rtl) ppr += '<w:bidi/>'
        body +=
          '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + '<w:r>' +
          (p.rtl ? '<w:rPr><w:rtl/></w:rPr>' : '') +
          '<w:t xml:space="preserve">' + cvEsc(p.t) + '</w:t></w:r></w:p>'
      })
    })
    var head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    return {
      '[Content_Types].xml':
        head +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
      '_rels/.rels':
        head +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
      'word/_rels/document.xml.rels':
        head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
      'word/document.xml':
        head +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        body +
        '<w:sectPr><w:pgSz w:w="' + w + '" w:h="' + h + '"/>' +
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>' +
        '</w:body></w:document>',
    }
  }

  function createXlsxFromPdf() {
    if (!window.XLSX) throw new Error('SheetJS not available')
    var rows = [['Page', 'Text']]
    convertPayload.pages.forEach(function (pg, i) {
      cvParas(pg).forEach(function (p) {
        rows.push([i + 1, String(p.t).slice(0, 32000)])
      })
    })
    var wb = window.XLSX.utils.book_new()
    var ws = window.XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 7 }, { wch: 110 }]
    window.XLSX.utils.book_append_sheet(wb, ws, 'PDF Text')
    return new Uint8Array(window.XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }))
  }

  function createPptxFromPdf() {
    return createZip(createPptxXml(convertPayload.pages.length, convertPayload.name))
  }

  function cvMdEsc(t) {
    return String(t)
      .replace(/([\\`*_{}\[\]<>])/g, '\\$1')
      .replace(/^(\s*)([#>+-]|\d+[.)])(\s)/, '$1\\$2$3')
  }

  function createMdFromPdf() {
    var out = []
    convertPayload.pages.forEach(function (pg, i) {
      if (i > 0) out.push('---', '')
      cvParas(pg).forEach(function (p) {
        out.push(cvMdEsc(p.t), '')
      })
    })
    return new TextEncoder().encode(out.join('\n'))
  }

  function createHtmlFromPdf() {
    var d = convertPayload
    var html =
      '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>' + cvEsc(d.name || 'document') + '</title>\n' +
      '<style>body{font-family:sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6}' +
      '.page{padding:1rem 0;border-top:1px solid #ccc}.page:first-of-type{border-top:0}' +
      'p[dir=rtl]{text-align:right}</style>\n</head>\n<body>'
    d.pages.forEach(function (pg) {
      html += '\n<section class="page">'
      cvParas(pg).forEach(function (p) {
        html += '\n<p' + (p.rtl ? ' dir="rtl"' : '') + '>' + cvEsc(p.t) + '</p>'
      })
      html += '\n</section>'
    })
    html += '\n</body>\n</html>\n'
    return new TextEncoder().encode(html)
  }

  function cvSlideXml(pi, presXml) {
    var m = /<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(presXml || '')
    var sw = m ? +m[1] : 9144000
    var sh = m ? +m[2] : 6858000
    var paras = cvParas(convertPayload.pages[pi])
    var chars = paras.reduce(function (n, p) { return n + String(p.t).length }, 0)
    var sz = chars > 2400 ? 800 : chars > 1500 ? 1000 : chars > 800 ? 1200 : chars > 400 ? 1400 : 1800
    var margin = 457200
    var cx = Math.max(914400, sw - 2 * margin)
    var cy = Math.max(914400, sh - 2 * margin)
    var ps = paras
      .map(function (p) {
        return (
          '<a:p><a:pPr' + (p.rtl ? ' algn="r" rtl="1"' : '') + '/><a:r><a:rPr lang="en-US" sz="' + sz + '"/>' +
          '<a:t>' + cvEsc(p.t) + '</a:t></a:r></a:p>'
        )
      })
      .join('')
    if (!ps) ps = '<a:p><a:endParaRPr lang="en-US"/></a:p>'
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>' +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="' + margin + '" y="' + margin + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
      '<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>' + ps + '</p:txBody></p:sp>' +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
    )
  }

  function createPptxXml(pageCount, baseName) {
    var contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n<Default Extension="xml" ContentType="application/xml"/>\n<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>\n<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>\n<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>\n<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>\n<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>\n</Types>'

    var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>\n</Relationships>'

    var pptRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>\n<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>\n</Relationships>'

    var slideIdList = ''
    for (var i = 1; i <= pageCount; i++) {
      slideIdList += '<p:sldId id="' + (256 + i) + '" r:id="rId' + i + '"/>'
    }
    var presentationXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n<p:sldIdLst>' + slideIdList + '</p:sldIdLst>\n<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>\n<p:defaultTextStyle/>\n</p:presentation>'

    var slideMasterXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n<p:cSld><p:spTree/></p:cSld>\n<p:clrMapOvr><a:masterClrMapping/></a:clrMapOvr>\n</p:sldMaster>'

    var slideLayoutXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="blank" preserve="1">\n<p:cSld><p:spTree/></p:cSld>\n</p:sldLayout>'

    var themeXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">\n<a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="548235"/></a:accent2><a:accent3><a:srgbClr val="C00000"/></a:accent3><a:accent4><a:srgbClr val="7030A0"/></a:accent4><a:accent5><a:srgbClr val="2E75B6"/></a:accent5><a:accent6><a:srgbClr val="ED7D31"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light" panose="020F0302020204030204"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri" panose="020F0502020204030204"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"/></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'

    var slides = {}
    for (var i = 1; i <= pageCount; i++) {
      var slidePath = 'ppt/slides/slide' + i + '.xml'
      var slideRelsPath = 'ppt/slides/_rels/slide' + i + '.xml.rels'
      var slideXml = cvSlideXml(i - 1, presentationXml)
      var slideRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>\n<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>\n</Relationships>'
      slides[slidePath] = slideXml
      slides[slideRelsPath] = slideRelsXml
    }

    var result = {}
    result['[Content_Types].xml'] = contentTypesXml
    result['_rels/.rels'] = relsXml
    result['ppt/_rels/presentation.xml.rels'] = pptRelsXml
    result['ppt/presentation.xml'] = presentationXml
    result['ppt/slideMasters/slideMaster1.xml'] = slideMasterXml
    result['ppt/slideLayouts/slideLayout1.xml'] = slideLayoutXml
    result['ppt/theme/theme1.xml'] = themeXml
    Object.assign(result, slides)
    return result
  }

  function createZipFromDocxXml(files) {
    return createZip(files)
  }

  function createZipFromPptxXml(files) {
    return createZip(files)
  }

  function createZip(files) {
    var zip = new window.JSZip()
    for (var path in files) {
      zip.file(path, files[path])
    }
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  }

  // ---------- Slides (real browser host) ----------
  //
  sheets.addFont = async function(fontName, fontData) {
    try {
      if (typeof window !== 'undefined' && window.__genofficeAddFont) {
        await window.__genofficeAddFont(fontName, fontData)
        return { ok: true }
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
    return { ok: true }
  }

  // slides-host.js loads the desktop Slides main process and preload bridge,
  // with Electron/Node shims. It exposes the exact window.slidesApi the UI
  // expects; this block only connects its virtual filesystem to Capacitor and
  // keeps the shell's tab path/recents in sync.

  var slidesHost = window.__genofficeSlidesHost
  var slidesBaseApi = window.slidesApi
  var slidesPrimed = false
  var slidesPrimePromise = null

  function slidelike(name) {
    return /\.(pptx|pptm|ppsx|potx|potm|odp|ppt)$/i.test(String(name || ''))
  }

  function acceptFromDialog(options) {
    var exts = []
    try {
      ;(options && options.filters ? options.filters : []).forEach(function (f) {
        ;(f.extensions || []).forEach(function (ext) {
          var e = String(ext || '').replace(/^\./, '')
          if (e && exts.indexOf(e) < 0) exts.push(e)
        })
      })
    } catch (e) {
      /* a filter shape we do not understand: show every file */
    }
    return exts.length
      ? exts.map(function (e) { return '.' + e }).join(',')
      : '*/*'
  }

  async function seedSlidesVfs() {
    if (!slidesHost) return
    try {
      var fs = filesystem()
      var listing = await fs.readdir({ path: DIR, directory: 'DOCUMENTS' })
      ;(listing && listing.files ? listing.files : []).forEach(function (name) {
        if (typeof name !== 'string' || !slidelike(name)) return
        var rel = DIR + '/' + name
        if (!slidesHost.hasFile(rel)) slidesHost.writeFile(rel, new Uint8Array())
      })
    } catch (e) {
      /* an empty/unavailable Documents folder is fine */
    }
  }

  async function primeSlides(fitWidth) {
    if (!slidesHost) return
    if (slidesPrimed) return
    if (slidesPrimePromise) return slidesPrimePromise
    slidesPrimePromise = (async function () {
      await seedSlidesVfs()
      var pending = await rememberPending('slides')
      if (pending) {
        var bytes = await bytesFor(pending.path)
        await slidesHost.openBytes(pending.path, bytes, Number(fitWidth) || 960)
      }
      slidesPrimed = true
    })()
    try {
      await slidesPrimePromise
    } catch (e) {
      slidesPrimePromise = null
      throw e
    }
  }

  async function persistSlideSave(result) {
    if (!result || !result.ok || !result.path) return result
    try {
      var bytes = slidesHost.readFile(result.path)
      await slidesAdapter.flush(result.path, bytes)
      notifySaved(result.path, bytes.byteLength)
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
    return result
  }

  var slidesAdapter = {
    pickOpenPath: async function (options) {
      var file = await pickFile(acceptFromDialog(options))
      if (!file) return null
      var bytes = new Uint8Array(await file.arrayBuffer())
      var deck = slidelike(file.name)
      var path = deck
        ? await uniquePath(documentPath(file.name))
        : '.genoffice/imports/' + Date.now().toString(36) + '-' + safeName(file.name)
      slidesHost.writeFile(path, bytes)
      remember(path, { bytes: bytes, name: file.name })
      return path
    },
    pickFiles: async function (options) {
      var file = await pickFile(acceptFromDialog(options))
      if (!file) return []
      var bytes = new Uint8Array(await file.arrayBuffer())
      var path = '.genoffice/imports/' + Date.now().toString(36) + '-' + safeName(file.name)
      slidesHost.writeFile(path, bytes)
      remember(path, { bytes: bytes, name: file.name })
      return [path]
    },
    pickSavePath: async function (defaultName) {
      var name = baseName(defaultName || 'Untitled presentation.pptx')
      if (!/\.pptx$/i.test(name)) name = withExtension(name.replace(/\.(pptx|pptm|ppsx|potx|ppt)$/i, ''), '.pptx')
      var asked = askName(name)
      if (!asked) return null
      asked = withExtension(asked, '.pptx')
      return await uniquePath(documentPath(asked))
    },
    pickDirectory: async function () {
      return null
    },
    flush: async function (path, bytes) {
      var rel = documentPath(path)
      await writeDocument(rel, bytes)
      remember(rel, { bytes: bytes })
    },
    openExternal: function (url) {
      if (/^https?:/i.test(String(url || ''))) window.open(url, '_blank')
    },
  }

  if (slidesHost && slidesBaseApi) {
    slidesHost.setAdapter(slidesAdapter)
    var slidesWrapped = Object.assign({}, slidesBaseApi)

    // Keep the real Slides UI on the shell's appearance instead of the
    // hard-coded light fallback the Electron main process used to provide.
    slidesWrapped.getTheme = async function () {
      return shellTheme()
    }
    slidesWrapped.onThemeChanged = function (handler) {
      return subscribeShellTheme(handler)
    }

    slidesWrapped.consumePendingOpen = async function (fitWidth) {
      await primeSlides(fitWidth)
      return slidesBaseApi.consumePendingOpen(fitWidth)
    }

    slidesWrapped.openPptx = async function (fitWidth) {
      var file = await pickFile('.pptx,.pptm,.ppsx,.potx,.potm,.odp,.ppt')
      if (!file) return null
      var bytes = new Uint8Array(await file.arrayBuffer())
      var path = await uniquePath(documentPath(file.name))
      remember(path, { bytes: bytes, name: file.name })
      var result = await slidesHost.openBytes(path, bytes, Number(fitWidth) || 960)
      if (result) notifyShell('opened', { path: path, name: baseName(path), size: bytes.byteLength })
      return result
    }

    slidesWrapped.openPptxPath = async function (path, fitWidth) {
      var rel = documentPath(path)
      var bytes = await bytesFor(rel)
      var result = await slidesHost.openBytes(rel, bytes, Number(fitWidth) || 960)
      if (result) notifyShell('opened', { path: rel, name: baseName(rel), size: bytes.byteLength })
      return result
    }

    slidesWrapped.save = async function () {
      return persistSlideSave(await slidesBaseApi.save())
    }

    slidesWrapped.saveAs = async function (defaultName) {
      return persistSlideSave(await slidesBaseApi.saveAs(defaultName))
    }

    // Add Android stubs for slides export
    // zen-slides-pdf: HTML berhalaman (seperti pdf-export.ts desktop) -> native printHtml -> Documents/ZenOffice -> tab baru
    slidesWrapped.exportPdf = async function (request) {
      try {
        var req = request || {}
        var pages = req.pages || []
        if (!pages.length) return { ok: false, error: 'No slides to export' }
        var ratio = Number(req.widthPx) / Number(req.heightPx)
        if (!isFinite(ratio) || ratio <= 0) ratio = 16 / 9
        ratio = Math.min(Math.max(ratio, 0.2), 5)
        var heightIn = 7.5
        var widthIn = Math.round(ratio * heightIn * 1000) / 1000
        var attr = function (s) {
          return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        }
        var pct = function (v) {
          return isFinite(v) ? Math.round(v * 100000) / 1000 + '%' : null
        }
        var body = pages
          .map(function (page, i) {
            var markup = page.svg != null ? page.svg : '<img src="data:image/png;base64,' + page.png + '">'
            var ls = (req.links && req.links[i]) || []
            var anchors = ls
              .map(function (l) {
                var x = pct(l.x), y = pct(l.y), w = pct(l.w), hh = pct(l.h)
                if (x == null || y == null || w == null || hh == null || !l.href) return ''
                return '<a href="' + attr(l.href) + '" style="left:' + x + ';top:' + y + ';width:' + w + ';height:' + hh + '"></a>'
              })
              .join('')
            return '<div class="page" id="pg' + (i + 1) + '">' + markup + anchors + '</div>'
          })
          .join('')
        var css = String(req.fontCss || '').replace(/<\/style/gi, '')
        // zen-pdf-fonts: fontCss tanpa Carlito -> ambil file Carlito yang sudah dimuat editor
        if (!/carlito/i.test(css)) {
          try {
            var seenFace = {}
            var res = performance.getEntriesByType('resource')
            for (var ri = 0; ri < res.length; ri++) {
              var fm = /Carlito-(Regular|BoldItalic|Bold|Italic)-[^\/]*\.ttf/i.exec(res[ri].name)
              if (!fm) continue
              var fk = fm[1].toLowerCase()
              if (seenFace[fk]) continue
              seenFace[fk] = true
              var fr = await fetch(res[ri].name)
              if (!fr.ok) continue
              var fb64 = toBase64(new Uint8Array(await fr.arrayBuffer()))
              var fw = fk.indexOf('bold') >= 0 ? 700 : 400
              var fst = fk.indexOf('italic') >= 0 ? 'italic' : 'normal'
              ;['Carlito', 'Carlito GO'].forEach(function (fam) {
                css += '@font-face{font-family:"' + fam + '";src:url(data:font/ttf;base64,' + fb64 + ');font-weight:' + fw + ';font-style:' + fst + '}\n'
              })
            }
          } catch (fe) {
            /* lanjut dengan font yang ada */
          }
        }
        var html =
          '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '\n' +
          '@page{size:' + widthIn + 'in ' + heightIn + 'in;margin:0}' +
          'html,body{margin:0;padding:0}' +
          '.page{position:relative;width:' + widthIn + 'in;height:' + heightIn + 'in;overflow:hidden;page-break-after:always}' +
          '.page:last-child{page-break-after:auto}' +
          '.page img,.page>svg{display:block;width:100%;height:100%}' +
          '.page a{position:absolute;display:block}' +
          '</style></head><body>' + body + '</body></html>'
        var printed = await nativePrint({
          method: 'printHtml',
          html: html,
          baseUrl: location.href,
          widthIn: widthIn,
          heightIn: heightIn,
          delayMs: 2500,
        })
        var bytes = fromBase64(printed.base64)
        var name = withExtension(safeName(String(req.filePath || 'Slides.pdf').replace(/\.pdf$/i, '')), '.pdf')
        var rel = await writeDocument(name, bytes, { unique: true })
        openExportedInShell(rel)
        return { ok: true, path: rel }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
  slidesWrapped.addFont = async function(fontName, fontData) {
    try {
      if (typeof window !== 'undefined' && window.__genofficeAddFont) {
        await window.__genofficeAddFont(fontName, fontData)
        return { ok: true }
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
    return { ok: true }
  }
    slidesWrapped.exportImages = async function (request) {
      try {
        var pngs = (request && request.pngsBase64) || []
        if (!pngs.length) return { ok: false, error: 'No slides to export' }
        var base = safeName(String((request && request.baseName) || 'slides')).replace(/\.[a-z0-9]+$/i, '') || 'slides'
        var paths = []
        for (var i = 0; i < pngs.length; i++) {
          var b64 = String(pngs[i]).replace(/^data:[^,]*,/, '')
          var name = base + '-slide-' + String(i + 1).padStart(2, '0') + '.png'
          paths.push(await writeDocument(name, fromBase64(b64), { unique: true }))
        }
        return { ok: true, paths: paths }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
    slidesWrapped.fontCatalog = async function () { return [] }
    slidesWrapped.privateFontFaces = async function () {
      var F = window.__genofficeFonts
      if (!F || !F.faces) return []
      var list = await F.faces()
      var out = list.map(function (f) { return { id: f.id, family: f.family, bold: f.bold, italic: f.italic } })
      var have = {}
      out.forEach(function (f) { have[f.family.toLowerCase() + (f.bold ? 'b' : '') + (f.italic ? 'i' : '')] = 1 })
      // Caladea = pengganti metrik Cambria (seperti Carlito untuk Calibri)
      list.forEach(function (f) {
        if (f.family.toLowerCase() === 'caladea' && !have['cambria' + (f.bold ? 'b' : '') + (f.italic ? 'i' : '')]) {
          out.push({ id: f.id, family: 'Cambria', bold: f.bold, italic: f.italic })
        }
      })
      return out
    }
    slidesWrapped.privateFontData = async function (id) {
      var F = window.__genofficeFonts
      return F && F.faceData ? await F.faceData(id) : null
    }
    slidesWrapped.fontInstallLocal = async function () {
      var F = window.__genofficeFonts
      return { families: F ? await F.installLocal() : [] }
    }
    slidesWrapped.pickExportDir = async function() { return 'Documents/ZenOffice' }
    slidesWrapped.pickExportPdfPath = async function(defaultName) { return String(defaultName || 'Slides.pdf') }

    window.slidesApi = slidesWrapped
  }

  // ---------- Slides (boots to a blank deck; editing needs the missing main process) ----------

  var slideWidthEmu = 9144000
  var slideHeightEmu = 6858000

  function blankDeck(fitWidthPx) {
    var fit = Number(fitWidthPx) || 960
    var base = slideWidthEmu / 9525
    return {
      path: '',
      slides: [
        {
          widthPx: fit,
          heightPx: (fit * slideHeightEmu) / slideWidthEmu,
          scale: fit / base,
          background: { kind: 'solid', color: '#ffffff' },
          nodes: [],
          partPath: 'ppt/slides/slide1.xml',
        },
      ],
      size: { cx: slideWidthEmu, cy: slideHeightEmu },
      defaultFont: 'Arial',
    }
  }

  var slides = {
    consumePendingOpen: async function () {
      return null
    },
    newBlank: async function (fitWidthPx) {
      return blankDeck(fitWidthPx)
    },
    getLayouts: async function () {
      return { layouts: [], size: { cx: slideWidthEmu, cy: slideHeightEmu } }
    },
    getSlideSize: async function () {
      return { cx: slideWidthEmu, cy: slideHeightEmu }
    },
    getAnimations: async function () {
      return []
    },
    getTransition: async function () {
      return 'none'
    },
    getSections: async function () {
      return []
    },
    getComments: async function () {
      return []
    },
    getNotes: async function () {
      return ''
    },
    getShapeKeys: async function () {
      return []
    },
    getCustomShows: async function () {
      return []
    },
    hasSlideClipboard: async function () {
      return false
    },
    clipboardProbe: async function () {
      return false
    },
    isDirty: async function () {
      return false
    },
    onOpened: unsubscribe,
    onHistoryChanged: unsubscribe,
    onDeckChanged: unsubscribe,
    onCloseSaveRequest: unsubscribe,
    reportCloseSaveResult: noop,
    consumeHeadlessExport: async function () {
      return null
    },
    headlessExportDone: noop,
    setAutoSavePref: async function () {
      return true
    },
  }

  // ---------- project store (chat history) kept in localStorage ----------

  var projectApi = {
    resolveChat: async function (args) {
      var projectId = 'android-default'
      var chatId = (args && (args.tempChatId || args.chatId)) || 'chat-' + Date.now()
      return { projectId: projectId, chatId: chatId }
    },
    appendChat: async function (args) {
      var key = 'chat.' + args.projectId + '.' + args.chatId
      var list = lsGet(key, [])
      list.push(args.message)
      lsSet(key, list.slice(-200))
    },
    loadChat: async function (args) {
      var list = lsGet('chat.' + args.projectId + '.' + args.chatId, [])
      return args.limit ? list.slice(-args.limit) : list
    },
    rebindChat: async function (args) {
      return { projectId: args.projectId, chatId: args.chatId }
    },
    listChats: async function () {
      return []
    },
    deleteChat: async function (args) {
      try {
        localStorage.removeItem(LS + 'chat.' + args.projectId + '.' + args.chatId)
      } catch (e) {
        /* ignore */
      }
    },
  }

  // ---------- Proxy that fills every other method with a safe default ----------

  function makeApi(overrides) {
    var target = Object.assign({}, common, overrides)
    return new Proxy(target, {
      get: function (obj, prop) {
        if (typeof prop !== 'string') return undefined
        if (prop === 'then') return undefined // never look like a thenable
        if (Object.prototype.hasOwnProperty.call(obj, prop)) return obj[prop]
        if (/^on[A-Z]/.test(prop)) return unsubscribe
        if (/^(save|export|write|print|send|create|convert|merge|set|open|pick|insert|replace|split|crop|delete|move)/.test(prop)) {
          return async function () {
            return UNSUPPORTED
          }
        }
        if (/^(get|list|read|load|resolve|load|lookup)/.test(prop)) {
          return async function () {
            return null
          }
        }
        if (/^is[A-Z]/.test(prop) || /^has[A-Z]/.test(prop) || /^can[A-Z]/.test(prop)) {
          return async function () {
            return false
          }
        }
        return async function () {
          return null
        }
      },
      has: function () {
        return true
      },
    })
  }

  // ---------- addfont: custom fonts in Documents/fonts ----------
  ;(function addFontFeature() {
    var APPS = ['docs', 'sheets', 'slides', 'markdown']
    if (APPS.indexOf(appId()) < 0 || typeof document === 'undefined') return
    var FONT_DIR = 'fonts'
    var FONT_EXT = /\.(ttf|otf|woff2?)$/i
    var MD_KEY = LS + 'md.font'
    var families = []
    var seen = Object.create(null)

    function sfntNames(bytes) {
      try {
        var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        var tag = dv.getUint32(0)
        if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null
        var n = dv.getUint16(4)
        var off = 0
        for (var i = 0; i < n; i++) {
          var r = 12 + i * 16
          if (dv.getUint32(r) === 0x6e616d65) { off = dv.getUint32(r + 8); break }
        }
        if (!off) return null
        var count = dv.getUint16(off + 2)
        var strOff = off + dv.getUint16(off + 4)
        var out = {}
        for (var j = 0; j < count; j++) {
          var e = off + 6 + j * 12
          var plat = dv.getUint16(e)
          var id = dv.getUint16(e + 6)
          var len = dv.getUint16(e + 8)
          var so = strOff + dv.getUint16(e + 10)
          if (id !== 1 && id !== 2 && id !== 16 && id !== 17) continue
          if (plat !== 3 && plat !== 1) continue
          var str = ''
          var k
          if (plat === 3) for (k = 0; k < len; k += 2) str += String.fromCharCode(dv.getUint16(so + k))
          else for (k = 0; k < len; k++) str += String.fromCharCode(dv.getUint8(so + k))
          if (plat === 3 || !out[id]) out[id] = str
        }
        return out
      } catch (err) {
        return null
      }
    }

    function describe(bytes, fileName) {
      var names = sfntNames(bytes) || {}
      var stem = String(fileName || 'Font').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
      var family =
        names[16] || names[1] ||
        stem.replace(/[-_ ]?(Regular|BoldItalic|Bold|Italic|Oblique|Light|Medium|SemiBold|Black|Thin)$/i, '')
          .replace(/[-_]+/g, ' ').trim() ||
        'Custom Font'
      var sub = names[17] || names[2] || stem
      var weight = /thin|hairline/i.test(sub) ? 100
        : /light/i.test(sub) ? 300
        : /semibold|demibold/i.test(sub) ? 600
        : /medium/i.test(sub) ? 500
        : /black|heavy/i.test(sub) ? 900
        : /bold/i.test(sub) ? 700 : 400
      return { family: family, weight: weight, style: /italic|oblique/i.test(sub) ? 'italic' : 'normal' }
    }

    var faceStore = [] // zen-private-fonts
    async function register(bytes, fileName) {
      var d = describe(bytes, fileName)
      var buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      var face = new FontFace(d.family, buf, { weight: String(d.weight), style: d.style })
      await face.load()
      document.fonts.add(face)
      var fid = d.family + '|' + d.weight + '|' + d.style
      faceStore = faceStore.filter(function (x) { return x.id !== fid })
      faceStore.push({ id: fid, family: d.family, bold: d.weight >= 600, italic: d.style === 'italic', buf: buf })
      if (!seen[d.family]) {
        seen[d.family] = true
        families.push(d.family)
        families.sort(function (a, b) { return a.localeCompare(b) })
      }
      return d.family
    }

    async function installBytes(fileName, bytes) {
      var family = await register(bytes, fileName)
      var fs = filesystem()
      if (!fs) throw new Error('Filesystem plugin unavailable')
      await fs.writeFile({
        path: FONT_DIR + '/' + safeName(baseName(fileName)),
        data: toBase64(bytes),
        directory: 'DOCUMENTS',
        recursive: true,
      })
      return family
    }

    async function loadSaved() {
      var fs = filesystem()
      if (!fs) return
      var list
      try {
        list = await fs.readdir({ path: FONT_DIR, directory: 'DOCUMENTS' })
      } catch (err) {
        return
      }
      var files = (list && list.files) || []
      for (var i = 0; i < files.length; i++) {
        var name = files[i].name || String(files[i])
        if (!FONT_EXT.test(name)) continue
        try {
          var r = await fs.readFile({ path: FONT_DIR + '/' + name, directory: 'DOCUMENTS' })
          await register(bytesOf(fromBase64(r.data)), name)
        } catch (err) {
          console.error('addfont load failed:', name, err)
        }
      }
    }

    var ready = loadSaved().catch(function () {})

    var RECENT_KEY = LS + 'fonts.recent'
    function recent() {
      try {
        var a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
        return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' && x }).slice(0, 5) : []
      } catch (err) {
        return []
      }
    }
    function pushRecent(name) {
      try {
        var a = recent().filter(function (x) { return x !== name })
        a.unshift(name)
        localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, 5)))
      } catch (err) {}
    }

    async function installLocal() {
      var picked = await pickFiles('', true)
      if (!picked) return []
      var added = []
      var fails = []
      for (var i = 0; i < picked.length; i++) {
        var f = picked[i]
        var hdr = '?'
        try {
          var u8
          try {
            u8 = new Uint8Array(await f.arrayBuffer())
          } catch (rerr) {
            throw new Error('cannot read the picked file (it was moved, deleted or is still downloading). Pick it again or re-download it.')
          }
          hdr = Array.prototype.slice.call(u8.subarray(0, 4)).map(function (x) { return ('0' + x.toString(16)).slice(-2) }).join('')
          if (!FONT_EXT.test(f.name)) throw new Error('unsupported extension (use .ttf/.otf/.woff/.woff2)')
          var fam = await installBytes(f.name, u8)
          if (added.indexOf(fam) < 0) added.push(fam)
        } catch (err) {
          fails.push(f.name + ' (' + f.size + ' B, header ' + hdr + '): ' + String((err && err.message) || err))
          console.error('addfont install failed:', f.name, err)
        }
      }
      var msg = added.length ? 'Font added: ' + added.join(', ') : 'No font added'
      if (fails.length) msg += '\nFailed: ' + fails.join('; ')
      toast(msg, fails.length ? 6000 : 2800)
      refreshPanel()
      return added
    }

    window.queryLocalFonts = async function () {
      await ready
      return families.map(function (f) { return { family: f } })
    }
    window.__genofficeFonts = {
      list: function () { return families.slice() },
      installLocal: installLocal,
      installBytes: installBytes,
      faces: async function () {
        await ready
        return faceStore.slice()
      },
      faceData: async function (id) {
        await ready
        for (var i = 0; i < faceStore.length; i++) if (faceStore[i].id === id) return faceStore[i].buf
        return null
      },
      recent: recent,
      pushRecent: pushRecent,
      applyMarkdown: applyMd,
      markdownFont: function () { try { return localStorage.getItem(MD_KEY) || '' } catch (err) { return '' } },
      ready: function () { return ready },
    }

    function toast(msg, ms) {
      var t = document.createElement('div')
      t.textContent = msg
      t.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:140px;z-index:2147483001;max-width:80vw;white-space:pre-wrap;padding:8px 14px;border-radius:10px;background:rgba(30,30,30,.92);color:#fff;font:13px sans-serif'
      document.body.appendChild(t)
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t) }, ms || 2800)
    }

    // ---- Markdown: apply a custom font to the editor paper ----
    function applyMd(family) {
      var el = document.getElementById('zen-md-font')
      if (!family) {
        if (el) el.remove()
        try { localStorage.removeItem(MD_KEY) } catch (err) {}
        return
      }
      if (!el) {
        el = document.createElement('style')
        el.id = 'zen-md-font'
        document.head.appendChild(el)
      }
      var q = "'" + family.replace(/['"\\]/g, '') + "'"
      el.textContent =
        '.doc-editor{font-family:' + q + ',sans-serif!important}' +
        '.doc-editor :where(h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th){font-family:inherit!important}'
      try { localStorage.setItem(MD_KEY, family) } catch (err) {}
    }

    var panel = null
    function refreshPanel() {
      if (!panel || appId() !== 'markdown') return
      panel.innerHTML = ''
      function row(label, fn, strong) {
        var b = document.createElement('button')
        b.type = 'button'
        b.textContent = label
        b.style.cssText = 'display:block;width:100%;text-align:left;padding:9px 12px;border:0;background:none;color:inherit;font:' + (strong ? '600 ' : '') + '14px sans-serif'
        b.addEventListener('click', fn)
        panel.appendChild(b)
      }
      row('Add font…', function () { installLocal() }, true)
      row('Default font', function () { applyMd(''); panel.style.display = 'none' })
      families.forEach(function (f) {
        row(f, function () { applyMd(f); panel.style.display = 'none' })
      })
    }

    function mountFab() {
      var b = document.createElement('button')
      b.type = 'button'
      b.textContent = 'Aa+'
      b.title = 'Add font'
      b.setAttribute('aria-label', 'Add font')
      b.style.cssText = 'position:fixed;left:10px;bottom:84px;z-index:2147483000;width:44px;height:44px;border-radius:22px;border:1px solid rgba(128,128,128,.5);background:#fff;color:#222;font:600 13px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);opacity:.9'
      b.addEventListener('click', function () {
        if (appId() !== 'markdown') { installLocal(); return }
        if (!panel) {
          panel = document.createElement('div')
          panel.style.cssText = 'position:fixed;left:10px;bottom:134px;z-index:2147483000;max-height:50vh;overflow:auto;min-width:200px;border-radius:10px;border:1px solid rgba(128,128,128,.5);background:#fff;color:#222;box-shadow:0 4px 16px rgba(0,0,0,.3)'
          document.body.appendChild(panel)
          panel.style.display = 'none'
        }
        refreshPanel()
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
      })
      document.body.appendChild(b)
    }

    // every app adds fonts from its own font list; no floating button

    if (appId() === 'markdown') {
      ready.then(function () {
        try {
          var saved = localStorage.getItem(MD_KEY)
          if (saved && seen[saved]) applyMd(saved)
        } catch (err) {}
      })
    }
  })()

  // ---------- brand: show ZenOffice in window/tab titles ----------
  ;(function brandTitle() {
    if (typeof document === 'undefined' || !window.MutationObserver) return
    function fix() {
      var t = document.title
      if (t && t.indexOf('GenOffice') >= 0) document.title = t.replace(/GenOffice/g, 'ZenOffice')
    }
    fix()
    new MutationObserver(fix).observe(document.head || document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    })
  })()

  // ---------- opening overlay (Docs): keep the editor hidden until page/word counts settle ----------
  ;(function openingOverlay() {
    var OPENING = {
      docs: { docs: true, icon: 'file-docx.png', sub: 'Preparing pages and word count', min: 400, quiet: 900, max: 300000, large: true },
      slides: { icon: 'file-pptx.png', sub: 'Preparing slides…', ready: '.stage-scale', fallback: 2500, min: 600, quiet: 400, max: 15000 },
      sheets: { icon: 'file-xlsx.png', sub: 'Preparing workbook…', ready: null, fallback: 1500, min: 600, quiet: 400, max: 15000 },
      pdf: { icon: 'file-pdf.png', sub: 'Preparing pages…', ready: null, fallback: 1500, min: 600, quiet: 400, max: 15000 },
      markdown: { icon: 'file-md.png', sub: 'Preparing document…', ready: '.doc-page', fallback: 1500, min: 600, quiet: 400, max: 15000 },
      html: { icon: 'file-html.png', sub: 'Preparing preview…', ready: '.preview-stage', fallback: 1500, min: 600, quiet: 400, max: 15000 },
    }
    var cfg = OPENING[appId()]
    if (!cfg || !isEmbedded() || typeof document === 'undefined') return
    var MIN_MS = cfg.min
    var QUIET_MS = cfg.quiet
    var MAX_MS = cfg.max // a 700-page document needs ~2 min; the old 60 s cap released the overlay while pages were still being laid out
    var t0 = Date.now()
    var prev = t0
    var lastLong = t0
    var lastChange = t0
    var lastSig = ''
    var done = false
    var theme = shellTheme()
    var dark = theme === 'dark' || (theme !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    var logo = new URL('../shim/assets/' + cfg.icon, location.href).href
    var root = document.documentElement
    var style = document.createElement('style')
    style.textContent =
      '#zen-opening{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;' +
      'background:' + (dark ? '#15181c' : '#f7f8fa') + ';color:' + (dark ? '#edf0f5' : '#1b1f27') + ';font:14px sans-serif;transition:opacity .2s ease}' +
      '#zen-opening .zo-logo{position:relative;width:104px;height:104px;display:grid;place-items:center}' +
      '#zen-opening img{width:68px;height:68px;animation:zo-pulse 1.4s ease-in-out infinite;will-change:transform}' +
      '#zen-opening .zo-ring{position:absolute;inset:0;border-radius:50%;border:3px solid rgba(128,128,128,.25);border-top-color:#0f7fff;animation:zo-spin .9s linear infinite;will-change:transform}' +
      '#zen-opening .zo-title{font-size:16px;font-weight:600;max-width:80vw;text-align:center;word-break:break-word}' +
      '#zen-opening .zo-sub{font-size:12px;opacity:.6}' +
      '@keyframes zo-spin{to{transform:rotate(360deg)}}' +
      '@keyframes zo-pulse{0%,100%{transform:scale(.92)}50%{transform:scale(1.06)}}' +
      '@media (prefers-reduced-motion:reduce){#zen-opening img,#zen-opening .zo-ring{animation:none}}'
    var box = document.createElement('div')
    box.id = 'zen-opening'
    box.setAttribute('role', 'status')
    box.innerHTML =
      '<div class="zo-logo"><span class="zo-ring"></span><img alt="" src="' + logo + '" /></div>' +
      '<div class="zo-title">Opening…</div><div class="zo-sub">' + cfg.sub + '</div>'
    root.appendChild(style)
    root.appendChild(box)
    var titleEl = box.querySelector('.zo-title')
    var subEl = box.querySelector('.zo-sub')

    // Non-Docs apps: ready once the app root has content (and the optional marker element exists,
    // or the fallback time has passed); DOM mutations keep resetting the quiet timer while a file loads
    function generalReady(now) {
      var r = document.getElementById('root') || document.body
      if (!r || !r.firstElementChild) return false
      if (cfg.ready && document.querySelector(cfg.ready)) return true
      return now - t0 >= cfg.fallback
    }
    function activity() {
      var n = Date.now()
      lastChange = n
      lastLong = n
    }
    document.addEventListener('genoffice:phased-content-settled', activity)
    var mo = null

    function finish(timedOut) {
      if (done) return
      done = true
      if (mo) mo.disconnect()
      var ms = Date.now() - t0
      window.__zenOpen = { t0: t0, ms: ms, timedOut: !!timedOut, pend: window.__zenPhasedPending === true }
      root.setAttribute('data-zen-ready', '1')
      box.style.opacity = '0'
      box.style.pointerEvents = 'none'
      setTimeout(function () {
        if (box.parentNode) box.parentNode.removeChild(box)
        if (style.parentNode) style.parentNode.removeChild(style)
      }, 260)
    }

    function tick() {
      if (done) return
      var now = Date.now()
      if (now - prev > 350) lastLong = now // the timer was starved: main thread was busy
      prev = now
      var pg = document.querySelector('.status-page')
      var wc = document.querySelector('.status-wordcount')
      var sig = pg && wc ? pg.textContent + '|' + wc.textContent : ''
      if (sig !== lastSig) {
        lastSig = sig
        lastChange = now
      }
      var name = queryPath ? baseName(queryPath) : /^ZenOffice/.test(document.title || '') ? '' : document.title
      if (name && titleEl) titleEl.textContent = 'Opening ' + name + '…'
      if (subEl && cfg.large && now - t0 > 15000) subEl.textContent = 'Preparing pages and word count (large document, ' + Math.round((now - t0) / 1000) + 's)'
      var hasDoc = cfg.docs
        ? !!sig && !!document.querySelector('.editor-scroll .ProseMirror') && window.__zenPhasedPending !== true
        : generalReady(now)
      var quiet = now - Math.max(cfg.docs ? lastChange : 0, lastLong) >= QUIET_MS
      if (hasDoc && quiet && now - t0 >= MIN_MS) finish(false)
      else if (now - t0 >= MAX_MS) finish(true)
    }
    setInterval(tick, 200)
  })()

  // Do not clobber anything an embedding host may have defined already.
  function define(name, value) {
    if (!(name in window)) {
      Object.defineProperty(window, name, { value: value, configurable: true, writable: true })
    }
  }

  define('desktop', makeApi(appId() === 'sheets' ? sheets : docs))
  define('desktopApi', makeApi(appId() === 'sheets' ? sheets : {}))
  if (!window.slidesApi) define('slidesApi', makeApi(slides))
  define('pdfApi', makeApi(pdf))
  define('markdownApi', makeApi(markdown))
  define('htmlApi', makeApi(html))
  define('projectApi', projectApi)

  // Hooks used by the launcher page. The launcher lives on the same origin, so
  // it can hand a picked File to the app through IndexedDB.
  window.__genofficeAndroid = {
    version: 1,
    appId: appId,
    pickFile: pickFile,
    putPending: putPending,
    takePending: takePending,
    putFileBlob: putFileBlob,
    getFileBlob: getFileBlob,
    removeFileBlob: removeFileBlob,
    previewUrl: previewUrl,
    documentPath: documentPath,
  }
})()

;(function zenDocDoubleTap() {
  // double-tap on document text: select the word and open the same menu as long-press
  var start = null
  var last = null
  var MOVE_PX = 12
  var TAP_MAX_MS = 250
  var GAP_MS = 320
  var GAP_PX = 28
  var isWordChar = function (c) {
    return !!c && /[\p{L}\p{N}_'’]/u.test(c)
  }
  function selectWordAndMenu(x, y, el) {
    var r = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y)
    if (!r || r.startContainer.nodeType !== 3) return
    var node = r.startContainer
    var text = node.textContent || ''
    var i = r.startOffset
    if (!isWordChar(text.charAt(i)) && isWordChar(text.charAt(i - 1))) i -= 1
    if (!isWordChar(text.charAt(i))) return
    var a = i
    var b = i
    while (a > 0 && isWordChar(text.charAt(a - 1))) a -= 1
    while (b < text.length && isWordChar(text.charAt(b))) b += 1
    var range = document.createRange()
    range.setStart(node, a)
    range.setEnd(node, b)
    var sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    if (window.__zenShowSelHandles) window.__zenShowSelHandles()
    // let ProseMirror sync its state from the DOM selection before the menu reads it
    setTimeout(function () {
      window.__zenDtapFlag = true
      el.dispatchEvent(
        new PointerEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerType: 'touch',
          view: window,
        }),
      )
      window.__zenDtapFlag = false
    }, 80)
  }
  window.addEventListener(
    'touchstart',
    function (e) {
      if (e.touches.length !== 1) {
        start = null
        last = null
        return
      }
      var t = e.touches[0]
      start = { x: t.clientX, y: t.clientY, t: Date.now() }
    },
    { passive: true, capture: true },
  )
  window.addEventListener(
    'touchend',
    function (e) {
      if (!start || e.changedTouches.length !== 1) return
      var t = e.changedTouches[0]
      var s = start
      start = null
      var now = Date.now()
      if (Math.abs(t.clientX - s.x) > MOVE_PX || Math.abs(t.clientY - s.y) > MOVE_PX || now - s.t > TAP_MAX_MS) {
        last = null
        return
      }
      var el = document.elementFromPoint(t.clientX, t.clientY)
      if (!el || !el.closest || !el.closest('.doc-page')) {
        last = null
        return
      }
      if (last && now - last.t < GAP_MS && Math.abs(t.clientX - last.x) < GAP_PX && Math.abs(t.clientY - last.y) < GAP_PX) {
        last = null
        selectWordAndMenu(t.clientX, t.clientY, el)
      } else {
        last = { x: t.clientX, y: t.clientY, t: now }
      }
    },
    { passive: true, capture: true },
  )
})()

;(function zenDocSelHandles() {
  // custom selection handles for selections made by double-tap (Android only shows
  // its native handles for selections made by a real touch gesture)
  var SIZE = 26
  var COLOR = '#7fd1c7'
  var hs = null
  var he = null
  var active = false
  var drag = null
  var raf = 0
  function mk(kind) {
    var o = document.createElement('div')
    o.className = 'zen-sel-handle zen-sel-handle-' + kind
    o.style.cssText =
      'position:fixed;z-index:2147483000;width:48px;height:48px;display:none;touch-action:none;background:transparent;'
    var i = document.createElement('div')
    i.style.cssText =
      'position:absolute;top:0;width:' + SIZE + 'px;height:' + SIZE + 'px;background:' + COLOR + ';opacity:.95;' +
      (kind === 'start' ? 'left:10px;border-radius:50% 0 50% 50%;' : 'left:12px;border-radius:0 50% 50% 50%;')
    o.appendChild(i)
    o.addEventListener(
      'touchstart',
      function (e) {
        var sel = window.getSelection()
        if (!sel || sel.rangeCount === 0) return
        var r = sel.getRangeAt(0)
        e.preventDefault()
        e.stopPropagation()
        drag =
          kind === 'start'
            ? { n: r.endContainer, o: r.endOffset }
            : { n: r.startContainer, o: r.startOffset }
      },
      { passive: false },
    )
    document.body.appendChild(o)
    return o
  }
  function hide() {
    if (hs) hs.style.display = 'none'
    if (he) he.style.display = 'none'
  }
  function place() {
    raf = 0
    var sel = window.getSelection()
    if (!active || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      if (sel && sel.isCollapsed) active = false
      hide()
      return
    }
    var rs = Array.prototype.filter.call(sel.getRangeAt(0).getClientRects(), function (r) {
      return r.width > 0 && r.height > 0
    })
    if (!rs.length) {
      hide()
      return
    }
    var f = rs[0]
    var l = rs[rs.length - 1]
    hs.style.left = f.left - 36 + 'px'
    hs.style.top = f.bottom + 'px'
    he.style.left = l.right - 12 + 'px'
    he.style.top = l.bottom + 'px'
    hs.style.display = 'block'
    he.style.display = 'block'
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(place)
  }
  window.__zenShowSelHandles = function () {
    if (!document.body) return
    if (!hs) {
      hs = mk('start')
      he = mk('end')
    }
    active = true
    schedule()
  }
  document.addEventListener('selectionchange', schedule)
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  // a native long-press brings its own handles: drop ours
  window.addEventListener(
    'contextmenu',
    function () {
      if (!window.__zenDtapFlag) {
        active = false
        hide()
      }
    },
    true,
  )
  window.addEventListener(
    'touchmove',
    function (e) {
      if (!drag || e.touches.length !== 1) return
      e.preventDefault()
      var t = e.touches[0]
      var r = document.caretRangeFromPoint && document.caretRangeFromPoint(t.clientX, t.clientY - SIZE)
      if (!r) return
      var sel = window.getSelection()
      sel.setBaseAndExtent(drag.n, drag.o, r.startContainer, r.startOffset)
      schedule()
    },
    { passive: false, capture: true },
  )
  var endDrag = function () {
    drag = null
  }
  window.addEventListener('touchend', endDrag, { passive: true, capture: true })
  window.addEventListener('touchcancel', endDrag, { passive: true, capture: true })
})()
;(function zenPopupAnim() {
  // enter/exit animation for popups and side panes (Android only)
  if (window.__zenPopupAnim) return
  window.__zenPopupAnim = true
  if (!document.documentElement || !document.documentElement.animate) return
  var LEFT = '.nav-pane, .outline-pane, .pdf-outline-pane'
  var DOCK =
    '.comments-pane, .styles-pane, .chart-format-pane, .pivot-fields-pane, .note-pictures-pane, ' +
    '.threaded-comments-pane, .format-pane, .pdf-formdesign-props, ' +
    LEFT
  var SEL =
    '[data-rb-panel], .ctx-menu, .ctx-submenu, .zen-menu, .menu-select-drop, .rb-drop, .table-picker, .thumb-menu, .find-panel, ' +
    '.file-menu, .chart-menu, .pivot-chip-menu, .sheet-tab-menu, .sheet-tab-menu-pop, .status-stats-menu, ' +
    '.table-style-panel, .find-replace-panel, .fp-dir-pop, .fp-shadowgal-pop, .master-tool-drop, .pen-flyout, ' +
    '.rbf-flyout, .pdf-del-popup, .pdf-opacity-menu, .pdf-sel-popup, .pdf-search-bar, .app-toast, .pdf-toast, ' +
    DOCK
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)')
  var IN_MS = 150
  var OUT_MS = 110
  var DOCK_IN = 240
  var DOCK_OUT = 180
  var HID = { opacity: 0, scale: '0.96', translate: '0 -6px' }
  var SHOW = { opacity: 1, scale: '1', translate: '0 0' }
  var DOCK_SHOW = { opacity: 1, translate: '0 0' }
  function dockHid(el) {
    return { opacity: 0, translate: (el.matches(LEFT) ? -28 : 28) + 'px 0' }
  }
  function isContents(el) {
    return getComputedStyle(el).display === 'contents'
  }
  function enter(el) {
    if (el.matches(DOCK)) {
      // remember where the pane sits so its exit ghost can stay put without affecting layout
      var save = function () {
        var r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) el.__zenRect = { l: r.left, t: r.top, w: r.width, h: r.height }
      }
      var a = el.animate([dockHid(el), DOCK_SHOW], {
        duration: DOCK_IN,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'backwards',
      })
      a.onfinish = save
      if (window.ResizeObserver) new ResizeObserver(save).observe(el)
      return
    }
    var list = isContents(el) ? Array.prototype.slice.call(el.children) : [el]
    list.forEach(function (t) {
      t.animate([HID, SHOW], { duration: IN_MS, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' })
    })
  }
  function leave(node, parent, next) {
    if (node.isConnected || !parent || !parent.isConnected) return
    var dock = node.matches(DOCK)
    if (dock && !node.__zenRect) return
    node.__zenGhost = true
    parent.insertBefore(node, next && next.parentNode === parent ? next : null)
    var done = function () {
      if (node.parentNode) node.parentNode.removeChild(node)
    }
    if (isContents(node)) {
      done()
      return
    }
    node.removeAttribute('data-rb-panel')
    node.setAttribute('aria-hidden', 'true')
    node.style.pointerEvents = 'none'
    var from = SHOW
    var to = HID
    var dur = OUT_MS
    if (dock) {
      var r = node.__zenRect
      var st = node.style
      st.position = 'fixed'
      st.left = r.l + 'px'
      st.top = r.t + 'px'
      st.width = r.w + 'px'
      st.height = r.h + 'px'
      st.margin = '0'
      st.boxSizing = 'border-box'
      st.zIndex = '50'
      from = DOCK_SHOW
      to = dockHid(node)
      dur = DOCK_OUT
    }
    var anim = node.animate([from, to], { duration: dur, easing: 'ease-in', fill: 'forwards' })
    anim.onfinish = done
    anim.oncancel = done
    setTimeout(done, dur + 250)
  }
  new MutationObserver(function (records) {
    if (reduce && reduce.matches) return
    records.forEach(function (r) {
      Array.prototype.forEach.call(r.addedNodes, function (n) {
        if (n.nodeType === 1 && !n.__zenGhost && n.matches(SEL)) enter(n)
      })
      Array.prototype.forEach.call(r.removedNodes, function (n) {
        if (n.nodeType === 1 && !n.__zenGhost && n.matches(SEL)) leave(n, r.target, r.nextSibling)
      })
    })
  }).observe(document.documentElement, { childList: true, subtree: true })
})()

;(function zenSidebarAnim2 () {
  if (window.__zenSidebarAnim2) return
  window.__zenSidebarAnim2 = true
  var SEL = 'section[data-u-comp="sidebar"]'
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var state = new WeakMap()   // el -> { open, snap, rect }
  var openSet = new Set()
  var snapTimer = null
  var OPTS = { duration: 170, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }

  function info (el) {
    var st = state.get(el)
    if (!st) { st = { open: false, snap: null, rect: null }; state.set(el, st) }
    return st
  }
  function snapshot (el) {
    var st = info(el)
    if (!st.open || !el.isConnected) return
    var r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) return
    st.rect = { top: r.top, left: r.left, width: r.width, height: r.height }
    var c = el.cloneNode(true)
    c.setAttribute('data-zen-ghost', '1')
    c.removeAttribute('aria-expanded')
    c.removeAttribute('id')
    st.snap = c
  }
  function scheduleSnap () {
    clearTimeout(snapTimer)
    snapTimer = setTimeout(function () { openSet.forEach(snapshot) }, 150)
  }
  function ghostOut (el) {
    var st = info(el)
    var snap = st.snap, r = st.rect
    st.snap = null
    if (reduce || !snap || !r || !snap.animate) return
    snap.style.cssText += ';position:fixed;margin:0;z-index:2147483000;pointer-events:none;' +
      'top:' + r.top + 'px;left:' + r.left + 'px;width:' + r.width + 'px;height:' + r.height + 'px;'
    document.body.appendChild(snap)
    var a = snap.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(28px)' }], OPTS
    )
    var done = function () { snap.remove() }
    a.onfinish = done
    a.oncancel = done
    setTimeout(done, 400)
  }
  function sync (el) {
    if (el.hasAttribute('data-zen-ghost')) return
    var st = info(el)
    var open = el.getAttribute('aria-expanded') === 'true'
    var was = st.open
    if (open && !was) {
      st.open = true
      openSet.add(el)
      if (!reduce && el.animate) {
        el.animate(
          [{ opacity: 0, transform: 'translateX(28px)' }, { opacity: 1, transform: 'none' }],
          { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }
        )
      }
      setTimeout(function () { snapshot(el) }, 260)
    } else if (!open && was) {
      st.open = false
      openSet.delete(el)
      ghostOut(el)
    }
  }
  function gone (el) {
    if (el.hasAttribute('data-zen-ghost')) return
    var st = info(el)
    if (st.open) { st.open = false; openSet.delete(el); ghostOut(el) }
  }
  function each (n, fn) {
    if (n.nodeType !== 1) return
    if (n.matches(SEL)) fn(n)
    if (n.querySelectorAll) n.querySelectorAll(SEL).forEach(fn)
  }
  function start () {
    each(document.documentElement, sync)
    new MutationObserver(function (ms) {
      var touched = false
      ms.forEach(function (m) {
        if (m.type === 'attributes') {
          if (m.target.matches && m.target.matches(SEL)) sync(m.target)
          return
        }
        m.removedNodes.forEach(function (n) { each(n, gone) })
        m.addedNodes.forEach(function (n) { each(n, sync) })
        touched = true
      })
      if (touched && openSet.size) scheduleSnap()
    }).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded']
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()

;(function zenSheetTouch2 () {
  if (window.__zenSheetTouch2) return
  window.__zenSheetTouch2 = true
  var ROOT = '[data-u-comp="workbench-layout"]'
  var SLOP = 10          // px sebelum dianggap geser
  var LONG_MS = 400      // tekan lama
  var DBL_MS = 320
  var DBL_DIST = 30
  var SCALE = 1          // pengali kecepatan scroll
  var FRICTION = 0.94
  var PINCH_STEP = 0.06   // perubahan jarak jari (6%) per langkah zoom
  var EDGE = 56          // zona autoscroll dari tepi grid (px)
  var AUTO_SPEED = 18    // px per frame di tepi paling luar

  var css = document.createElement('style')
  css.textContent = ROOT + ' canvas{touch-action:none;-webkit-user-select:none;user-select:none;' +
    '-webkit-tap-highlight-color:transparent}html,body{overscroll-behavior:none}'
  ;(document.head || document.documentElement).appendChild(css)

  var g = null, fling = null, lastTap = null

  function isGrid (e) {
    var t = e.target
    return !!(t && t.tagName === 'CANVAS' && t.closest && t.closest(ROOT))
  }
  var DEBUG = false       // label debug tap; set false kalau sudah beres
  var dbgEl = null
  function dbg (el, r, x, y) {
    if (!dbgEl) {
      dbgEl = document.createElement('div')
      dbgEl.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:2147483600;pointer-events:none;' +
        'background:rgba(0,0,0,.75);color:#0f0;font:11px monospace;padding:3px 5px;white-space:pre'
      document.body.appendChild(dbgEl)
    }
    var vv = window.visualViewport
    dbgEl.textContent = 'tap ' + Math.round(x) + ',' + Math.round(y) +
      ' | rect ' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) +
      '\nclient ' + el.clientWidth + 'x' + el.clientHeight +
      ' | vv ' + (vv ? Math.round(vv.offsetTop) + ' s' + vv.scale : '-')
  }
  function dispatch (el, x, y, ev) {
    var r = el.getBoundingClientRect()
    try {
      Object.defineProperty(ev, 'offsetX', { value: x - r.left })
      Object.defineProperty(ev, 'offsetY', { value: y - r.top })
    } catch (_) {}
    if (DEBUG && ev.type === 'pointerdown') dbg(el, r, x, y)
    el.dispatchEvent(ev)
  }
  function wheel (el, x, y, dx, dy) {
    el.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, deltaX: dx * SCALE, deltaY: dy * SCALE, deltaMode: 0
    }))
  }
  function zoomStep (el, x, y, dir) {
    el.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, composed: true, ctrlKey: true,
      clientX: x, clientY: y, deltaX: 0, deltaY: dir * 100, deltaMode: 0
    }))
  }
  function ptr (type, el, x, y, buttons) {
    dispatch(el, x, y, new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: buttons, clientX: x, clientY: y
    }))
  }
  function stopFling () {
    var was = !!fling
    if (fling) { cancelAnimationFrame(fling.raf); fling = null }
    return was
  }
  function startFling (el, x, y, vx, vy) {
    if (Math.hypot(vx, vy) < 0.15) return
    var f = fling = { raf: 0 }
    var last = performance.now()
    function step (now) {
      if (fling !== f) return
      var dt = Math.min(now - last, 48)
      last = now
      wheel(el, x, y, -vx * dt, -vy * dt)
      var k = Math.pow(FRICTION, dt / 16.67)
      vx *= k; vy *= k
      if (Math.hypot(vx, vy) < 0.02) { fling = null; return }
      f.raf = requestAnimationFrame(step)
    }
    f.raf = requestAnimationFrame(step)
  }
  function tap (el, x, y) {
    var now = Date.now()
    var dbl = lastTap && now - lastTap.t < DBL_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < DBL_DIST
    ptr('pointerdown', el, x, y, 1)
    ptr('pointerup', el, x, y, 0)
    if (dbl) {
      dispatch(el, x, y, new MouseEvent('dblclick', {
        bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, detail: 2, button: 0
      }))
      lastTap = null
    } else lastTap = { t: now, x: x, y: y }
  }
  function flushScroll (s) {   // zenFeel: gabung gerakan jari, satu wheel per frame
    if (s.qraf) { cancelAnimationFrame(s.qraf); s.qraf = 0 }
    if (s.qx || s.qy) { var qx = s.qx, qy = s.qy; s.qx = 0; s.qy = 0; wheel(s.el, s.x, s.y, -qx, -qy) }
  }
  function queueScroll (s, dx, dy) {
    s.qx = (s.qx || 0) + dx; s.qy = (s.qy || 0) + dy
    if (!s.qraf) s.qraf = requestAnimationFrame(function () { s.qraf = 0; flushScroll(s) })
  }
  function contextMenu (el, x, y) {   // zenCtx: klik kanan lengkap, Univer butuh pointer button 2
    var o = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 2, clientX: x, clientY: y }
    dispatch(el, x, y, new PointerEvent('pointerdown', Object.assign({ buttons: 2 }, o)))
    dispatch(el, x, y, new PointerEvent('pointerup', Object.assign({ buttons: 0 }, o)))
    dispatch(el, x, y, new MouseEvent('contextmenu', Object.assign({ buttons: 0 }, o)))
  }

  // ---- mode blok (tekan lama + geser) ----
  function autoScroll () {
    if (!g || !g.select) return
    var r = g.el.getBoundingClientRect()
    var dx = 0, dy = 0
    if (g.x > r.right - EDGE) dx = Math.min(1, (g.x - (r.right - EDGE)) / EDGE)
    else if (g.x < r.left + EDGE) dx = -Math.min(1, (r.left + EDGE - g.x) / EDGE)
    if (g.y > r.bottom - EDGE) dy = Math.min(1, (g.y - (r.bottom - EDGE)) / EDGE)
    else if (g.y < r.top + EDGE) dy = -Math.min(1, (r.top + EDGE - g.y) / EDGE)
    if (g.selMoved && (dx || dy)) {
      wheel(g.el, g.x, g.y, dx * AUTO_SPEED, dy * AUTO_SPEED)
      ptr('pointermove', g.el, g.x, g.y, 1)
    }
    g.raf = requestAnimationFrame(autoScroll)
  }
  function longPress () {
    if (!g || g.moved || g.dead || g.select) return
    g.select = true
    g.timer = 0
    try { navigator.vibrate && navigator.vibrate(15) } catch (_) {}
    ptr('pointerdown', g.el, g.x, g.y, 1)
    g.raf = requestAnimationFrame(autoScroll)
  }
  function endSelect (s, x, y) {
    cancelAnimationFrame(s.raf)
    ptr('pointerup', s.el, x, y, 0)
  }

  window.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch' || !isGrid(e)) return
    e.stopImmediatePropagation()
    if (g) {                                   // jari kedua: batalkan gestur (pinch di tahap 3)
      g.dead = true
      clearTimeout(g.timer)
      if (g.select) { endSelect(g, g.x, g.y); g.select = false }
      if (!g.pinch) g.pinch = { id2: e.pointerId, x2: e.clientX, y2: e.clientY, d: Math.hypot(g.x - e.clientX, g.y - e.clientY) }
      return
    }
    if (window.__zenHeaderEdge && window.__zenHeaderEdge(e.clientX, e.clientY)) {
      stopFling()
      g = { id: e.pointerId, el: e.target, x: e.clientX, y: e.clientY, pass: true, down: false, dead: false,
            moved: false, select: false, timer: 0, samples: [] }
      ptr('pointermove', g.el, g.x, g.y, 0)
      setTimeout(function () { if (g && g.pass) { g.down = true; ptr('pointerdown', g.el, g.x, g.y, 1) } }, 60)
      return
    }
    var wasFling = stopFling()
    g = {
      id: e.pointerId, el: e.target, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      moved: false, dead: false, wasFling: wasFling, select: false, selMoved: false, raf: 0, timer: 0,
      samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }]
    }
    if (!wasFling) g.timer = setTimeout(longPress, LONG_MS)
  }, true)

  window.addEventListener('pointermove', function (e) {
    if (!g || e.pointerType !== 'touch') return
    e.stopImmediatePropagation()
    if (g.pass) {
      if (e.pointerId === g.id) { g.x = e.clientX; g.y = e.clientY; if (g.down) ptr('pointermove', g.el, g.x, g.y, 1) }
      return
    }
    if (g.pinch) {
      var pz = g.pinch
      if (e.pointerId === g.id) { g.x = e.clientX; g.y = e.clientY }
      else if (e.pointerId === pz.id2) { pz.x2 = e.clientX; pz.y2 = e.clientY }
      else return
      var d = Math.hypot(g.x - pz.x2, g.y - pz.y2)
      if (d < 1 || pz.d < 1) return
      var mx = (g.x + pz.x2) / 2, my = (g.y + pz.y2) / 2, n = 0
      while (n++ < 5 && d / pz.d > 1 + PINCH_STEP) { zoomStep(g.el, mx, my, -1); pz.d *= 1 + PINCH_STEP }
      while (n++ < 10 && d / pz.d < 1 - PINCH_STEP) { zoomStep(g.el, mx, my, 1); pz.d *= 1 - PINCH_STEP }
      return
    }
    if (e.pointerId !== g.id || g.dead) return
    if (g.select) {
      g.x = e.clientX; g.y = e.clientY
      if (!g.selMoved && Math.hypot(g.x - g.x0, g.y - g.y0) >= SLOP) g.selMoved = true
      if (g.selMoved) ptr('pointermove', g.el, g.x, g.y, 1)
      return
    }
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < SLOP) return
      g.moved = true
      clearTimeout(g.timer)
    }
    var dx = e.clientX - g.x, dy = e.clientY - g.y
    g.x = e.clientX; g.y = e.clientY
    queueScroll(g, dx, dy)
    g.samples.push({ t: e.timeStamp, x: g.x, y: g.y })
    while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift()
  }, true)

  function finish (e, cancel) {
    if (!g || e.pointerType !== 'touch') return
    e.stopImmediatePropagation()
    if (g.pinch && e.pointerId === g.pinch.id2) { g.pinch = null; return }
    if (e.pointerId !== g.id) return
    var s = g
    g = null
    clearTimeout(s.timer)
    flushScroll(s)
    if (s.pass) { if (s.down) ptr('pointerup', s.el, e.clientX, e.clientY, 0); return }
    if (s.select) {
      endSelect(s, e.clientX, e.clientY)
      if (!cancel && !s.selMoved) contextMenu(s.el, e.clientX, e.clientY)
      return
    }
    if (s.dead || cancel) return
    if (s.moved) {
      var a = s.samples[0], b = s.samples[s.samples.length - 1]
      var dt = b.t - a.t
      if (dt > 0 && e.timeStamp - b.t < 80) startFling(s.el, b.x, b.y, (b.x - a.x) / dt, (b.y - a.y) / dt)
      return
    }
    if (s.wasFling) return
    tap(s.el, e.clientX, e.clientY)
  }
  window.addEventListener('pointerup', function (e) { finish(e, false) }, true)
  window.addEventListener('pointercancel', function (e) { finish(e, true) }, true)
})()

;(function zenSheetHandles () {
  if (window.__zenSheetHandles) return
  window.__zenSheetHandles = true
  var ROOT = '[data-u-comp="workbench-layout"]'
  var SLOP = 8, NUDGE = 6, EDGE = 56, AUTO = 18
  var hs = [], cv = null, cvAt = 0, gm = null, drag = null, hot = 0, why = '', zhDbg = null, DEBUGH = false

  function canvas () {
    var now = performance.now()
    if (cv && cv.isConnected && now - cvAt < 500) return cv
    cvAt = now
    var best = null, ba = 0
    document.querySelectorAll(ROOT + ' canvas').forEach(function (c) {
      var r = c.getBoundingClientRect(), a = r.width * r.height
      if (a > ba) { ba = a; best = c }
    })
    return (cv = best)
  }
  var editFlag = false, hooked = 0, hookedApi = null
  function hook () {
    var api = window.__univerAPI
    if (api !== hookedApi) { hookedApi = api; hooked = 0; editFlag = false }
    if (hooked || !api || !api.addEvent || !api.Event) return
    try {
      var E = api.Event
      if (!E.SheetEditStarted || !E.SheetEditEnded) { hooked = -1; return }
      api.addEvent(E.SheetEditStarted, function () { editFlag = true })
      api.addEvent(E.SheetEditEnded, function () { editFlag = false })
      hooked = 1
    } catch (_) { hooked = -1 }
  }
  function editing () {
    hook()
    if (hooked === 1) return editFlag
    var a = document.activeElement
    if (!a || !(a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return false
    var c = canvas()
    if (!c) return false
    var r = a.getBoundingClientRect(), cr = c.getBoundingClientRect()
    return r.width > 20 && r.height > 10 && r.right > cr.left && r.left < cr.right && r.bottom > cr.top && r.top < cr.bottom
  }
  function geom () {
    var api = window.__univerAPI
    why = ''
    if (!api) { why = 'no api'; return null }
    try {
      var wb = api.getActiveWorkbook()
      if (!wb) { why = 'no workbook'; return null }
      var ws = wb.getActiveSheet()
      var rg = ws.getSelection().getActiveRange()
      var c = canvas()
      if (!rg || !c) { why = 'range=' + !!rg + ' canvas=' + !!c; return null }
      var cr = c.getBoundingClientRect()
      if (cr.width < 50 || cr.height < 50) return null
      var z = (ws.getZoom && ws.getZoom()) || (ws.getSheet && ws.getSheet().getZoomRatio && ws.getSheet().getZoomRatio()) || 1
      var st = ws.getScrollState()
      var a1 = ws.getRange(0, 0, 1, 1).getCellRect()
      var sc = ws.getRange(st.sheetViewStartRow, st.sheetViewStartColumn, 1, 1).getCellRect()
      var r0 = rg.getRow(), c0 = rg.getColumn()
      var r1 = rg.getLastRow ? rg.getLastRow() : r0 + rg.getHeight() - 1
      var c1 = rg.getLastColumn ? rg.getLastColumn() : c0 + rg.getWidth() - 1
      var tl = ws.getRange(r0, c0, 1, 1).getCellRect()
      var br = ws.getRange(r1, c1, 1, 1).getCellRect()
      var sx = function (x) { return cr.left + (x - sc.x + a1.x - st.offsetX) * z }
      var sy = function (y) { return cr.top + (y - sc.y + a1.y - st.offsetY) * z }
      return {
        ws: ws, r0: r0, c0: c0, r1: r1, c1: c1,
        inv: { left: cr.left, top: cr.top, z: z, ox: st.offsetX, oy: st.offsetY, scx: sc.x, scy: sc.y, a1x: a1.x, a1y: a1.y },
        tlx: sx(tl.x), tly: sy(tl.y), brx: sx(br.right), bry: sy(br.bottom),
        tc: { x: sx((tl.x + tl.right) / 2), y: sy((tl.y + tl.bottom) / 2) },
        bc: { x: sx((br.x + br.right) / 2), y: sy((br.y + br.bottom) / 2) },
        cl: cr.left + a1.x * z, ct: cr.top + a1.y * z, cr: cr.right, cb: cr.bottom
      }
    } catch (err) { why = 'err: ' + (err && err.message); return null }
  }
  function inClip (p, g, m) {
    return p.x >= g.cl - m && p.x <= g.cr + m && p.y >= g.ct - m && p.y <= g.cb + m
  }
  function update () {
    var ed = editing()
    gm = ed && !drag ? null : geom()
    if (DEBUGH && document.querySelector(ROOT)) {
      if (!zhDbg) {
        zhDbg = document.createElement('div')
        zhDbg.style.cssText = 'position:fixed;left:4px;bottom:34px;z-index:2147483600;pointer-events:none;' +
          'background:rgba(0,0,0,.75);color:#0f0;font:11px monospace;padding:3px 5px;white-space:pre;max-width:70vw'
        document.body.appendChild(zhDbg)
      }
      var ae = document.activeElement
      zhDbg.textContent = 'H ' + (gm ? 'geom ok' : 'geom null') + ' | ed=' + ed + ' hook=' + hooked + ' | ' + why +
        '\nae ' + (ae ? ae.tagName + '.' + String(ae.className || '').slice(0, 40) + ' ce=' + ae.isContentEditable : '-') +
        (gm ? '\ntl ' + Math.round(gm.tlx) + ',' + Math.round(gm.tly) + ' br ' + Math.round(gm.brx) + ',' + Math.round(gm.bry) +
          '\nclip ' + Math.round(gm.cl) + ',' + Math.round(gm.ct) + ' ' + Math.round(gm.cr) + ',' + Math.round(gm.cb) : '')
    }
    hs.forEach(function (h) {
      if (!gm) { h.el.style.display = 'none'; return }
      var x = h.k === 'tl' ? gm.tlx : gm.brx, y = h.k === 'tl' ? gm.tly : gm.bry
      h.px = x; h.py = y
      if (!drag && !inClip({ x: x, y: y }, gm, 6)) { h.el.style.display = 'none'; return }
      h.el.style.display = 'block'
      h.el.style.left = x + 'px'
      h.el.style.top = y + 'px'
    })
  }
  var last = 0
  function tick (t) {
    var every = drag || t - hot < 600 ? 0 : 150
    if (t - last >= every) { last = t; update() }
    requestAnimationFrame(tick)
  }

  function cellAt (g, px, py) {
    var v = g.inv, ws = g.ws
    var x = (px - v.left) / v.z + v.scx - v.a1x + v.ox
    var y = (py - v.top) / v.z + v.scy - v.a1y + v.oy
    function find (isCol, val, max) {
      var lo = 0, hi = max
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1
        var rc = (isCol ? ws.getRange(0, mid, 1, 1) : ws.getRange(mid, 0, 1, 1)).getCellRect()
        if ((isCol ? rc.x : rc.y) <= val) lo = mid; else hi = mid - 1
      }
      return lo
    }
    try {
      var mr = (ws.getMaxRows ? ws.getMaxRows() : 1000) - 1
      var mc = (ws.getMaxColumns ? ws.getMaxColumns() : 26) - 1
      return { r: find(false, y, mr), c: find(true, x, mc) }
    } catch (_) { return null }
  }
  function applyApi (t) {
    if (!drag) return
    var g = geom()
    if (!g) return
    var cell = cellAt(g, t.x, t.y)
    if (!cell) return
    var r0 = Math.min(drag.fr, cell.r), r1 = Math.max(drag.fr, cell.r)
    var c0 = Math.min(drag.fc, cell.c), c1 = Math.max(drag.fc, cell.c)
    var key = r0 + ',' + c0 + ',' + r1 + ',' + c1
    if (key === drag.lastKey) return
    drag.lastKey = key
    try { g.ws.setActiveRange(g.ws.getRange(r0, c0, r1 - r0 + 1, c1 - c0 + 1)) } catch (_) {}
  }
  window.__zenHeaderEdge = function (px, py) {
    var g = gm || geom()
    var c = canvas()
    if (!g || !c) return false
    var cr = c.getBoundingClientRect(), T = 14
    var inCol = py >= cr.top && py < g.ct && px >= g.cl
    var inRow = px >= cr.left && px < g.cl && py >= g.ct
    if (!inCol && !inRow) return false
    var cell = cellAt(g, inCol ? px : g.cl + 1, inRow ? py : g.ct + 1)
    if (!cell) return false
    var v = g.inv
    try {
      if (inCol) {
        var rc = g.ws.getRange(0, cell.c, 1, 1).getCellRect()
        var a = v.left + (rc.x - v.scx + v.a1x - v.ox) * v.z
        var b = v.left + (rc.right - v.scx + v.a1x - v.ox) * v.z
        return Math.min(Math.abs(px - a), Math.abs(px - b)) < T
      }
      var rr = g.ws.getRange(cell.r, 0, 1, 1).getCellRect()
      var a2 = v.top + (rr.y - v.scy + v.a1y - v.oy) * v.z
      var b2 = v.top + (rr.bottom - v.scy + v.a1y - v.oy) * v.z
      return Math.min(Math.abs(py - a2), Math.abs(py - b2)) < T
    } catch (_) { return false }
  }
  window.__zenGeom = function () { return geom() }
  function ev (type, el, x, y, buttons) {
    var e = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: buttons, clientX: x, clientY: y
    })
    var r = el.getBoundingClientRect()
    try {
      Object.defineProperty(e, 'offsetX', { value: x - r.left })
      Object.defineProperty(e, 'offsetY', { value: y - r.top })
    } catch (_) {}
    el.dispatchEvent(e)
  }
  function wheel (el, x, y, dx, dy) {
    el.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, deltaX: dx, deltaY: dy, deltaMode: 0
    }))
  }
  function target () {
    var g = drag.gm
    var x = drag.fx - drag.ox + drag.n, y = drag.fy - drag.oy + drag.n
    return {
      x: Math.min(Math.max(x, g.cl + 2), g.cr - 2),
      y: Math.min(Math.max(y, g.ct + 2), g.cb - 2)
    }
  }
  function auto () {
    if (!drag) return
    if (drag.started) {
      var g = drag.gm, t = target(), dx = 0, dy = 0
      if (t.x > g.cr - EDGE) dx = Math.min(1, (t.x - (g.cr - EDGE)) / EDGE)
      else if (t.x < g.cl + EDGE) dx = -Math.min(1, (g.cl + EDGE - t.x) / EDGE)
      if (t.y > g.cb - EDGE) dy = Math.min(1, (t.y - (g.cb - EDGE)) / EDGE)
      else if (t.y < g.ct + EDGE) dy = -Math.min(1, (g.ct + EDGE - t.y) / EDGE)
      if (dx || dy) { wheel(drag.cv, t.x, t.y, dx * AUTO, dy * AUTO); if (drag.api) applyApi(t); else ev('pointermove', drag.cv, t.x, t.y, 1) }
    }
    drag.raf = requestAnimationFrame(auto)
  }
  function endDrag (e, cancel) {
    if (!drag || e.pointerId !== drag.id) return
    var d = drag
    drag = null
    cancelAnimationFrame(d.raf)
    if (d.started && !d.api) { var t = target.call(null, (drag = d, d)); drag = null; ev('pointerup', d.cv, t.x, t.y, 0) }
  }

  function mk (k) {
    var el = document.createElement('div')
    el.setAttribute('data-zen-handle', k)
    el.style.cssText = 'position:fixed;z-index:2147482000;width:48px;height:48px;margin:-24px 0 0 -24px;' +
      'display:none;touch-action:none;background:transparent;-webkit-tap-highlight-color:transparent'
    var dot = document.createElement('div')
    dot.style.cssText = 'position:absolute;left:14px;top:14px;width:20px;height:20px;border-radius:50%;' +
      'background:#107c41;border:2px solid #fff;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.45);pointer-events:none'
    el.appendChild(dot)
    document.body.appendChild(el)
    var h = { k: k, el: el, px: 0, py: 0 }
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch' || !gm || drag) return
      var c = canvas()
      var anchor = k === 'tl' ? gm.bc : gm.tc
      if (!c) return
      var useApi = !inClip(anchor, gm, 0)             // jangkar di luar layar: pakai jalur API
      e.preventDefault(); e.stopPropagation()
      try { el.setPointerCapture(e.pointerId) } catch (_) {}
      drag = {
        h: h, id: e.pointerId, cv: c, gm: gm, anchor: anchor, started: false,
        api: useApi, fr: k === 'tl' ? gm.r1 : gm.r0, fc: k === 'tl' ? gm.c1 : gm.c0, lastKey: '',
        x0: e.clientX, y0: e.clientY, fx: e.clientX, fy: e.clientY,
        ox: e.clientX - h.px, oy: e.clientY - h.py, n: k === 'tl' ? NUDGE : -NUDGE, raf: 0
      }
    })
    el.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return
      e.preventDefault(); e.stopPropagation()
      drag.fx = e.clientX; drag.fy = e.clientY
      if (!drag.started) {
        if (Math.hypot(drag.fx - drag.x0, drag.fy - drag.y0) < SLOP) return
        drag.started = true
        try { navigator.vibrate && navigator.vibrate(10) } catch (_) {}
        if (!drag.api) ev('pointerdown', drag.cv, drag.anchor.x, drag.anchor.y, 1)
        drag.raf = requestAnimationFrame(auto)
      }
      var t = target()
      if (drag.api) applyApi(t); else ev('pointermove', drag.cv, t.x, t.y, 1)
    })
    el.addEventListener('pointerup', function (e) { endDrag(e, false) })
    el.addEventListener('pointercancel', function (e) { endDrag(e, true) })
    return h
  }

  function start () {
    hs = [mk('tl'), mk('br')]
    window.addEventListener('wheel', function () { hot = performance.now() }, { passive: true, capture: true })
    requestAnimationFrame(tick)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()

;(function zenSheetKeyboard3 () {
  if (window.__zenSheetKeyboard3) return
  window.__zenSheetKeyboard3 = true
  var ROOT = '[data-u-comp="workbench-layout"]'
  var MARGIN = 48, DEBUGK = false
  var hookedApi = null, flag = false, until = 0, baseH = 0, dbg = null

  function bigCanvas () {
    var best = null, ba = 0
    document.querySelectorAll(ROOT + ' canvas').forEach(function (c) {
      var r = c.getBoundingClientRect(), a = r.width * r.height
      if (a > ba) { ba = a; best = c }
    })
    return best
  }
  function availBottom () {
    var b = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight
    try {
      var pw = window.parent
      if (pw && pw !== window && pw.visualViewport && window.frameElement) {
        var fr = window.frameElement.getBoundingClientRect()
        b = Math.min(b, pw.visualViewport.offsetTop + pw.visualViewport.height - fr.top)
      }
    } catch (_) {}
    return b
  }
  function shrunk () {
    var h = window.innerHeight
    if (h > baseH) baseH = h
    return h < baseH * 0.85
  }
  function say (t) {
    if (!DEBUGK) return
    if (!dbg) {
      dbg = document.createElement('div')
      dbg.style.cssText = 'position:fixed;left:4px;bottom:64px;z-index:2147483600;pointer-events:none;' +
        'background:rgba(0,0,0,.75);color:#0f0;font:11px monospace;padding:3px 5px;white-space:pre;max-width:80vw'
      document.body.appendChild(dbg)
    }
    dbg.textContent = t
  }
  function cellBox (cr) {
    var a = document.activeElement
    if (a && (a.isContentEditable || a.tagName === 'TEXTAREA')) {
      var r = a.getBoundingClientRect()
      if (r.width > 20 && r.height > 8 && r.bottom > cr.top && r.top < cr.bottom && r.right > cr.left && r.left < cr.right) {
        return { top: r.top, bottom: r.bottom, src: 'ed' }
      }
    }
    var g = window.__zenGeom && window.__zenGeom()
    if (g) return { top: g.tly, bottom: g.bry, src: 'api' }
    return null
  }
  function ensure () {
    var cv = bigCanvas()
    if (!cv) { say('K no canvas'); return }
    var cr = cv.getBoundingClientRect()
    var box = cellBox(cr)
    if (!box) { say('K no cell'); return }
    var ab = availBottom()
    var bottom = Math.min(ab, cr.bottom), topEdge = cr.top + 40
    var dy = 0
    if (box.bottom + MARGIN > bottom) dy = box.bottom + MARGIN - bottom
    else if (box.top < topEdge) dy = box.top - topEdge
    say('K src=' + box.src + ' flag=' + flag + ' shrunk=' + shrunk() + ' h=' + window.innerHeight + '/' + baseH +
      '\nab=' + Math.round(ab) + ' cb=' + Math.round(cr.bottom) + ' cell=' + Math.round(box.top) + '-' + Math.round(box.bottom) +
      ' dy=' + Math.round(dy))
    if (!(flag || shrunk()) || Math.abs(dy) < 2) return
    dy = Math.max(-400, Math.min(400, dy))
    cv.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, composed: true,
      clientX: cr.left + cr.width / 2, clientY: cr.top + cr.height / 2, deltaX: 0, deltaY: dy, deltaMode: 0
    }))
  }
  function bump (ms) { until = Math.max(until, Date.now() + ms) }
  function hook () {
    var api = window.__univerAPI
    if (!api || api === hookedApi || !api.addEvent || !api.Event) return
    var E = api.Event
    if (!E.SheetEditStarted || !E.SheetEditEnded) return
    try {
      api.addEvent(E.SheetEditStarted, function () { flag = true; bump(4000) })
      api.addEvent(E.SheetEditEnded, function () { flag = false; until = 0; if (dbg) dbg.textContent = '' })
      hookedApi = api
    } catch (_) {}
  }
  function start () {
    baseH = window.innerHeight
    setInterval(hook, 600)
    setInterval(function () { if (Date.now() < until) ensure() }, 150)
    var rs = function () { bump(2500) }
    window.addEventListener('resize', rs)
    if (window.visualViewport) window.visualViewport.addEventListener('resize', rs)
    try { window.parent.visualViewport.addEventListener('resize', rs) } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
;(function zenFeel () {
  if (window.__zenFeel) return
  if (!/\/sheets\//.test(location.pathname)) return
  window.__zenFeel = true
  var ROOT = '[data-u-comp="workbench-layout"]'
  var css = document.createElement('style')
  css.textContent =
    'html,body{touch-action:manipulation;overscroll-behavior:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}' +
    ROOT + '{overscroll-behavior:none}' +
    ROOT + ' :not([contenteditable]):not([contenteditable] *):not(input):not(textarea){-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}'
  ;(document.head || document.documentElement).appendChild(css)
})()
