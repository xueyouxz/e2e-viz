import { useEffect, useRef, useState } from 'react'
import { Navigation, ScanEye, Move3d } from 'lucide-react'
import type { CameraMode } from '../store/sceneStore'
import styles from './PanelToggleBar.module.css'

interface PanelToggleBarProps {
  streamsOpen: boolean
  camerasOpen: boolean
  statsOpen: boolean
  onToggleStreams: () => void
  onToggleCameras: () => void
  onToggleStats: () => void
  cameraMode: CameraMode
  onSetCameraMode: (mode: CameraMode) => void
}

function LayersIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
      <polyline points="1,7 7,4 13,7" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="1,10 7,7 13,10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="1,4 7,1 13,4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="1" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 3V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V3" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
      <polyline points="1,11 4,7 7,9 10,4 13,2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const CAMERA_MODES: { mode: CameraMode; label: string; Icon: typeof Navigation }[] = [
  { mode: 'follow', label: 'Follow', Icon: Navigation },
  { mode: 'bev',    label: 'Top View', Icon: ScanEye },
  { mode: 'free',   label: 'Free',   Icon: Move3d },
]

export function PanelToggleBar({
  streamsOpen,
  camerasOpen,
  statsOpen,
  onToggleStreams,
  onToggleCameras,
  onToggleStats,
  cameraMode,
  onSetCameraMode,
}: PanelToggleBarProps) {
  const [camExpanded, setCamExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!camExpanded) return
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setCamExpanded(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [camExpanded])

  const ActiveCamIcon = CAMERA_MODES.find((m) => m.mode === cameraMode)?.Icon ?? Navigation

  return (
    <div ref={rootRef} className={styles.toolbar}>
      {/* Main pill */}
      <div className={styles.bar}>
        <button
          className={`${styles.btn} ${streamsOpen ? styles.btnActive : ''}`}
          onClick={onToggleStreams}
          title={streamsOpen ? 'Hide streams panel' : 'Show streams panel'}
          type="button"
        >
          <LayersIcon />
          <span>Streams</span>
        </button>

        <button
          className={`${styles.btn} ${camerasOpen ? styles.btnActive : ''}`}
          onClick={onToggleCameras}
          title={camerasOpen ? 'Hide cameras panel' : 'Show cameras panel'}
          type="button"
        >
          <CameraIcon />
          <span>Cameras</span>
        </button>

        <button
          className={`${styles.btn} ${statsOpen ? styles.btnActive : ''}`}
          onClick={onToggleStats}
          title={statsOpen ? 'Hide statistics panel' : 'Show statistics panel'}
          type="button"
        >
          <ChartIcon />
          <span>Stats</span>
        </button>

        <div className={styles.divider} />

        {/* Camera mode trigger — icon-only, shows active mode */}
        <button
          className={`${styles.btn} ${styles.btnIcon} ${camExpanded ? styles.btnActive : ''}`}
          onClick={() => setCamExpanded((v) => !v)}
          title="Camera view"
          type="button"
        >
          <ActiveCamIcon size={13} strokeWidth={1.8} />
        </button>
      </div>

      {/* Expanded camera options — floats to the right with a gap */}
      {camExpanded && (
        <div className={styles.camOptions}>
          {CAMERA_MODES.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              className={`${styles.camBtn} ${cameraMode === mode ? styles.camBtnActive : ''}`}
              onClick={() => { onSetCameraMode(mode); setCamExpanded(false) }}
              title={label}
              type="button"
            >
              <Icon size={15} strokeWidth={1.8} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
