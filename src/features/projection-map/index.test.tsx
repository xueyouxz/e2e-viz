// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectionMapPoint } from './types'
import type { SceneObjectSummary } from './data/useSceneMetadata'
import ProjectionMapPage from './index'

const { points, metadata } = vi.hoisted(() => {
  const locations = [
    'boston-seaport',
    'singapore-onenorth',
    'boston-seaport',
    'singapore-queenstown',
    'singapore-hollandvillage'
  ]
  const points: ProjectionMapPoint[] = locations.map((_, index) => ({
    scene_name: `scene-${index}`,
    scene_token: `${index}`,
    split: index < 2 ? 'train' : 'val',
    tsne_comp1: index,
    tsne_comp2: index
  }))
  const metadata = new Map<string, SceneObjectSummary>(
    points.map((point, index) => [
      point.scene_name,
      {
        ...point,
        location: locations[index],
        scene_description: '',
        map_name: '',
        map_filename: '',
        nbr_samples: 1,
        object_total_unique: 0,
        object_counts_by_category: {}
      }
    ])
  )
  return { points, metadata }
})

vi.mock('./data/useProjectionMapData', () => ({
  useProjectionMapData: () => ({ points, loading: false, error: null })
}))
vi.mock('./data/useSceneMetadata', () => ({ useSceneMetadata: () => metadata }))
vi.mock('./data/projectionData', () => ({ projectionDataLoader: { load: async () => [] } }))
vi.mock('./glyph/glyphAtlas', () => ({ glyphAtlasLoader: { load: async () => null } }))
vi.mock('./useScenePreview', () => ({
  useScenePreview: () => ({ activeScene: null, toast: null, open: vi.fn(), close: vi.fn() })
}))
vi.mock('./components/ProjectionMapView', () => ({
  ProjectionMapView: ({
    points,
    onSelectionChange
  }: {
    points: ProjectionMapPoint[]
    onSelectionChange: (points: ProjectionMapPoint[]) => void
  }) => (
    <div data-testid='projection'>
      {points.map(point => point.scene_name).join(',')}
      <button onClick={() => onSelectionChange(points.slice(0, 1))}>Select first scene</button>
    </div>
  )
}))
vi.mock('./components/SceneListPanel', () => ({
  SceneListPanel: ({
    scenes,
    searchableScenes,
    hasFilters,
    onReset
  }: {
    scenes: ProjectionMapPoint[]
    searchableScenes: ProjectionMapPoint[]
    hasFilters: boolean
    onReset: () => void
  }) => (
    <div>
      <output data-testid='scenes'>{scenes.map(point => point.scene_name).join(',')}</output>
      <output data-testid='searchable'>
        {searchableScenes.map(point => point.scene_name).join(',')}
      </output>
      {hasFilters && <button onClick={onReset}>Reset scene list</button>}
    </div>
  )
}))

afterEach(cleanup)

function filter(name: string) {
  return screen.getByRole('button', { name: new RegExp(`^Filter ${name}:`) })
}

function count(title: string, expected: number) {
  expect(screen.getByLabelText(`${title}: ${expected} matching scenes`).textContent).toBe(
    `${expected}`
  )
}

function expectScenes(names: string[]) {
  expect(screen.getByTestId('scenes').textContent).toBe(names.join(','))
  expect(screen.getByTestId('searchable').textContent).toBe(names.join(','))
  expect(screen.getByTestId('projection').textContent).toBe(`${names.join(',')}Select first scene`)
}

describe('dataset chart filters', () => {
  it('intersects split and full location while keeping each chart count independent', () => {
    render(<ProjectionMapPage />)
    expect(
      within(screen.getByRole('group', { name: 'Map location filters' })).getAllByRole('button')
    ).toHaveLength(4)
    fireEvent.click(filter('Train'))
    count('Dataset split', 2)
    count('Map location', 5)
    expectScenes(['scene-0', 'scene-1'])
    fireEvent.click(filter('Boston Seaport'))
    count('Dataset split', 2)
    count('Map location', 2)
    expectScenes(['scene-0'])
    fireEvent.click(filter('Singapore One North'))
    expectScenes(['scene-1'])
    fireEvent.click(filter('Singapore One North'))
    expectScenes(['scene-0', 'scene-1'])
    count('Map location', 5)
  })

  it('keeps an empty intersection empty and resets both filters', () => {
    render(<ProjectionMapPage />)
    fireEvent.click(filter('Train'))
    fireEvent.click(filter('Singapore Queenstown'))
    expectScenes([])
    count('Dataset split', 2)
    count('Map location', 1)
    fireEvent.click(screen.getByRole('button', { name: 'Reset scene list' }))
    expectScenes(points.map(point => point.scene_name))
    count('Dataset split', 5)
    count('Map location', 5)
    expect(filter('Train').getAttribute('aria-pressed')).toBe('false')
    expect(filter('Singapore Queenstown').getAttribute('aria-pressed')).toBe('false')
  })

  it('clears a previous lasso selection when changing a chart filter', () => {
    render(<ProjectionMapPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Select first scene' }))
    expect(screen.getByTestId('scenes').textContent).toBe('scene-0')
    fireEvent.click(filter('Val'))
    expectScenes(['scene-2', 'scene-3', 'scene-4'])
  })
})
