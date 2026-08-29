import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { SceneCtx } from '../../context'
import { createSceneStore } from '../../store/sceneStore'
import type { SceneDataManager } from '../../data/SceneDataManager'
import type { SceneStore } from '../../store/sceneStore'

const unusedDataManager = {} as unknown as SceneDataManager

export function renderRenderer(element: ReactElement, store: SceneStore = createSceneStore()) {
  return {
    store,
    ...render(
      <SceneCtx.Provider value={{ store, dataManager: unusedDataManager }}>
        {element}
      </SceneCtx.Provider>
    )
  }
}
