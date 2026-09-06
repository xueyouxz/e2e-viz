// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectionMapView } from './ProjectionMapView'
import type { ProjectionMapPoint } from '../types'

vi.mock('../glyph/useGlyphAtlas', () => ({
  useGlyphAtlas: () => ({ status: 'ready', bitmap: {} })
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('glyph viewport', () => {
  it('covers letterboxing and preserves glyph hit coordinates across resize', () => {
    const context = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      strokeRect: vi.fn()
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    let resize: ResizeObserverCallback = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback
        }
        observe() {}
        disconnect = disconnect
      }
    )
    const onGlyphClick = vi.fn()
    const point = {
      scene_name: 'scene-0000',
      scene_token: '0',
      split: 'train' as const,
      tsne_comp1: 0,
      tsne_comp2: 0
    }
    const { container, unmount } = render(
      <ProjectionMapView
        points={[point]}
        allPoints={[point]}
        selectedScenes={[point]}
        highlightedScenes={[]}
        splitModes={{ train: 'glyph', val: 'glyph' }}
        viewRequest={null}
        onGlyphClick={onGlyphClick}
      />
    )
    const svg = container.querySelector('svg[role="img"]')
    const foreign = container.querySelector('foreignObject')
    const canvas = container.querySelector('canvas')
    if (!svg || !foreign || !canvas) throw new Error('Projection layers were not mounted')
    Object.defineProperty(svg, 'getScreenCTM', { value: () => null })
    const setSize = (width: number, height: number) =>
      act(() => {
        resize(
          [{ target: svg, contentRect: { width, height } } as ResizeObserverEntry],
          {} as ResizeObserver
        )
      })

    // Vertical letterboxing extends the visible user coordinates to [-120, 880].
    setSize(1280, 1000)
    expect(Number(foreign.getAttribute('y'))).toBe(-120)
    expect(Number(foreign.getAttribute('height'))).toBe(1000)
    expect(canvas.height).toBe(1000)
    expect(context.setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, -0, 120)
    expect(context.clearRect).toHaveBeenLastCalledWith(0, -120, 1280, 1000)

    // The same viewBox point still responds to its shifted client position.
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1280, 1000))
    vi.stubGlobal('PointerEvent', MouseEvent)
    fireEvent.pointerDown(svg, { clientX: 640, clientY: 500, button: 0 })
    fireEvent.pointerUp(svg, { clientX: 640, clientY: 500, button: 0 })
    expect(onGlyphClick).toHaveBeenCalledWith(point)

    // Horizontal letterboxing and a subsequent exact-aspect resize must reset both offsets.
    setSize(1600, 760)
    expect(Number(foreign.getAttribute('x'))).toBe(-160)
    expect(Number(foreign.getAttribute('width'))).toBe(1600)
    expect(context.clearRect).toHaveBeenLastCalledWith(-160, 0, 1600, 760)
    setSize(1280, 760)
    expect(Number(foreign.getAttribute('x'))).toBe(0)
    expect(Number(foreign.getAttribute('y'))).toBe(0)
    expect(canvas.width).toBe(1280)
    expect(canvas.height).toBe(760)
    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('keeps full-data density and coordinates stable when filtering, including empty results', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    const allPoints: ProjectionMapPoint[] = [0, 120, 500].map((value, index) => ({
      scene_name: `scene-${index}`,
      scene_token: `${index}`,
      split: 'train',
      tsne_comp1: value,
      tsne_comp2: value
    }))
    const view = (points: ProjectionMapPoint[]) => (
      <ProjectionMapView
        points={points}
        allPoints={allPoints}
        selectedScenes={[]}
        highlightedScenes={[]}
        splitModes={{ train: 'scatter', val: 'scatter' }}
        viewRequest={null}
      />
    )
    const { container, rerender } = render(view(allPoints))
    const contours = () =>
      Array.from(container.querySelectorAll('g[aria-label="All scenes density"] path'), path => ({
        shape: path.getAttribute('d'),
        color: path.getAttribute('fill')
      }))
    const originalContours = contours()
    expect(originalContours.length).toBeGreaterThan(0)
    const sceneSvg = container.querySelector(
      'svg[aria-label="Training and validation scene projection view"]'
    )
    if (!sceneSvg) throw new Error('Projection SVG was not mounted')
    const point = sceneSvg.querySelectorAll('circle')[1]
    const originalPosition = [point.getAttribute('cx'), point.getAttribute('cy')]

    rerender(view([allPoints[1]]))
    expect(contours()).toEqual(originalContours)
    const filteredPoint = sceneSvg.querySelector('circle')
    if (!filteredPoint) throw new Error('Filtered point was not rendered')
    expect([filteredPoint.getAttribute('cx'), filteredPoint.getAttribute('cy')]).toEqual(
      originalPosition
    )

    rerender(view([]))
    expect(contours()).toEqual(originalContours)
    expect(sceneSvg.querySelector('circle')).toBeNull()

    rerender(view(allPoints))
    expect(contours()).toEqual(originalContours)
  })
})
