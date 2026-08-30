import { useEffect, useState } from 'react'

export type SceneObjectSummary = {
  split: 'train' | 'val'
  scene_token: string
  scene_name: string
  scene_description: string
  map_name: string
  map_filename: string
  location: string
  nbr_samples: number
  object_total_unique: number
  object_counts_by_category: Record<string, number>
}

type ScenesMeta = {
  version: string
  dataroot: string
  summary: {
    total_scenes: number
    splits: Record<'train' | 'val', number>
    missing_scenes: Record<string, unknown>
  }
  scenes: SceneObjectSummary[]
}

const SCENES_META_PATH = '/data/glyphs/scenes-meta.json'

// Module-level cache — populated on first load, survives re-renders and
// component remounts, evicts only on full page reload.
let metaCache: Map<string, SceneObjectSummary> | null = null
let pendingFetch: Promise<Map<string, SceneObjectSummary>> | null = null

function loadScenesMeta(): Promise<Map<string, SceneObjectSummary>> {
  if (pendingFetch) return pendingFetch
  pendingFetch = fetch(SCENES_META_PATH)
    .then(r => {
      if (!r.ok) throw new Error(`scenes-meta fetch failed: ${r.status}`)
      return r.json() as Promise<ScenesMeta>
    })
    .then(data => {
      const map = new Map(data.scenes.map(s => [s.scene_name, s]))
      metaCache = map
      return map
    })
    .catch(err => {
      // Reset so a future call can retry
      pendingFetch = null
      return Promise.reject(err)
    })
  return pendingFetch
}

/**
 * Lazily fetches /data/glyphs/scenes-meta.json the first time `enabled` is
 * true (i.e. when the user first selects scenes). Subsequent calls return the
 * cached Map immediately — no re-fetch until page reload.
 *
 * Returns null while loading or if the fetch failed.
 */
export function useSceneMetadata(enabled: boolean): Map<string, SceneObjectSummary> | null {
  const [meta, setMeta] = useState<Map<string, SceneObjectSummary> | null>(metaCache)

  useEffect(() => {
    if (!enabled) return
    if (metaCache !== null) {
      setMeta(metaCache)
      return
    }
    let cancelled = false
    loadScenesMeta()
      .then(m => {
        if (!cancelled) setMeta(m)
      })
      .catch(() => {
        /* meta is optional enrichment — silent fail is fine */
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return meta
}
