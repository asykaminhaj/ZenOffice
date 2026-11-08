import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'

/** CSS floats: the only layout where a paragraph's vertical position changes its line breaks */
// wrap-around floats the paragraphs flow beside (explicit classes: an
// attribute-substring selector scanned the whole editor on every keystroke)
const FLOAT_SELECTOR = [
  ...['square', 'tight', 'through'].flatMap((mode) =>
    ['left', 'right'].flatMap((side) => [
      `.img-wrap-${mode}-${side}`,
      `.doc-inline-img--wrap-${mode}-${side}`,
    ]),
  ),
  '.doc-table-float-left',
  '.doc-table-float-right',
  '.doc-table-float-center',
  '.doc-cell-boxes',
].join(', ')

/** float bands of one editor state, shared by every cache measuring against it */
const floatBandsByState = new WeakMap<object, number[][]>()
/** the float elements of the last scan of one editor; null once a transaction may have added one */
let floatScan: { dom: Element; els: Element[] } | null = null

/** Only a transaction that inserts something other than text can add a float:
 *  plain typing keeps the element list and re-reads the boxes. */
export function noteFloatTransaction(tr: Transaction): void {
  if (!floatScan || !tr.docChanged) return
  for (const step of tr.steps) {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) continue
    if (step instanceof ReplaceStep && step.slice.openStart === 0 && step.slice.openEnd === 0) {
      let text = true
      step.slice.content.forEach((n) => {
        if (!n.isText) text = false
      })
      if (text) continue
    }
    floatScan = null
    return
  }
}

function floatBandsOf(view: EditorView): number[][] {
  const state = (view as { state?: object }).state
  const cached = state && floatBandsByState.get(state)
  if (cached) return cached
  if (!floatScan || floatScan.dom !== view.dom || floatScan.els.some((f) => !f.isConnected))
    floatScan = { dom: view.dom, els: Array.from(view.dom.querySelectorAll(FLOAT_SELECTOR)) }
  // a floating table the paginator flows in place (doc-table-float-flow, a
  // decoration class) is not a float for this pass
  const bands = floatScan.els
    .filter((f) => !f.classList.contains('doc-table-float-flow'))
    .map((f) => {
      const r = f.getBoundingClientRect()
      const cs = getComputedStyle(f)
      return [
        r.top - (parseFloat(cs.marginTop) || 0),
        r.bottom + (parseFloat(cs.marginBottom) || 0),
      ]
    })
  if (state) floatBandsByState.set(state, bands)
  return bands
}

/**
 * Run a paragraph measurement against its natural wrap. The paginator's
 * inline page-gap widget forces a line break at the previous pass's cut, so
 * a decision read with it in layout depends on when that pass ran relative
 * to this one (two orders, two page counts); hidden, the paragraph wraps as
 * the paginator itself measures it (its measuring-natural state).
 */
export function measureNatural<T>(el: HTMLElement, fn: () => T): T {
  const gaps = el.querySelectorAll<HTMLElement>('.page-gap-inline')
  if (gaps.length === 0) return fn()
  const prev = Array.from(gaps, (g) => g.style.display)
  gaps.forEach((g) => (g.style.display = 'none'))
  try {
    return fn()
  } finally {
    gaps.forEach((g, i) => (g.style.display = prev[i]))
  }
}

/** Android shim only: skip the hide/restore of page gaps while a settled paragraph's visible box is unchanged */
function fastGapPath(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as { __genofficeAndroidShim?: boolean; __zenNoFastGap?: boolean }
  return w.__genofficeAndroidShim === true && w.__zenNoFastGap !== true
}

const DEFER_MAX_MS = 1200

/** Android shim, opt-in (window.__zenDeferMeasure): a short plain-text edit inside one textblock.
 *  Its decorations map through the edit; the measure runs once typing pauses. */
export function deferTypingMeasure(prev: EditorState, next: EditorState): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { __genofficeAndroidShim?: boolean; __zenDeferMeasure?: boolean }
  if (w.__genofficeAndroidShim !== true || w.__zenDeferMeasure !== true) return false
  const a = prev.doc
  const b = next.doc
  const start = a.content.findDiffStart(b.content)
  if (start === null) return false
  const end = a.content.findDiffEnd(b.content)
  if (!end) return false
  let endA = end.a
  let endB = end.b
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  if (endA - start > 40 || endB - start > 40) return false
  const ra = a.resolve(start)
  const rb = b.resolve(start)
  if (!ra.parent.isTextblock || !rb.parent.isTextblock) return false
  if (endA > ra.end() || endB > rb.end()) return false
  const plain = (t: string) => !/[\t\n\uFFFC]/.test(t)
  return (
    plain(a.textBetween(start, endA, '\n', '\uFFFC')) &&
    plain(b.textBetween(start, endB, '\n', '\uFFFC'))
  )
}

/** debounce (window.__zenDeferMs, default 400) with a hard cap so long typing still measures */
export class DeferredMeasure {
  private timer = 0
  private first = 0
  constructor(private run: () => void) {}
  schedule(): void {
    const w = window as unknown as { __zenDeferMs?: number }
    const ms = typeof w.__zenDeferMs === 'number' ? w.__zenDeferMs : 400
    const now = performance.now()
    if (this.timer) window.clearTimeout(this.timer)
    else this.first = now
    const wait = Math.max(0, Math.min(ms, DEFER_MAX_MS - (now - this.first)))
    this.timer = window.setTimeout(() => {
      this.timer = 0
      this.run()
    }, wait)
  }
  cancel(): void {
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = 0
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** TEMP probe (Android shim + window.__zenStatOn): why paragraphs are re-measured */
const zsOn = (): boolean => {
  if (typeof window === 'undefined') return false
  const w = window as any
  return w.__genofficeAndroidShim === true && w.__zenStatOn === true
}
const zsRoot = (): any => {
  const w = window as any
  return (w.__zenStat ??= { passes: [], clears: 0, clearAt: '' })
}
const zsCur = (): any => {
  const r = zsRoot()
  return r.passes[r.passes.length - 1] ?? { samples: [] }
}
let zsN = 0

interface Entry<T> {
  /** paragraph start when measured; results are stored at that offset */
  pos: number
  /** position-independent identity of the result */
  key: string
  rectKey: string
  result: T
  settled: boolean
  /** distinct results seen so far */
  rounds: number
  /** last pass that visited the paragraph (unvisited entries are pruned) */
  gen: number
  /** box with page gaps visible, read before any style write (Android fast path) */
  visKey?: string
}

/**
 * A paragraph whose compression re-wraps its own lines can answer differently
 * every round without ever repeating itself. Each answer fits the lines it
 * was measured against, so after this many the last one stays; otherwise the
 * whole document re-measures every unsettled paragraph on every round until
 * the loop's signature cap freezes it (12 rounds on a 6k-paragraph document).
 */
export const MAX_PARA_ROUNDS = 3

/**
 * Per-paragraph result cache for the measure → decorate → re-measure loops of
 * the shrink extensions. The loop re-enters synchronously, so only the
 * extension's own decorations change between passes: a paragraph whose last
 * two results agree and whose box is unchanged would measure the same again,
 * and the costly per-word/per-char DOM walk is skipped.
 *
 * Entries key on the paragraph node's identity, so an edit elsewhere in the
 * document keeps every untouched paragraph's settled result (ProseMirror
 * shares unchanged nodes across states); only its positions shift, which
 * `shift` re-bases. Callers clear() when layout inputs change (resize, font
 * load, document stylesheet).
 */
export class SettledParagraphCache<T> {
  private results = new Map<ProseMirrorNode, Entry<T>>()
  private floatBands: number[][] = []
  private gen = 0
  /** Android shim: every page gap is hidden for a whole batched cold pass (see batchGaps) */
  private gapsHidden = false
  private batchN = 0
  private batchSamples: Array<{
    el: HTMLElement
    mp: (el: HTMLElement) => T | null
    result: T | null
  }> = []

  /**
   * @param shift re-bases a stored result to a paragraph that moved by delta
   * @param stableNow a result that changes nothing about the paragraph's
   *   own decorations (nothing to shrink) cannot alter its layout, so it is
   *   settled after a single pass
   */
  constructor(
    private shift: (result: T, delta: number) => T,
    private stableNow: (result: T) => boolean = () => false,
  ) {}

  private zid = ++zsN
  /** measure with page gaps visible on a miss (no measureNatural); default off */
  visibleMeasure = false

  clear(): void {
    if (zsOn()) {
      const r = zsRoot()
      r.clears++
      r.clearAt = (new Error().stack || '').split('\n').slice(2, 5).join(' < ').slice(0, 300)
    }
    this.results.clear()
  }

  /** once per pass: vertical bands beside which text wraps; drops paragraphs the previous pass never visited */
  beginPass(view: EditorView): void {
    this.gen++
    let zDel = 0
    for (const [node, entry] of this.results)
      if (entry.gen < this.gen - 1) {
        this.results.delete(node)
        zDel++
      }
    if (zsOn())
      zsRoot().passes.push({ c: this.zid, size: this.results.size, deleted: zDel, paras: 0, fast: 0, hit: 0, noEntry: 0, unsettled: 0, keyDiff: 0, nullRes: 0, samples: [] })
    this.floatBands = floatBandsOf(view)
  }

  /**
   * Top-level block nodes → their DOM, read off ProseMirror's view descriptors
   * in one walk; view.nodeDOM(pos) descends through every top-level block for
   * each call, which made a pass over N paragraphs cost N².
   */
  static topLevelDom(view: EditorView): Map<ProseMirrorNode, HTMLElement> {
    const map = new Map<ProseMirrorNode, HTMLElement>()
    for (const child of Array.from(view.dom.childNodes)) {
      const desc = (child as { pmViewDesc?: { node?: ProseMirrorNode } }).pmViewDesc
      if (desc?.node && child instanceof HTMLElement) map.set(desc.node, child)
    }
    return map
  }

  /**
   * Android shim, cold passes: hide every page gap once for the whole pass (one forced layout)
   * instead of hiding/restoring each gap paragraph's own gaps (two forced layouts per paragraph).
   * A paragraph's own line breaks do not depend on other paragraphs' gaps, so results match the
   * per-paragraph path; skipped when floats are in play (vertical positions matter) or when most
   * paragraphs are already settled (typing). Call after beginPass(). Every 25th measured paragraph
   * is re-measured the old way afterwards and compared (window.__zenGapBatchMiss counts differences).
   */
  batchGaps<R>(view: EditorView, paraCount: number, fn: () => R): R {
    const w = window as unknown as {
      __genofficeAndroidShim?: boolean
      __zenNoGapBatch?: boolean
      __zenGapBatchVerify?: boolean
      __zenGapBatchPasses?: number
      __zenGapBatchChecked?: number
      __zenGapBatchMiss?: number
    }
    if (
      w.__genofficeAndroidShim !== true ||
      w.__zenNoGapBatch === true ||
      this.gapsHidden ||
      this.visibleMeasure ||
      this.floatBands.length > 0
    )
      return fn()
    let settledN = 0
    for (const e of this.results.values()) if (e.settled) settledN++
    if (settledN * 2 >= paraCount) return fn()
    const gaps = view.dom.querySelectorAll<HTMLElement>('.page-gap-inline')
    if (gaps.length < 8) return fn()
    const prev = Array.from(gaps, (g) => g.style.display)
    gaps.forEach((g) => (g.style.display = 'none'))
    this.gapsHidden = true
    this.batchN = 0
    this.batchSamples = []
    try {
      return fn()
    } finally {
      this.gapsHidden = false
      gaps.forEach((g, i) => (g.style.display = prev[i]))
      w.__zenGapBatchPasses = (w.__zenGapBatchPasses ?? 0) + 1
      if (w.__zenGapBatchVerify !== false) {
        for (const s of this.batchSamples) {
          try {
            const alt = measureNatural(s.el, () => s.mp(s.el))
            w.__zenGapBatchChecked = (w.__zenGapBatchChecked ?? 0) + 1
            if (JSON.stringify(alt) !== JSON.stringify(s.result))
              w.__zenGapBatchMiss = (w.__zenGapBatchMiss ?? 0) + 1
          } catch {
            /* verification only */
          }
        }
      }
      this.batchSamples = []
    }
  }

  private measureBatched(
    node: ProseMirrorNode,
    pos: number,
    el: HTMLElement,
    measureParagraph: (el: HTMLElement) => T | null,
  ): T | null {
    const out = this.measureEl(node, pos, el, measureParagraph)
    if (++this.batchN % 25 === 0) this.batchSamples.push({ el, mp: measureParagraph, result: out })
    return out
  }

  measure(
    view: EditorView,
    node: ProseMirrorNode,
    pos: number,
    measureParagraph: (el: HTMLElement) => T | null,
    dom?: HTMLElement,
  ): T | null {
    const el = dom ?? view.nodeDOM(pos)
    if (!(el instanceof HTMLElement)) return null
    if (this.gapsHidden) return this.measureBatched(node, pos, el, measureParagraph)
    if (!fastGapPath() || !el.querySelector('.page-gap-inline'))
      return measureNatural(el, () => this.measureEl(node, pos, el, measureParagraph))
    // reads only: no style write, so a clean layout is not invalidated between paragraphs
    let vis = `${el.offsetHeight}:${el.offsetWidth}`
    if (this.floatBands.length > 0) {
      const r = el.getBoundingClientRect()
      if (this.floatBands.some(([top, bottom]) => r.top < bottom && r.bottom > top))
        vis = `${r.top}:${vis}`
    }
    const prev = this.results.get(node)
    if (prev?.settled && prev.visKey === vis) {
      prev.gen = this.gen
      if (zsOn()) zsCur().fast++
      return prev.pos === pos ? prev.result : this.shift(prev.result, pos - prev.pos)
    }
    const run = () => this.measureEl(node, pos, el, measureParagraph)
    const out = this.visibleMeasure ? run() : measureNatural(el, run)
    const entry = this.results.get(node)
    if (entry) entry.visKey = vis
    return out
  }

  /** Android shim, typed edit: the settled result of an unchanged node without reading its DOM box.
   *  null = not settled, or floats are in play (vertical position matters): measure() decides */
  peekSettled(node: ProseMirrorNode, pos: number): T | null {
    if (this.floatBands.length > 0) return null
    const prev = this.results.get(node)
    if (!prev || !prev.settled) return null
    prev.gen = this.gen
    return prev.pos === pos ? prev.result : this.shift(prev.result, pos - prev.pos)
  }

  private measureEl(
    node: ProseMirrorNode,
    pos: number,
    el: HTMLElement,
    measureParagraph: (el: HTMLElement) => T | null,
  ): T | null {
    // layout px: a page-zoom transform changes no line break
    let rectKey = `${el.offsetHeight}:${el.offsetWidth}`
    if (this.floatBands.length > 0) {
      const r = el.getBoundingClientRect()
      if (this.floatBands.some(([top, bottom]) => r.top < bottom && r.bottom > top))
        rectKey = `${r.top}:${rectKey}`
    }
    const prev = this.results.get(node)
    if (prev) prev.gen = this.gen
    if (zsOn()) {
      const c = zsCur()
      c.paras++
      if (!prev) c.noEntry++
      else if (!prev.settled) c.unsettled++
      else if (prev.rectKey !== rectKey) {
        c.keyDiff++
        if (c.samples.length < 4) c.samples.push([prev.rectKey, rectKey])
      } else c.hit++
    }
    if (prev?.settled && prev.rectKey === rectKey) {
      return prev.pos === pos ? prev.result : this.shift(prev.result, pos - prev.pos)
    }
    const result = measureParagraph(el)
    if (result === null) {
      if (zsOn()) zsCur().nullRes++
      this.results.delete(node)
      return null
    }
    const key = JSON.stringify(this.shift(result, -pos))
    const rounds = (prev?.rounds ?? 0) + 1
    this.results.set(node, {
      pos,
      key,
      rectKey,
      result,
      settled:
        (prev !== undefined && prev.key === key) ||
        this.stableNow(result) ||
        rounds >= MAX_PARA_ROUNDS,
      rounds,
      gen: this.gen,
    })
    return result
  }
}
