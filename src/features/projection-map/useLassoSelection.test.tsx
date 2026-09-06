// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import * as d3 from 'd3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLassoSelection } from './useLassoSelection'
import type { ProjectionMapPoint } from './types'

const points: ProjectionMapPoint[] = [
  {
    scene_name: 'scene-first',
    scene_token: 'first',
    split: 'train',
    tsne_comp1: 15,
    tsne_comp2: 15
  },
  {
    scene_name: 'scene-second',
    scene_token: 'second',
    split: 'train',
    tsne_comp1: 75,
    tsne_comp2: 75
  }
]

const scales = {
  x: d3.scaleLinear([0, 100], [0, 100]),
  y: d3.scaleLinear([0, 100], [0, 100])
}

function LassoHarness({ onSelectionChange }: { onSelectionChange: (names: string[]) => void }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const transformRef = useRef(d3.zoomIdentity)
  const [selected, setSelected] = useState<ProjectionMapPoint[]>([])
  const lasso = useLassoSelection({
    svgRef,
    transformRef,
    scales,
    points,
    enabled: true,
    hasSelection: selected.length > 0,
    onSelectionChange: next => {
      setSelected(next)
      onSelectionChange(next.map(point => point.scene_name))
    }
  })

  return (
    <svg
      ref={svgRef}
      viewBox='0 0 1280 760'
      onPointerDown={lasso.start}
      onPointerMove={lasso.move}
      onPointerUp={lasso.finish}
    >
      <path ref={lasso.pathRef} />
    </svg>
  )
}

function dispatchPointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  point: [number, number],
  coalesced: [number, number][] = []
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: point[0],
    clientY: point[1]
  })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    getCoalescedEvents: {
      value: () => coalesced.map(([clientX, clientY]) => ({ clientX, clientY }))
    }
  })
  fireEvent(target, event)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('lasso pointer sampling', () => {
  it('uses coalesced samples when a later gesture arrives as one pointermove', () => {
    const onSelectionChange = vi.fn()
    const { container } = render(<LassoHarness onSelectionChange={onSelectionChange} />)
    const svg = container.querySelector('svg')
    if (!svg) throw new Error('Lasso SVG was not mounted')
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1280, 760))
    Object.assign(svg, {
      getScreenCTM: vi.fn(() => null),
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn()
    })

    dispatchPointer(svg, 'pointerdown', [10, 10])
    dispatchPointer(svg, 'pointermove', [20, 10])
    dispatchPointer(svg, 'pointermove', [20, 20])
    dispatchPointer(svg, 'pointermove', [10, 20])
    dispatchPointer(svg, 'pointerup', [10, 10])
    expect(onSelectionChange).toHaveBeenLastCalledWith(['scene-first'])

    dispatchPointer(svg, 'pointerdown', [70, 70])
    dispatchPointer(
      svg,
      'pointermove',
      [70, 80],
      [
        [80, 70],
        [80, 80],
        [70, 80]
      ]
    )
    dispatchPointer(svg, 'pointerup', [70, 70])

    expect(onSelectionChange).toHaveBeenLastCalledWith(['scene-second'])
  })
})
