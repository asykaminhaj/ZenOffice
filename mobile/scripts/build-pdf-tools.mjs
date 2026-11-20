// Builds the browser-side PDF toolkit used by the Android PDF/Docs tabs.
// Run from the repository root after `npm ci`; build-web.mjs invokes it too.

import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const mobileDir = resolve(here, '..')
const repoRoot = resolve(mobileDir, '..')
const outfile = join(mobileDir, 'www/shim/pdf-tools.js')
const browserDir = join(mobileDir, 'pdf-tools/src/browser')

const shimDir = dirname(outfile)

// Desktop main-process modules that need Electron or the host OS. text-edit,
// redaction and annot-delete are NOT listed: they run unchanged on PDFium wasm.
const browserModules = new Map([
  ['./image-edit', join(browserDir, 'image-edit.ts')],
  ['./atomic-write', join(browserDir, 'atomic-write.ts')],
  ['./wasm-path', join(browserDir, 'wasm-path.ts')],
  ['./font-locate', join(browserDir, 'font-locate.ts')],
])

// Node built-ins the PDFium modules import, mapped to in-browser replacements.
const nodeModules = new Map([
  ['node:fs', join(browserDir, 'node-fs.ts')],
  ['node:fs/promises', join(browserDir, 'node-fs.ts')],
  ['node:crypto', join(browserDir, 'node-crypto.ts')],
])

// Runtime assets fetched by pdf-tools/src/browser/assets.ts.
const rootRequire = createRequire(join(repoRoot, 'package.json'))
mkdirSync(join(shimDir, 'fonts'), { recursive: true })
copyFileSync(rootRequire.resolve('@embedpdf/pdfium/pdfium.wasm'), join(shimDir, 'pdfium.wasm'))
copyFileSync(
  join(dirname(rootRequire.resolve('harfbuzzjs')), 'harfbuzz-subset.wasm'),
  join(shimDir, 'hb-subset.wasm'),
)
const standardFonts = join(dirname(rootRequire.resolve('pdfjs-dist/package.json')), 'standard_fonts')
for (const name of [
  'LiberationSans-Regular.ttf',
  'LiberationSans-Bold.ttf',
  'LiberationSans-Italic.ttf',
  'LiberationSans-BoldItalic.ttf',
  'LICENSE_LIBERATION',
]) {
  copyFileSync(join(standardFonts, name), join(shimDir, 'fonts', name))
}

await build({
  entryPoints: [join(mobileDir, 'pdf-tools/src/entry.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"',
    // Emscripten resolves pdfium.wasm against import.meta.url, which an IIFE has no
    // value for. The binary is passed in as wasmBinary, so the URL is never fetched.
    'import.meta.url': '"https://localhost/shim/pdf-tools.js"',
  },
  // pdf-lib/PDFium helpers use Node's Buffer API (readUInt16BE, utf16le, latin1).
  inject: [join(browserDir, 'buffer-global.ts')],
  // buffer / @noble/hashes are mobile devDependencies.
  nodePaths: [join(mobileDir, 'node_modules')],
  plugins: [
    {
      name: 'genoffice-pdf-mobile',
      setup(build) {
        build.onResolve({ filter: /^node:(fs|fs\/promises|crypto)$/ }, (args) => ({
          path: nodeModules.get(args.path),
        }))
        build.onResolve({ filter: /^@genoffice\/font-metrics$/ }, () => ({
          path: join(browserDir, 'font-locate.ts'),
        }))
        build.onResolve({ filter: /^\.\/(image-edit|atomic-write|wasm-path|font-locate)$/ }, (args) => {
          const mapped = browserModules.get(args.path)
          // Only replace the copies imported by the desktop PDF main module.
          if (!mapped || !args.importer.includes('/apps/pdf/src/main/')) return null
          return { path: mapped }
        })
      },
    },
  ],
  logLevel: 'info',
})

console.log(`Built ${outfile}`)
