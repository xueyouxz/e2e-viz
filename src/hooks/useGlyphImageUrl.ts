import { useEffect, useState } from 'react'
import { glyphImageLoader, glyphImageUrl } from '@/lib/glyphImageLoader'

export function useGlyphImageUrl(sceneName: string): string | undefined {
  const [imageUrl, setImageUrl] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setImageUrl(undefined)
    void glyphImageLoader.load(glyphImageUrl(sceneName), { signal: controller.signal }).then(
      url => {
        if (active) setImageUrl(url)
      },
      () => {
        if (active) setImageUrl(undefined)
      }
    )
    return () => {
      active = false
      controller.abort()
    }
  }, [sceneName])

  return imageUrl
}
