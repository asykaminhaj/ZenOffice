/**
 * Bundles the desktop Slides main process + preload bridge into one browser
 * script. Electron, Node fs and native-only services are replaced with small
 * browser shims; the real pptx engine, op executor and render layer stay real.
 */
import { build } from 'esbuild'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const mobileDir = resolve(here, '..')
const root = resolve(mobileDir, '..')
const hostDir = join(mobileDir, 'slides-host', 'src')
const stubDir = join(hostDir, 'stubs')
const outfile = join(mobileDir, 'www', 'shim', 'slides-host.js')

const nodeShims = {
  'node:fs': 'node-fs.ts',
  'node:fs/promises': 'node-fs-promises.ts',
  'node:path': 'node-path.ts',
  'node:crypto': 'node-crypto.ts',
  'node:zlib': 'node-zlib.ts',
  'node:os': 'node-os.ts',
  'node:child_process': 'node-child-process.ts',
  'node:buffer': 'node-buffer.ts',
  'node:stream': 'node-stream.ts',
  'node:stream/promises': 'node-stream-promises.ts',
  'node:util': 'node-util.ts',
  'node:worker_threads': 'node-worker-threads.ts',
}

const packageShims = {
  '@genoffice/electron-utils': 'stubs/electron-utils.ts',
  '@genoffice/electron-utils/atomic-write': 'stubs/atomic-write.ts',
  '@genoffice/electron-utils/drop-open': 'stubs/drop-open.ts',
  '@genoffice/electron-utils/main-proxy': 'stubs/electron-utils-main-proxy.ts',
  '@genoffice/electron-utils/font-store': 'stubs/font-store.ts',
  '@genoffice/electron-utils/font-catalog': 'stubs/electron-utils-font-catalog.ts',
  '@genoffice/pipelines/slides': 'stubs/pipelines-slides.ts',
  '@genoffice/ai-search': 'stubs/ai-search.ts',
  '@genoffice/project-store': 'stubs/project-store.ts',
  '@genoffice/i18n': 'stubs/i18n.ts',
  '@genoffice/file-parse': 'stubs/file-parse.ts',
  '@genoffice/agent-core/redact-range': 'stubs/redact-range.ts',
  '@genoffice/docx-engine/math': 'stubs/docx-math.ts',
}

const localShims = new Set([
  'ai-ipc',
  'presenter-show',
  'attachments-ipc',
  'pdf-export',
  'print-window',
  'generated-page-temp',
  'fonts',
  'font-store',
  'shaped-metrics',
  'metafile-fonts',
  'tiff-decode',
  'jpeg-orientation',
  'element-clipboard',
  'i18n-main',
])

const shimPlugin = {
  name: 'android-slides-shims',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^node:/ }, (args) => {
      const file = nodeShims[args.path]
      if (file) return { path: join(hostDir, file) }
      return { path: args.path, external: true }
    })
    buildApi.onResolve({ filter: /^electron$/ }, () => ({
      path: join(hostDir, 'electron-stub.ts'),
    }))
    buildApi.onResolve({ filter: /^buffer$/ }, () => ({
      path: join(mobileDir, 'node_modules/buffer/index.js'),
    }))
    buildApi.onResolve({ filter: /\/op-docs(?:\.ts)?$/ }, () => ({
      path: join(stubDir, 'pptx-ops-docs.ts'),
    }))
    buildApi.onResolve({ filter: /^@genoffice\/pptx-engine$/ }, () => ({
      path: join(hostDir, 'pptx-engine-wrap.ts'),
    }))
    buildApi.onResolve({ filter: /^@genoffice\/electron-utils(?:\/|$)/ }, (args) => {
      const file = packageShims[args.path] || 'stubs/electron-utils.ts'
      return { path: join(hostDir, file) }
    })
    buildApi.onResolve({ filter: /^@genoffice\// }, (args) => {
      const file = packageShims[args.path]
      return file ? { path: join(hostDir, file) } : null
    })
    buildApi.onResolve({ filter: /^packages\/odf2ooxml\/src/ }, () => ({
      path: join(stubDir, 'odf2ooxml.ts'),
    }))
    buildApi.onResolve({ filter: /^\.\/([a-z0-9-]+)$/ }, (args) => {
      const name = args.path.slice(2)
      if (!localShims.has(name)) return null
      return { path: join(stubDir, `${name}.ts`) }
    })
  },
}

mkdirSync(dirname(outfile), { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: [join(hostDir, 'entry.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100'],
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [shimPlugin],
  inject: [
    join(hostDir, 'inject-buffer.ts'),
    join(hostDir, 'inject-process.ts'),
    join(hostDir, 'inject-global.ts'),
    join(hostDir, 'inject-setimmediate.ts'),
  ],
  define: {
    __dirname: '""',
    __filename: '""',
    'process.env.NODE_ENV': '"production"',
  },
  loader: {
    '.png': 'dataurl',
    '.jpg': 'dataurl',
    '.jpeg': 'dataurl',
    '.gif': 'dataurl',
    '.webp': 'dataurl',
    '.svg': 'dataurl',
    '.ttf': 'dataurl',
    '.otf': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
  },
})
console.log(`slides host written to ${outfile}`)
