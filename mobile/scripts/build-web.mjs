// Builds every GenOffice renderer as a plain web app (no Electron) into mobile/www/<app>/,
// injects the Android shim into each page, and copies the desktop-style shell to mobile/www.
//
// Run from the repository root after `npm ci`:  node mobile/scripts/build-web.mjs [app ...]

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const mobileDir = resolve(here, '..')
const repoRoot = resolve(mobileDir, '..')
const wwwDir = join(mobileDir, 'www')

const APPS = [
  { id: 'docs', title: 'Docs', subtitle: 'Word documents (.docx)', color: '#3276cd' },
  { id: 'sheets', title: 'Sheets', subtitle: 'Spreadsheets (.xlsx, .csv)', color: '#4fa16b' },
  { id: 'slides', title: 'Slides', subtitle: 'Presentations (.pptx)', color: '#d33922' },
  { id: 'pdf', title: 'PDF', subtitle: 'PDF documents', color: '#ef4444' },
  { id: 'markdown', title: 'Markdown', subtitle: 'Notes (.md, .txt)', color: '#8b5cf6' },
  { id: 'html', title: 'HTML', subtitle: 'HTML pages (.html)', color: '#0fa3a3' },
]

const requested = process.argv.slice(2)
const selected = requested.length ? APPS.filter((a) => requested.includes(a.id)) : APPS
if (selected.length === 0) {
  console.error(`Unknown app(s): ${requested.join(', ')}. Known: ${APPS.map((a) => a.id).join(', ')}`)
  process.exit(1)
}

rmSync(wwwDir, { recursive: true, force: true })
mkdirSync(wwwDir, { recursive: true })
cpSync(join(mobileDir, 'shim'), join(wwwDir, 'shim'), { recursive: true })
// pdf-lib toolkit shared by the PDF editor and Docs' mixed-paper merge path.
if (selected.some((a) => a.id === 'pdf' || a.id === 'docs')) {
  console.log('\n=== building pdf toolkit ===')
  execFileSync('node', [join(here, 'build-pdf-tools.mjs')], { cwd: repoRoot, stdio: 'inherit' })
}
// SheetJS is a classic script so the pre-renderer shim can parse/write .xlsx.
cpSync(
  join(mobileDir, 'node_modules/xlsx/dist/xlsx.full.min.js'),
  join(wwwDir, 'shim/xlsx.full.min.js'),
)
// ExcelJS is loaded lazily by the shim on save: it round-trips the workbook's
// styles, number formats and untouched parts that SheetJS CE cannot write.
cpSync(
  join(mobileDir, 'node_modules/exceljs/dist/exceljs.min.js'),
  join(wwwDir, 'shim/exceljs.min.js'),
)
// JSZip is needed for PDF conversion to docx/pptx (creating zip-based formats).
cpSync(
  join(mobileDir, 'node_modules/jszip/dist/jszip.min.js'),
  join(wwwDir, 'shim/jszip.min.js'),
)
// ZenOffice ribbon skin (Docs only, linked in the html below).
cpSync(join(mobileDir, 'shim/zen-ribbon.css'), join(wwwDir, 'shim/zen-ribbon.css'))
cpSync(join(mobileDir, 'shim/zen-card.css'), join(wwwDir, 'shim/zen-card.css'))
cpSync(join(mobileDir, 'shim/zen-tab-anim.js'), join(wwwDir, 'shim/zen-tab-anim.js'))
cpSync(join(mobileDir, 'shim/zen-card-fit.css'), join(wwwDir, 'shim/zen-card-fit.css'))
for (const f of ['zen-ico.css', 'zen-pal-markdown.css', 'zen-pal-html.css', 'zen-pal-slides.css', 'zen-pal-sheets.css', 'zen-pal-pdf.css']) cpSync(join(mobileDir, 'shim/' + f), join(wwwDir, 'shim/' + f))
// Slides needs the real deck engine. Its desktop main process is bundled with
// Electron and Node shims so .pptx parsing, editing, rendering and saving all
// run locally in the WebView.
if (selected.some((a) => a.id === 'slides')) {
  execFileSync(process.execPath, [join(here, 'build-slides-host.mjs')], {
    stdio: 'inherit',
    cwd: repoRoot,
  })
}

const built = []
const failed = []

/**
 * The desktop pages get their CSP from the renderer HTML. Two Electron-only
 * schemes have to be widened for the WebView:
 *   - Docs fetches the one-shot docx handoff from a blob: URL.
 *   - HTML embeds its preview page from this origin (the desktop uses
 *     html-preview:), so frame-src needs 'self'.
 */
function addCspSource(html, directive, source) {
  return html.replace(
    /(http-equiv=["']Content-Security-Policy["'][\s\S]*?content=)(["'])([\s\S]*?)\2/i,
    (match, before, quote, policy) => {
      const parts = policy
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
      let found = false
      const next = parts.map((part) => {
        const [name, ...values] = part.split(/\s+/)
        if (name.toLowerCase() !== directive) return part
        found = true
        return values.includes(source) ? part : [name, ...values, source].join(' ')
      })
      if (!found) next.push(`${directive} ${source}`)
      return before + quote + next.join('; ') + quote
    },
  )
}

for (const app of selected) {
  const appDir = join(repoRoot, 'apps', app.id)
  const outDir = join(wwwDir, app.id)
  console.log(`\n=== building ${app.id} ===`)
  try {
    // vite.renderer.config.ts sets root: src/renderer; --base ./ keeps asset URLs relative
    // so the pages work from https://localhost/<app>/ inside the WebView.
    execFileSync(
      'npx',
      ['vite', 'build', '--config', 'vite.renderer.config.ts', '--base', './', '--outDir', outDir, '--emptyOutDir'],
      { cwd: appDir, stdio: 'inherit' },
    )
    const indexPath = join(outDir, 'index.html')
    if (!existsSync(indexPath)) throw new Error('no index.html in build output')
    let html = readFileSync(indexPath, 'utf8')
    if (app.id === 'docs') html = addCspSource(html, 'connect-src', 'blob:')
    if (app.id === 'html') html = addCspSource(html, 'frame-src', "'self'")
    // The WebView must not apply its own page zoom: pinch is translated into
    // Ctrl+wheel events so the individual editors can keep their zoom models.
    html = html.replace(
      /<meta\s+name=["']viewport["'][^>]*>/i,
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />',
    )
    const tag = [
      ...((app.id === 'sheets' || app.id === 'pdf') ? ['<script src="../shim/xlsx.full.min.js"></script>'] : []),
      ...(app.id === 'slides' ? ['<script src="../shim/slides-host.js"></script>'] : []),
      ...(app.id === 'pdf' || app.id === 'docs'
        ? ['<script src="../shim/pdf-tools.js"></script>']
        : []),
      ...(app.id === 'pdf' ? ['<script src="../shim/jszip.min.js"></script>'] : []),
      '<script src="../shim/android-shim.js"></script>',
      '<script src="../shim/touch-zoom.js" defer></script>',
      '<link rel="icon" href="data:," />',
    ].join('\n    ')
    html = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${tag}`)
      : `${tag}\n${html}`
    // Remove crossorigin from module scripts - Capacitor's local server doesn't send CORS headers
    html = html.replace(/\scrossorigin="anonymous"/gi, '')
    if (app.id === 'docs') html = html.replace('</head>', '    <link rel="stylesheet" href="../shim/zen-ribbon.css" />\n  </head>')
    if (['slides', 'sheets', 'pdf', 'markdown', 'html'].includes(app.id)) html = html.replace('</head>', '    <link rel="stylesheet" href="../shim/zen-card.css" />\n    <script src="../shim/zen-tab-anim.js" defer></script>\n  </head>')
    if (['markdown', 'html'].includes(app.id)) html = html.replace('</head>', '    <link rel="stylesheet" href="../shim/zen-card-fit.css" />\n  </head>')
    if (['markdown', 'html', 'slides', 'sheets', 'pdf'].includes(app.id)) html = html.replace('</head>', '    <link rel="stylesheet" href="../shim/zen-ico.css" />\n    <link rel="stylesheet" href="../shim/zen-pal-' + app.id + '.css" />\n  </head>')
    writeFileSync(indexPath, html)
    built.push(app)
  } catch (err) {
    console.error(`!! ${app.id} failed: ${err.message}`)
    failed.push(app.id)
  }
}

// The launcher is now a real shell: Chrome-style document tabs, a desktop-like
// home, recent files and a tab host for the same-origin renderers.
cpSync(join(mobileDir, 'shell'), wwwDir, { recursive: true })

console.log(`\nBuilt: ${built.map((a) => a.id).join(', ') || '(none)'}`)
if (failed.length) {
  console.error(`Failed: ${failed.join(', ')}`)
  process.exit(built.length ? 0 : 1) // partial success still produces a usable APK
}
