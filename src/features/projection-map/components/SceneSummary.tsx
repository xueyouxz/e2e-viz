import { useMemo } from 'react'
import { CategoryDonutChart } from './CategoryDonutChart'
import type { SceneObjectSummary } from '../data/useSceneMetadata'
import { LOCATIONS } from '../locations'
import { SPLIT_COLORS } from '../splitConfig'
import type { ProjectionMapPoint, SplitName } from '../types'

type Props = {
  points: ProjectionMapPoint[]
  metadata: Map<string, SceneObjectSummary> | null
  split: SplitName | null
  location: string | null
  loading: boolean
  onSplitChange: (id: SplitName) => void
  onLocationChange: (id: string) => void
}

export function SceneSummary({
  points,
  metadata,
  split,
  location,
  loading,
  onSplitChange,
  onLocationChange
}: Props) {
  const { splits, locations } = useMemo(() => {
    const splitCounts = { train: 0, val: 0 }
    const locationCounts = new Map<string, number>()
    for (const point of points) {
      splitCounts[point.split]++
      const id = metadata?.get(point.scene_name)?.location
      if (id) locationCounts.set(id, (locationCounts.get(id) ?? 0) + 1)
    }
    return {
      splits: (['train', 'val'] as const).map(id => ({
        id,
        label: id === 'train' ? 'Train' : 'Val',
        color: SPLIT_COLORS[id],
        total: splitCounts[id]
      })),
      locations: LOCATIONS.map(item => ({ ...item, total: locationCounts.get(item.id) ?? 0 }))
    }
  }, [points, metadata])

  return (
    <section
      className='flex min-w-0 flex-col gap-1 bg-app-surface-raised px-2 py-1.5'
      aria-label='Dataset summary'
      aria-busy={loading}
    >
      <h2 className='m-0 text-[0.8rem] font-semibold text-app-text'>Overview</h2>
      <div className='grid grid-cols-[max-content_max-content] justify-between gap-x-2'>
        <CategoryDonutChart
          data={splits}
          title='Dataset split'
          selectedId={split}
          onSelect={onSplitChange}
        />
        {metadata ? (
          <CategoryDonutChart
            data={locations}
            title='Map location'
            selectedId={location}
            onSelect={onLocationChange}
          />
        ) : (
          <div className='grid min-h-[72px] place-items-center text-center text-[10px] text-app-text-muted'>
            Location data unavailable
          </div>
        )}
      </div>
    </section>
  )
}
