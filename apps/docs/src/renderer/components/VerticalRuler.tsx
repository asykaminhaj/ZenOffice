import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import type { SectionSettings } from '@genoffice/docx-engine'
import { useMeasurement } from '../use-measurement'
import type { MeasurementUnit } from '../units'

/** Conversion constants */
const TWIPS_PER_INCH = 1440
const PX_PER_INCH = 96

/** Word-style vertical ruler tick configuration (inch-based) */
const VERTICAL_RULER_TICKS = {
  /** 1/8 inch = 2px tick */
  minor: { twips: TWIPS_PER_INCH / 8, px: 2 },
  /** 1/4 inch = 4px tick */
  quarter: { twips: TWIPS_PER_INCH / 4, px: 4 },
  /** 1/2 inch = 7px tick */
  half: { twips: TWIPS_PER_INCH / 2, px: 7 },
  /** 1 inch = full tick with number */
  major: { twips: TWIPS_PER_INCH, px: 10 },
}

/** Section geometry in twips */
export interface VerticalRulerDims {
  pageHeight: number
  marginTop: number
  marginBottom: number
  inches: number
}

/** Compute ruler dimensions from section settings (same logic as horizontal ruler) */
export function verticalRulerDims(section: SectionSettings): VerticalRulerDims {
  const finite = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
  const pageHeight = Math.min(finite(section.pageHeight, 15840), 50 * TWIPS_PER_INCH)
  const marginTop = Math.min(finite(section.marginTop, 1440), pageHeight)
  const marginBottom = Math.min(finite(section.marginBottom, 1440), pageHeight)
  const inches = Math.floor(pageHeight / TWIPS_PER_INCH)
  return { pageHeight, marginTop, marginBottom, inches }
}

/** Convert twips to pixels at current zoom */
function twipsToPx(twips: number, zoom: number): number {
  return (twips / TWIPS_PER_INCH) * PX_PER_INCH * zoom
}

/** Generate tick marks for the vertical ruler */
export interface VerticalRulerTick {
  pos: number // pixels from top of ruler (0 = top of document)
  kind: 'major' | 'half' | 'quarter' | 'minor'
  label?: string
}

export function verticalRulerTicks(
  totalHeightPx: number,
  zoom: number,
  range?: { from: number; to: number }
): VerticalRulerTick[] {
  const ticks: VerticalRulerTick[] = []

  // Generate ticks from top of document (0) to bottom
  // Major ticks at each inch (from top of document)
  const totalInches = Math.ceil(totalHeightPx / (PX_PER_INCH * zoom))

  const pxPerInch = PX_PER_INCH * zoom
  const firstInch = range ? Math.max(0, Math.floor(range.from / pxPerInch)) : 0
  const lastInch = range ? Math.min(totalInches, Math.ceil(range.to / pxPerInch)) : totalInches
  for (let inch = firstInch; inch <= lastInch; inch++) {
    const inchPx = inch * PX_PER_INCH * zoom

    // Major tick at each inch
    ticks.push({
      pos: inchPx,
      kind: 'major',
      label: String(inch),
    })

    // Half inch tick
    if (inch < totalInches) {
      const halfPx = inchPx + (PX_PER_INCH * zoom) / 2
      if (halfPx <= totalHeightPx) {
        ticks.push({
          pos: halfPx,
          kind: 'half',
        })
      }

      // Quarter inch ticks
      for (const q of [1, 3]) {
        const quarterPx = inchPx + (q * PX_PER_INCH * zoom) / 4
        if (quarterPx <= totalHeightPx) {
          ticks.push({
            pos: quarterPx,
            kind: 'quarter',
          })
        }
      }

      // Minor ticks (1/8 inch)
      for (let m = 1; m < 8; m += 2) {
        // Only odd eighths that aren't quarter/half
        if (m !== 2 && m !== 4 && m !== 6) {
          const minorPx = inchPx + (m * PX_PER_INCH * zoom) / 8
          if (minorPx <= totalHeightPx) {
            ticks.push({
              pos: minorPx,
              kind: 'minor',
            })
          }
        }
      }
    }
  }

  return ticks.sort((a, b) => a.pos - b.pos)
}

interface VerticalRulerProps {
  scrollContainerRef: React.RefObject<HTMLElement | null>
  section: SectionSettings
  /** Current zoom level */
  zoom: number
  /** Callback when top margin changes */
  onMarginTopChange?: (marginTop: number) => void
  /** Callback when bottom margin changes */
  onMarginBottomChange?: (marginBottom: number) => void
  /** Whether the ruler is visible */
  visible?: boolean
}

export function VerticalRuler({
  scrollContainerRef,
  section,
  zoom = 1,
  onMarginTopChange,
  onMarginBottomChange,
  visible = true,
}: VerticalRulerProps) {
  const rulerRef = useRef<SVGSVGElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollHeight, setScrollHeight] = useState(0)
  const [clientHeight, setClientHeight] = useState(0)
  const [paddingTop, setPaddingTop] = useState(0)

  const dims = useMemo(() => verticalRulerDims(section), [section])

  // Handle scroll sync
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current
      setScrollTop(container.scrollTop)
      if (container.scrollHeight !== scrollHeight) {
        setScrollHeight(container.scrollHeight)
      }
    }
  }, [scrollContainerRef, scrollHeight])

  // Update dimensions
  const updateDimensions = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const cs = getComputedStyle(container)
    const pt = parseFloat(cs.paddingTop) || 0
    const pb = parseFloat(cs.paddingBottom) || 0

    setScrollHeight(container.scrollHeight)
    setClientHeight(container.clientHeight)
    setPaddingTop(pt)
  }, [scrollContainerRef])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    container.addEventListener('scroll', handleScroll, { passive: true })
    setScrollTop(container.scrollTop)
    updateDimensions()

    const resizeObserver = new ResizeObserver(updateDimensions)
    resizeObserver.observe(container)

    return () => {
      container.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [scrollContainerRef, handleScroll, updateDimensions])

  if (!visible) return null

  // Use full scrollHeight as ruler height (covers all pages)
  // Fall back to single page height if scrollHeight not yet available
  const pageHeightPx = twipsToPx(dims.pageHeight, zoom)
  const rulerHeightPx = scrollHeight > 0 ? scrollHeight : pageHeightPx

  // Android + very tall documents (600+ pages): the full ruler was ~114k SVG nodes that React
  // re-diffed on every App render and every scroll event. Generate only the visible window plus
  // a buffer, bucketed so scrolling re-renders a few hundred nodes and only when the bucket moves.
  const virtualRuler =
    (window as unknown as { __genofficeAndroidShim?: boolean }).__genofficeAndroidShim === true &&
    rulerHeightPx > 20000
  const winBucket = 1000
  const winFrom = virtualRuler ? Math.max(0, Math.floor(scrollTop / winBucket) * winBucket - 2000) : 0
  const winTo = virtualRuler
    ? Math.floor(scrollTop / winBucket) * winBucket + Math.max(clientHeight, 1500) + 3000
    : rulerHeightPx

  const marginTopPx = twipsToPx(dims.marginTop, zoom)
  const marginBottomPx = twipsToPx(dims.marginBottom, zoom)

  // Tab selector box size (20x20px like horizontal ruler)
  const TAB_SELECTOR_SIZE = 20

  // Ruler width (24px matching horizontal ruler's 20px height proportion)
  const RULER_WIDTH = 24

  // Generate ticks for the full ruler height
  const ticks = useMemo(
    () => verticalRulerTicks(rulerHeightPx, zoom, virtualRuler ? { from: winFrom, to: winTo } : undefined),
    [rulerHeightPx, zoom, virtualRuler, winFrom, winTo]
  )

  // Drag state for margin handles (only for first page)
  const dragRef = useRef<{
    type: 'top' | 'bottom'
    startY: number
    origMargin: number
  } | null>(null)

  const handleMarginMouseDown = (
    e: React.MouseEvent<SVGRectElement>,
    type: 'top' | 'bottom'
  ) => {
    e.stopPropagation()
    e.preventDefault()
    const origMargin = type === 'top' ? dims.marginTop : dims.marginBottom
    dragRef.current = {
      type,
      startY: e.clientY,
      origMargin,
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(10)
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragRef.current) return
    const { type, startY, origMargin } = dragRef.current
    const deltaY = e.clientY - startY
    const deltaTwips = Math.round((deltaY / zoom / PX_PER_INCH) * TWIPS_PER_INCH)
    // Snap to 1/16 inch (90 twips) like Word
    const snappedTwips = Math.round((origMargin + deltaTwips) / 90) * 90

    // Clamp to valid range (minimum half inch body)
    const MIN_BODY_TWIPS = 720
    const maxTop = dims.pageHeight - dims.marginBottom - MIN_BODY_TWIPS
    const minBottom = dims.marginTop + MIN_BODY_TWIPS

    if (type === 'top') {
      const clamped = Math.min(Math.max(snappedTwips, 0), Math.max(maxTop, 0))
      onMarginTopChange?.(clamped)
    } else {
      const clamped = Math.min(Math.max(snappedTwips, minBottom), dims.pageHeight)
      onMarginBottomChange?.(clamped)
    }
  }

  const handleMouseUp = () => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    dragRef.current = null
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // Calculate page positions for multi-page margin zones
  // Each page has: top margin zone, content area, bottom margin zone
  // Page height in pixels = pageHeightPx
  // For each page i: page starts at i * pageHeightPx
  const numPages = Math.max(1, Math.ceil(rulerHeightPx / pageHeightPx))

  // Build page zones for SVG rendering
  const pageZones = useMemo(() => {
    const zones: Array<{
      pageStart: number
      marginTop: number
      marginBottom: number
      contentTop: number
      contentBottom: number
    }> = []

    const firstPage = virtualRuler ? Math.max(0, Math.floor(winFrom / pageHeightPx)) : 0
    const lastPage = virtualRuler ? Math.min(numPages, Math.ceil(winTo / pageHeightPx)) : numPages
    for (let i = firstPage; i < lastPage; i++) {
      const pageStart = i * pageHeightPx
      const pageEnd = Math.min((i + 1) * pageHeightPx, rulerHeightPx)

      // Only render zones if page has meaningful height
      if (pageEnd - pageStart < marginTopPx + marginBottomPx) continue

      zones.push({
        pageStart,
        marginTop: pageStart + marginTopPx,
        marginBottom: pageEnd - marginBottomPx,
        contentTop: pageStart + marginTopPx,
        contentBottom: pageEnd - marginBottomPx,
      })
    }

    return zones
  }, [numPages, pageHeightPx, rulerHeightPx, marginTopPx, marginBottomPx, virtualRuler, winFrom, winTo])

  return (
    <div
      className="vertical-ruler"
      data-ruler-virtual={virtualRuler ? '1' : undefined}
      style={{
        height: rulerHeightPx,
        width: RULER_WIDTH,
        transform: `translateY(-${scrollTop}px)`,
      }}
      aria-hidden="true"
    >
      {/* SVG Ruler - renders the complete ruler with all zones, ticks, and labels */}
      <svg
        ref={rulerRef}
        width={RULER_WIDTH}
        height={rulerHeightPx}
        viewBox={`0 0 ${RULER_WIDTH} ${rulerHeightPx}`}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        {/* Definitions for gradients and patterns */}
        <defs>
          {/* Margin zone pattern - light diagonal lines */}
          <pattern
            id="margin-pattern"
            patternUnits="userSpaceOnUse"
            width="4"
            height="4"
          >
            <rect width="4" height="4" fill="var(--docs-ruler-zone)" />
            <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="var(--docs-ruler-tick)" strokeWidth="0.5" opacity="0.3" />
          </pattern>
        </defs>

        {/* Right border line (like horizontal ruler's bottom border) */}
        <line
          x1={RULER_WIDTH - 1}
          y1={0}
          x2={RULER_WIDTH - 1}
          y2={rulerHeightPx}
          stroke="var(--docs-ruler-border)"
          strokeWidth="1"
        />

        {/* Page zones: outer strips, margins, and content areas for each page */}
        {pageZones.map((zone, i) => (
          <g key={i}>
            {/* 1. Outer strip (above top margin) - ruler background */}
            <rect
              x={0}
              y={zone.pageStart}
              width={RULER_WIDTH}
              height={marginTopPx}
              fill="var(--docs-ruler-bg)"
              stroke="none"
            />

            {/* 2. Top margin zone - distinct color with pattern */}
            <rect
              x={0}
              y={zone.contentTop}
              width={RULER_WIDTH}
              height={Math.max(0, zone.contentBottom - zone.contentTop)}
              fill="url(#margin-pattern)"
              stroke="none"
            />

            {/* 3. Content area (between margins) - white/transparent */}
            <rect
              x={0}
              y={zone.contentTop}
              width={RULER_WIDTH}
              height={Math.max(0, zone.contentBottom - zone.contentTop)}
              fill="var(--surface)"
              stroke="none"
            />

            {/* 4. Bottom margin zone - distinct color with pattern */}
            <rect
              x={0}
              y={zone.marginBottom}
              width={RULER_WIDTH}
              height={marginBottomPx}
              fill="url(#margin-pattern)"
              stroke="none"
            />

            {/* 5. Outer strip (below bottom margin, before next page) - ruler background */}
            <rect
              x={0}
              y={zone.marginBottom}
              width={RULER_WIDTH}
              height={marginBottomPx}
              fill="var(--docs-ruler-bg)"
              stroke="none"
            />

            {/* Horizontal margin boundary lines for this page */}
            {/* Top margin boundary */}
            <line
              x1={0}
              y1={zone.contentTop}
              x2={RULER_WIDTH}
              y2={zone.contentTop}
              stroke="var(--docs-ruler-border)"
              strokeWidth="1.5"
            />
            {/* Bottom margin boundary */}
            <line
              x1={0}
              y1={zone.contentBottom}
              x2={RULER_WIDTH}
              y2={zone.contentBottom}
              stroke="var(--docs-ruler-border)"
              strokeWidth="1.5"
            />
          </g>
        ))}

        {/* Tick marks on the right edge */}
        {ticks.map((tick) => {
          const tickLength = tick.kind === 'major' ? 10 : tick.kind === 'half' ? 7 : tick.kind === 'quarter' ? 4 : 2
          const tickOpacity = tick.kind === 'major' ? 1 : tick.kind === 'half' ? 0.8 : tick.kind === 'quarter' ? 0.6 : 0.4

          return (
            <g key={tick.pos} style={{ pointerEvents: 'none' }}>
              {/* Tick line extending leftward from right edge */}
              <line
                x1={RULER_WIDTH - tickLength}
                y1={tick.pos}
                x2={RULER_WIDTH - 1}
                y2={tick.pos}
                stroke="var(--docs-ruler-tick)"
                strokeWidth="1"
                opacity={tickOpacity}
              />
              {/* Number label for major ticks */}
              {tick.kind === 'major' && tick.label && (
                <text
                  x={RULER_WIDTH - tickLength - 4}
                  y={tick.pos + 3}
                  fontSize="9"
                  fontWeight="500"
                  fill="var(--docs-ruler-ink)"
                  textAnchor="end"
                  dominantBaseline="middle"
                  pointerEvents="none"
                >
                  {tick.label}
                </text>
              )}
            </g>
          )
        })}

        {/* Tab selector "L" box at top-left (20x20px) */}
        <g pointerEvents="auto" style={{ cursor: 'default' }}>
          <rect
            x={2}
            y={2}
            width={TAB_SELECTOR_SIZE - 4}
            height={TAB_SELECTOR_SIZE - 4}
            rx={2}
            fill="var(--docs-ruler-btn-bg)"
            stroke="var(--docs-ruler-btn-border)"
            strokeWidth="1"
          />
          <text
            x={2 + (TAB_SELECTOR_SIZE - 4) / 2}
            y={2 + (TAB_SELECTOR_SIZE - 4) / 2 + 3}
            fontSize="10"
            fontWeight="600"
            fill="var(--docs-ruler-btn-ink)"
            textAnchor="middle"
            dominantBaseline="middle"
            pointerEvents="none"
          >
            L
          </text>
        </g>

        {/* Top margin handle (draggable) - only on first page */}
        {onMarginTopChange && (
          <rect
            x={0}
            y={marginTopPx - 4}
            width={RULER_WIDTH}
            height={8}
            fill="transparent"
            stroke="var(--docs-ruler-tick)"
            strokeWidth="1"
            strokeDasharray="2,2"
            cursor="row-resize"
            pointerEvents="auto"
            onMouseDown={(e) => handleMarginMouseDown(e as any, 'top')}
            style={{
              // Extend hit area slightly
            }}
          />
        )}

        {/* Bottom margin handle (draggable) - only on first page */}
        {onMarginBottomChange && numPages === 1 && (
          <rect
            x={0}
            y={rulerHeightPx - marginBottomPx - 4}
            width={RULER_WIDTH}
            height={8}
            fill="transparent"
            stroke="var(--docs-ruler-tick)"
            strokeWidth="1"
            strokeDasharray="2,2"
            cursor="row-resize"
            pointerEvents="auto"
            onMouseDown={(e) => handleMarginMouseDown(e as any, 'bottom')}
          />
        )}

        {/* For multi-page, bottom margin handle on last page */}
        {onMarginBottomChange && numPages > 1 && (
          <rect
            x={0}
            y={(numPages - 1) * pageHeightPx + pageHeightPx - marginBottomPx - 4}
            width={RULER_WIDTH}
            height={8}
            fill="transparent"
            stroke="var(--docs-ruler-tick)"
            strokeWidth="1"
            strokeDasharray="2,2"
            cursor="row-resize"
            pointerEvents="auto"
            onMouseDown={(e) => handleMarginMouseDown(e as any, 'bottom')}
          />
        )}
      </svg>
    </div>
  )
}