import { useEffect, useRef, useState } from 'react'
import { Navigation, ScanEye, Move3d } from 'lucide-react'
import type { CameraMode } from '../store/sceneStore'

const cls = {
  toolbar: 'absolute top-3 left-1/2 z-20 -translate-x-1/2',
  bar: 'flex items-center gap-[3px] rounded-[10px] border border-app-border-btn bg-app-panel-bg-solid p-[3px]',
  divider: 'mx-[3px] h-[18px] w-px shrink-0 bg-app-border-btn',
  btn: 'flex cursor-pointer items-center gap-[5px] rounded-[7px] border-none bg-transparent py-[5px] text-[11px] font-medium tracking-[0.02em] text-app-text-dim transition-colors hover:bg-app-row-hover hover:text-app-text-primary',
  btnActive: 'bg-app-toggle-active-bg text-app-text-primary',
  camOptions: 'absolute top-0 left-[calc(100%+8px)] flex animate-fade-slide items-center gap-1.5',
  camBtn:
    'flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg border-none bg-app-panel-bg-solid text-app-text-dim transition-colors hover:bg-app-bg-hover hover:text-app-text-primary',
  camBtnActive: 'bg-app-toggle-active-bg text-app-text-primary'
}

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
    <svg width='13' height='13' viewBox='0 0 14 14' aria-hidden>
      <polyline
        points='1,7 7,4 13,7'
        stroke='currentColor'
        strokeWidth='1.5'
        fill='none'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <polyline
        points='1,10 7,7 13,10'
        stroke='currentColor'
        strokeWidth='1.5'
        fill='none'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <polyline
        points='1,4 7,1 13,4'
        stroke='currentColor'
        strokeWidth='1.5'
        fill='none'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg width='13' height='13' viewBox='0 0 14 14' fill='none' aria-hidden>
      <rect x='1' y='3' width='12' height='9' rx='1.5' stroke='currentColor' strokeWidth='1.2' />
      <circle cx='7' cy='7.5' r='2.5' stroke='currentColor' strokeWidth='1.2' />
      <path d='M5 3V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V3' stroke='currentColor' strokeWidth='1.2' />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg width='13' height='13' viewBox='0 0 14 14' aria-hidden>
      <polyline
        points='1,11 4,7 7,9 10,4 13,2'
        stroke='currentColor'
        strokeWidth='1.5'
        fill='none'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

const CAMERA_MODES: { mode: CameraMode; label: string; Icon: typeof Navigation }[] = [
  { mode: 'follow', label: 'Follow', Icon: Navigation },
  { mode: 'bev', label: 'Top View', Icon: ScanEye },
  { mode: 'free', label: 'Free', Icon: Move3d }
]

export function PanelToggleBar({
  streamsOpen,
  camerasOpen,
  statsOpen,
  onToggleStreams,
  onToggleCameras,
  onToggleStats,
  cameraMode,
  onSetCameraMode
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

  const ActiveCamIcon = CAMERA_MODES.find(m => m.mode === cameraMode)?.Icon ?? Navigation

  return (
    <div ref={rootRef} className={cls.toolbar}>
      {/* Main pill */}
      <div className={cls.bar}>
        <button
          className={`${cls.btn} px-2.5 ${streamsOpen ? cls.btnActive : ''}`}
          onClick={onToggleStreams}
          title={streamsOpen ? 'Hide streams panel' : 'Show streams panel'}
          type='button'
        >
          <LayersIcon />
          <span>Streams</span>
        </button>

        <button
          className={`${cls.btn} px-2.5 ${camerasOpen ? cls.btnActive : ''}`}
          onClick={onToggleCameras}
          title={camerasOpen ? 'Hide cameras panel' : 'Show cameras panel'}
          type='button'
        >
          <CameraIcon />
          <span>Cameras</span>
        </button>

        <button
          className={`${cls.btn} px-2.5 ${statsOpen ? cls.btnActive : ''}`}
          onClick={onToggleStats}
          title={statsOpen ? 'Hide statistics panel' : 'Show statistics panel'}
          type='button'
        >
          <ChartIcon />
          <span>Stats</span>
        </button>

        <div className={cls.divider} />

        {/* Camera mode trigger — icon-only, shows active mode */}
        <button
          className={`${cls.btn} px-2 ${camExpanded ? cls.btnActive : ''}`}
          onClick={() => setCamExpanded(v => !v)}
          title='Camera view'
          type='button'
        >
          <ActiveCamIcon size={13} strokeWidth={1.8} />
        </button>
      </div>

      {/* Expanded camera options — floats to the right with a gap */}
      {camExpanded && (
        <div className={cls.camOptions}>
          {CAMERA_MODES.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              className={`${cls.camBtn} ${cameraMode === mode ? cls.camBtnActive : ''}`}
              onClick={() => {
                onSetCameraMode(mode)
                setCamExpanded(false)
              }}
              title={label}
              type='button'
            >
              <Icon size={15} strokeWidth={1.8} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
