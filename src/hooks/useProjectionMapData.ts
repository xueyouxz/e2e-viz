import { useEffect, useMemo, useState } from 'react'
import { projectionDataLoader } from '@/features/projection-map/data/projectionData'
import type { ProjectionMapPoint, SplitName } from '@/types/scene'

export function useProjectionMapData() {
  const cached = projectionDataLoader.peek()
  const [points, setPoints] = useState<ProjectionMapPoint[]>(cached?.scenes ?? [])
  const [loading, setLoading] = useState(cached === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const available = projectionDataLoader.peek()
    if (available) {
      setPoints(available.scenes)
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const projection = await projectionDataLoader.load()
        if (!cancelled) setPoints(projection.scenes)
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load projection data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const splitCounts = useMemo(
    () =>
      points.reduce<Record<SplitName, number>>(
        (counts, point) => {
          counts[point.split] += 1
          return counts
        },
        { train: 0, val: 0 }
      ),
    [points]
  )

  return { points, splitCounts, loading, error }
}
