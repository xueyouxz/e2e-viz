import { useEffect, useMemo, useState } from 'react'
import type {
  ProjectionMapPoint,
  ProjectionPayload,
  SceneObjectSummaryPayload,
  SplitName
} from '../types/vectorMap.types'
import { VECTOR_MAP_MANIFEST } from '../data/vectorMapManifest'

const PROJECTION_PATH = '/data/projection-map/dimension_reduction.json'
const SCENE_OBJECT_SUMMARY_PATH = '/data/projection-map/nuscenes_scene_object_summary.json'

// Built once at module load; VECTOR_MAP_MANIFEST is a static import.
const SPLIT_LOOKUP: ReadonlyMap<string, SplitName> = (() => {
  const m = new Map<string, SplitName>()
  for (const split of Object.keys(VECTOR_MAP_MANIFEST.splits) as SplitName[]) {
    for (const sceneName of VECTOR_MAP_MANIFEST.splits[split]) m.set(sceneName, split)
  }
  return m
})()

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
        const [projection, objectSummary] = await Promise.all([
          fetchJson<ProjectionPayload>(PROJECTION_PATH),
          fetchJson<SceneObjectSummaryPayload>(SCENE_OBJECT_SUMMARY_PATH)
        ])
        const summaryLookup = new Map(objectSummary.scenes.map(scene => [scene.scene_name, scene]))
        const nextPoints = projection.scenes
          .map(scene => {
            const split = SPLIT_LOOKUP.get(scene.scene_name)
            if (!split) return null
            const summary = summaryLookup.get(scene.scene_name)
            const point: ProjectionMapPoint = { ...scene, split }
            return summary ? { ...point, summary } : point
          })
          .filter((scene): scene is ProjectionMapPoint => scene !== null)

        if (!cancelled) setPoints(nextPoints)
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
