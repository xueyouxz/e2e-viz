import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

/**
 * Triggers WebGLRenderer.compile() one RAF after mount so all renderers have
 * attached their Three.js objects. Compiling shaders up-front moves the
 * 100ms+ first-draw shader-link cost out of the interactive render path.
 */
export function ShaderPrecompiler() {
  const { gl, scene, camera } = useThree()

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      gl.compile(scene, camera)
    })
    return () => cancelAnimationFrame(raf)
  }, [gl, scene, camera])

  return null
}
