import { useEffect, useMemo, useState } from 'react'
import type { ProjectionMapPoint, SplitName } from '@/types/scene'

type ProjectionPayload = { scene_counts: number; scenes: ProjectionMapPoint[] }

const PROJECTION_PATH = '/data/projection-map/dimension_reduction.json'

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Request failed: ${path} (${response.status})`)
  return (await response.json()) as T
}

export function useProjectionMapData() {
  const [points, setPoints] = useState<ProjectionMapPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const projection = await fetchJson<ProjectionPayload>(PROJECTION_PATH)
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
