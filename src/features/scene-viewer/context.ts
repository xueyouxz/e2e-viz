import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { SceneState, SceneStore } from './store/sceneStore'

interface SceneContextValue {
  store: SceneStore
}

export const SceneCtx = createContext<SceneContextValue | null>(null)

function useSceneCtx(): SceneContextValue {
  const ctx = useContext(SceneCtx)
  if (!ctx) throw new Error('useSceneCtx: missing SceneCtx.Provider')
  return ctx
}

/** Reactive selector — triggers re-render when selected slice changes. */
export function useSceneStore<T>(selector: (s: SceneState) => T): T {
  return useStore(useSceneCtx().store, selector)
}

/** Returns the raw store API for imperative getState() / subscribe() access. */
export function useSceneStoreApi(): SceneStore {
  return useSceneCtx().store
}
