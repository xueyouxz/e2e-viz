import { useCallback, useEffect, useRef, useState } from 'react'
import { sceneAvailabilityProbe, type SceneAvailability } from './data/sceneAvailability'
import type { ProjectionMapPoint } from './types'

export function useScenePreview() {
  const [activeScene, setActiveScene] = useState<string | null>(null)
  const [toast, setToast] = useState<{ sceneName: string; availability: SceneAvailability } | null>(
    null
  )
  const requestRef = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const open = useCallback(async (scene: ProjectionMapPoint) => {
    const request = ++requestRef.current
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
    const availability = await sceneAvailabilityProbe.check(scene)
    if (request !== requestRef.current) return
    if (availability === 'available') {
      setActiveScene(scene.scene_name)
    } else {
      setToast({ sceneName: scene.scene_name, availability })
      toastTimer.current = setTimeout(() => setToast(null), 3500)
    }
  }, [])

  const close = useCallback(() => {
    requestRef.current++
    setActiveScene(null)
  }, [])

  useEffect(
    () => () => {
      requestRef.current++
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    []
  )

  return { activeScene, toast, open, close }
}
