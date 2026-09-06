import { useEffect, useSyncExternalStore } from 'react'
import { glyphAtlasLoader } from './glyphAtlas'

export function useGlyphAtlas() {
  const snapshot = useSyncExternalStore(glyphAtlasLoader.subscribe, glyphAtlasLoader.getSnapshot)
  useEffect(() => {
    void glyphAtlasLoader.load().catch(() => {
      /* Status and retry are rendered by the map. */
    })
  }, [])
  return snapshot
}
