import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import type { ZoomTransform } from 'd3'
import {
  polygonPath,
  reprojectPolygon,
  selectPointsInPolygon,
  toDataPolygon,
  toViewBox,
  type ScalePair,
  type Vec2
} from './spatial'
import type { ProjectionMapPoint } from './types'

const MIN_SAMPLE_DISTANCE_SQUARED = 1

type Options = {
  svgRef: RefObject<SVGSVGElement | null>
  transformRef: RefObject<ZoomTransform>
  scales: ScalePair
  points: ProjectionMapPoint[]
  enabled: boolean
  hasSelection: boolean
  onSelectionChange?: (points: ProjectionMapPoint[]) => void
}

export function useLassoSelection({
  svgRef,
  transformRef,
  scales,
  points,
  enabled,
  hasSelection,
  onSelectionChange
}: Options) {
  const pathRef = useRef<SVGPathElement>(null)
  const drawingRef = useRef(false)
  const pointerRef = useRef<number | null>(null)
  const draftRef = useRef<Vec2[]>([])
  const polygonRef = useRef<Vec2[]>([])

  const redraw = useCallback(() => {
    const polygon = drawingRef.current
      ? draftRef.current
      : reprojectPolygon(polygonRef.current, scales, transformRef.current)
    pathRef.current?.setAttribute('d', polygonPath(polygon))
  }, [scales, transformRef])

  const releasePointer = useCallback(() => {
    const id = pointerRef.current
    pointerRef.current = null
    drawingRef.current = false
    draftRef.current = []
    if (id !== null && svgRef.current?.hasPointerCapture(id))
      svgRef.current.releasePointerCapture(id)
  }, [svgRef])

  const clear = useCallback(() => {
    releasePointer()
    polygonRef.current = []
    pathRef.current?.setAttribute('d', '')
  }, [releasePointer])

  const cancel = useCallback(() => {
    releasePointer()
    redraw()
  }, [releasePointer, redraw])

  useLayoutEffect(() => {
    if (!enabled || !hasSelection) clear()
  }, [enabled, hasSelection, clear])

  const onChangeRef = useRef(onSelectionChange)
  useLayoutEffect(() => {
    onChangeRef.current = onSelectionChange
  })
  useEffect(() => {
    if (polygonRef.current.length) {
      onChangeRef.current?.(selectPointsInPolygon(points, polygonRef.current))
      redraw()
    }
  }, [points, redraw])
  useEffect(() => releasePointer, [releasePointer])

  function appendPointerSamples(event: ReactPointerEvent<SVGSVGElement>): void {
    const nativeEvent = event.nativeEvent
    const coalescedEvents = nativeEvent.getCoalescedEvents?.() ?? []
    const samples = coalescedEvents.length ? coalescedEvents : [nativeEvent]

    for (const sample of samples) {
      const point = toViewBox(event.currentTarget, sample.clientX, sample.clientY)
      const previous = draftRef.current[draftRef.current.length - 1]
      if (
        previous &&
        (point[0] - previous[0]) ** 2 + (point[1] - previous[1]) ** 2 < MIN_SAMPLE_DISTANCE_SQUARED
      ) {
        continue
      }
      draftRef.current.push(point)
    }
  }

  function start(event: ReactPointerEvent<SVGSVGElement>) {
    if (!enabled || event.button !== 0 || drawingRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerRef.current = event.pointerId
    drawingRef.current = true
    draftRef.current = [toViewBox(event.currentTarget, event.clientX, event.clientY)]
    redraw()
  }

  function move(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerId !== pointerRef.current) return
    appendPointerSamples(event)
    redraw()
  }

  function finish(event: ReactPointerEvent<SVGSVGElement>): ProjectionMapPoint[] | null {
    if (event.pointerId !== pointerRef.current) return null
    appendPointerSamples(event)
    const draft = draftRef.current
    releasePointer()
    if (draft.length < 3) {
      redraw()
      return null
    }
    const polygon = toDataPolygon(draft, scales, transformRef.current)
    const selected = selectPointsInPolygon(points, polygon)
    polygonRef.current = selected.length ? polygon : []
    redraw()
    onSelectionChange?.(selected)
    return selected
  }

  return { pathRef, drawingRef, redraw, start, move, finish, cancel }
}
