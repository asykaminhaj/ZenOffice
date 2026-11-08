import { useEffect, useRef, useState } from 'react'
import { IconComments, IconEye, IconPencil, IconSearch, IconTrackChanges } from './icons'

type Mode = 'editing' | 'reviewing' | 'viewing'

interface Props {
  hasDoc: boolean
  readMode: boolean
  trackChanges: boolean
  trackChangesForced: boolean
  getText: () => string
  getDocx?: () => Promise<{ bytes: Uint8Array; name: string } | null>
  onFind: () => void
  onComments: () => void
  onTrackChanges: (on: boolean) => void
  onReadMode: (on: boolean) => void
}

function IconShareArrow({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.5 2.5 14 6.8 9.5 11V8.6C6.3 8.5 4.2 9.7 2.8 12.6 3.1 8.6 5.4 6 9.5 5.7z" />
    </svg>
  )
}

function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 3.5 5 6.5 8 3.5" />
    </svg>
  )
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function toBase64(bytes: Uint8Array): string {
  let s = ''
  const C = 0x2000
  for (let i = 0; i < bytes.length; i += C) s += String.fromCharCode(...bytes.subarray(i, i + C))
  return btoa(s)
}

const MODE_LABEL: Record<Mode, string> = { editing: 'Editing', reviewing: 'Reviewing', viewing: 'Viewing' }

/** Android-only top-right actions (Search / Comments / Editing mode / Share). */
export function ZenTopActions(p: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const mode: Mode = p.readMode ? 'viewing' : p.trackChanges ? 'reviewing' : 'editing'

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])

  const pick = (m: Mode) => {
    setOpen(false)
    if (m === 'viewing') {
      p.onReadMode(true)
      return
    }
    p.onReadMode(false)
    if (!p.trackChangesForced) p.onTrackChanges(m === 'reviewing')
  }

  const share = async () => {
    const native = (window as unknown as {
      __zenNative?: { call: (m: string, a?: object) => Promise<unknown> }
    }).__zenNative
    if (!native) return
    if (p.getDocx) {
      try {
        const f = await p.getDocx()
        if (f && f.bytes.byteLength > 0) {
          await native.call('shareFile', { data: toBase64(f.bytes), name: f.name, mime: DOCX_MIME })
          return
        }
      } catch {
        /* fall back to sharing the text */
      }
    }
    const text = p.getText()
    if (!text.trim()) return
    native.call('share', { text }).catch(() => {})
  }

  const modeIcon = mode === 'viewing' ? <IconEye size={16} /> : mode === 'reviewing' ? <IconTrackChanges size={16} /> : <IconPencil size={16} />

  return (
    <div className="zen-top">
      <button className="zen-pill" disabled={!p.hasDoc} onClick={p.onFind} aria-label="Search">
        <IconSearch size={16} />
        <span>Search</span>
      </button>
      <button className="zen-pill" disabled={!p.hasDoc} onClick={p.onComments} aria-label="Comments">
        <IconComments size={16} />
        <span>Comments</span>
      </button>
      <div className="zen-dd" ref={wrapRef}>
        <button className="zen-pill" disabled={!p.hasDoc} onClick={() => setOpen((v) => !v)} aria-label="Editing mode" aria-expanded={open}>
          {modeIcon}
          <span>{MODE_LABEL[mode]}</span>
          <Chevron />
        </button>
        {open && (
          <div className="zen-menu" role="menu">
            {(['editing', 'reviewing', 'viewing'] as Mode[]).map((m) => (
              <button key={m} role="menuitem" className={m === mode ? 'on' : ''} onClick={() => pick(m)}
                disabled={m === 'editing' && p.trackChangesForced && false}>
                {m === 'viewing' ? <IconEye size={16} /> : m === 'reviewing' ? <IconTrackChanges size={16} /> : <IconPencil size={16} />}
                <span>{MODE_LABEL[m]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="zen-pill zen-share" disabled={!p.hasDoc} onClick={share} aria-label="Share">
        <IconShareArrow size={16} />
        <span>Share</span>
      </button>
    </div>
  )
}
