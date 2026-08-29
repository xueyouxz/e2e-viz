import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { SceneCtx } from '../../context'
import { createSceneStore } from '../../store/sceneStore'
import type { SceneStore } from '../../store/sceneStore'

export function renderRenderer(element: ReactElement, store: SceneStore = createSceneStore()) {
  return {
    store,
    ...render(<SceneCtx.Provider value={{ store }}>{element}</SceneCtx.Provider>)
  }
}
