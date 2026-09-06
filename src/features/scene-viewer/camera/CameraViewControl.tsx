import { useEffect, useId, useRef, useState } from 'react'
import { Move3d, Navigation, ScanEye } from 'lucide-react'
import { useSceneStore } from '../context'
import type { CameraMode } from '../store/sceneStore'

const CAMERA_MODES: { mode: CameraMode; label: string; Icon: typeof Navigation }[] = [
  { mode: 'follow', label: 'Follow', Icon: Navigation },
  { mode: 'bev', label: 'Top View', Icon: ScanEye },
  { mode: 'free', label: 'Free', Icon: Move3d }
]

export function CameraViewControl() {
  const cameraMode = useSceneStore(s => s.cameraMode)
  const setCameraMode = useSceneStore(s => s.setCameraMode)

  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionsId = useId()
  const activeMode = CAMERA_MODES.find(({ mode }) => mode === cameraMode) ?? CAMERA_MODES[0]
  const ActiveIcon = activeMode.Icon

  useEffect(() => {
    if (!expanded) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setExpanded(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [expanded])

  return (
    <div
      ref={rootRef}
      className='absolute top-3 left-3 z-10 rounded bg-app-panel-bg-solid shadow-[0_4px_16px_rgb(15_23_42/16%),0_1px_3px_rgb(15_23_42/10%)]'
    >
      <button
        ref={triggerRef}
        className='grid h-8 w-8 cursor-pointer place-items-center rounded border-0 bg-app-panel-bg-solid text-app-text-primary transition-colors hover:bg-app-bg-hover focus-visible:outline-2 focus-visible:outline-accent'
        type='button'
        title={`Camera view: ${activeMode.label}`}
        aria-label='Camera view'
        aria-expanded={expanded}
        aria-controls={optionsId}
        onClick={() => setExpanded(value => !value)}
      >
        <ActiveIcon size={15} strokeWidth={1.8} aria-hidden='true' />
      </button>
      {expanded && (
        <div
          id={optionsId}
          className='flex flex-col gap-0.5 pt-0.5'
          role='group'
          aria-label='Camera view options'
        >
          {CAMERA_MODES.filter(({ mode }) => mode !== cameraMode).map(({ mode, label, Icon }) => (
            <button
              key={mode}
              className='grid h-8 w-8 cursor-pointer place-items-center rounded border-0 bg-transparent text-app-text-dim transition-colors hover:bg-app-bg-hover hover:text-app-text-primary focus-visible:outline-2 focus-visible:outline-accent'
              type='button'
              title={label}
              aria-label={label}
              onClick={() => {
                setCameraMode(mode)
                setExpanded(false)
                triggerRef.current?.focus()
              }}
            >
              <Icon size={15} strokeWidth={1.8} aria-hidden='true' />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
