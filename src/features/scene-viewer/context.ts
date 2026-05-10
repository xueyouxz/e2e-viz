import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { SceneDataManager } from './data/SceneDataManager'
import type { SceneState, SceneStore } from './store/sceneStore'

export interface SceneContextValue {
  store: SceneStore
  dataManager: SceneDataManager
}

export const SceneCtx = createContext<SceneContextValue | null>(null)

export function useSceneCtx(): SceneContextValue {
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
