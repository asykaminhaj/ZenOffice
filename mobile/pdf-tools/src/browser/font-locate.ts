/**
 * Android replacement for the desktop installed-font index. The WebView cannot
 * read /system/fonts, so the only faces available are the ones bundled with
 * the app (Liberation Sans, registered by assets.ts). The desktop fallback
 * lists already try those paths first through readFileSync.
 */
import type { Buffer } from 'buffer'
import { readFileSync } from './node-fs'
import { fontCoversText } from '../../../../apps/pdf/src/main/font-cmap'
import { BUNDLED_FONT_PATHS } from './assets'

const OTTO_TAG = 0x4f54544f

export const isTruetype = (b: Buffer): boolean => b.length >= 4 && b.readUInt32BE(0) !== OTTO_TAG

function bundled(): Buffer[] {
  const out: Buffer[] = []
  for (const p of BUNDLED_FONT_PATHS) {
    try {
      out.push(readFileSync(p))
    } catch {
      /* not loaded */
    }
  }
  return out
}

export function findSystemFont(psName: string, family: string): Buffer | null {
  const want = `${psName} ${family}`.toLowerCase()
  if (!/arial|helvetica|liberation ?sans|sans/.test(want)) return null
  return bundled()[0] ?? null
}

export function findFontCovering(text: string): Buffer | null {
  const drawn = text.replace(/[\r\n]/g, '')
  if (!drawn) return null
  for (const face of bundled()) {
    if (fontCoversText(face as never, drawn)) return face
  }
  return null
}
