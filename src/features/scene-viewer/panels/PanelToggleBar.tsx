import { PanelRightClose, Camera, ChartNoAxesCombined, Layers3 } from 'lucide-react'

const cls = {
  bar: 'flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-1 border-b border-app-border px-1.5 py-1',
  tabs: 'flex items-center gap-1',
  button:
    'flex cursor-pointer items-center gap-1 rounded border-0 px-1.5 py-1.5 transition-colors hover:bg-app-row-hover hover:text-app-text-primary focus-visible:outline-2 focus-visible:outline-accent',
  active: 'bg-app-toggle-active-bg text-app-text-primary'
}

interface PanelToggleBarProps {
  activeTab: 'streams' | 'stats'
  onTabChange: (tab: 'streams' | 'stats') => void
  panelId: string
  camerasOpen: boolean
  onToggleCameras: () => void
  onCollapse: () => void
}

const TABS = [
  { id: 'streams', label: 'Streams', Icon: Layers3 },
  { id: 'stats', label: 'Stats', Icon: ChartNoAxesCombined }
] as const

export function PanelToggleBar({
  activeTab,
  onTabChange,
  panelId,
  camerasOpen,
  onToggleCameras,
  onCollapse
}: PanelToggleBarProps) {
  return (
    <div className={cls.bar}>
      <button
        className='grid h-7 w-6 shrink-0 cursor-pointer place-items-center rounded border-0 bg-transparent text-app-text-label transition-colors hover:bg-app-row-hover hover:text-app-text-primary focus-visible:outline-2 focus-visible:outline-accent'
        type='button'
        title='Collapse details panel'
        aria-label='Collapse details panel'
        aria-expanded={true}
        aria-controls={panelId}
        onClick={onCollapse}
      >
        <PanelRightClose size={14} aria-hidden='true' />
      </button>
      <div
        className={cls.tabs}
        role='tablist'
        aria-label='Scene details'
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const nextTab =
            event.key === 'Home'
              ? 'streams'
              : event.key === 'End'
                ? 'stats'
                : activeTab === 'streams'
                  ? 'stats'
                  : 'streams'
          onTabChange(nextTab)
          event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${nextTab}"]`)?.focus()
        }}
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            id={`${panelId}-${id}-tab`}
            data-tab={id}
            role='tab'
            aria-selected={activeTab === id}
            aria-controls={`${panelId}-${id}`}
            tabIndex={activeTab === id ? 0 : -1}
            className={`${cls.button} ${activeTab === id ? cls.active : 'bg-transparent text-app-text-label'}`}
            type='button'
            onClick={() => onTabChange(id)}
          >
            <Icon size={13} strokeWidth={1.8} aria-hidden='true' />
            <span className='text-[11px] font-medium'>{label}</span>
          </button>
        ))}
      </div>
      <button
        className={`${cls.button} ${camerasOpen ? cls.active : 'bg-transparent text-app-text-label'}`}
        type='button'
        aria-pressed={camerasOpen}
        title={camerasOpen ? 'Hide cameras panel' : 'Show cameras panel'}
        onClick={onToggleCameras}
      >
        <Camera size={13} strokeWidth={1.8} aria-hidden='true' />
        <span className='text-[11px] font-medium'>Cameras</span>
      </button>
    </div>
  )
}
