// Builds the browser-side PDF toolkit used by the Android PDF/Docs tabs.
// Run from the repository root after `npm ci`; build-web.mjs invokes it too.

import { build } from 'esbuild'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const mobileDir = resolve(here, '..')
const repoRoot = resolve(mobileDir, '..')
const outfile = join(mobileDir, 'www/shim/pdf-tools.js')
const browserDir = join(mobileDir, 'pdf-tools/src/browser')

const browserModules = new Map([
  ['./annot-delete', join(browserDir, 'annot-delete.ts')],
  ['./text-edit', join(browserDir, 'text-edit.ts')],
  ['./image-edit', join(browserDir, 'image-edit.ts')],
  ['./redaction', join(browserDir, 'redaction.ts')],
  ['./atomic-write', join(browserDir, 'atomic-write.ts')],
])

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
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'genoffice-pdf-mobile',
      setup(build) {
        build.onResolve({ filter: /^node:fs\/promises$/ }, () => ({
          path: 'node-fs-stub',
          namespace: 'genoffice-empty',
        }))
        build.onLoad({ filter: /.*/, namespace: 'genoffice-empty' }, () => ({
          contents: 'export async function readFile() { throw new Error("Node fs is not available in the browser") }',
          loader: 'js',
        }))
        build.onResolve({ filter: /^\.\/(annot-delete|text-edit|image-edit|redaction|atomic-write)$/ }, (args) => {
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
