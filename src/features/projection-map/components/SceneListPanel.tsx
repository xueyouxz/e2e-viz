import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { LOCATIONS } from '../locations'
import { Box, RotateCcw, Search } from 'lucide-react'
import { GlyphThumbnail } from '../glyph/GlyphThumbnail'
import { useSceneMetadata } from '../data/useSceneMetadata'
import { sceneAvailabilityProbe } from '../data/sceneAvailability'
import type { ProjectionMapPoint } from '../types'

// Badge colours live with the data mapping instead of styling-only selectors.
const SPLIT_BG: Record<string, string> = { train: '#689cc2', val: '#a94c4c' }

const LOCATION_BG: { match: string; bg: string }[] = [
  { match: 'boston', bg: '#67897e' },
  { match: 'hollandvillage', bg: '#bdacdb' },
  { match: 'onenorth', bg: '#7b99a9' },
  { match: 'queenstown', bg: '#e3acc5' }
]

function locationBg(location: string): string | undefined {
  return LOCATION_BG.find(l => location.includes(l.match))?.bg
}

const cls = {
  panel: 'flex min-h-0 min-w-0 flex-col overflow-hidden bg-app-surface-raised',
  header: 'flex h-10 shrink-0 items-center gap-2 border-b border-app-page-border px-3',
  title: 'flex-1 text-[0.8rem] font-semibold tracking-[0.01em] text-app-text',
  headerAction:
    'grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded border-0 bg-transparent p-0 text-app-text-muted transition-colors hover:bg-app-row-hover hover:text-app-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
  search:
    'flex h-7 w-7 shrink-0 items-center overflow-hidden rounded border border-transparent transition-[width,border-color,background-color] duration-200 ease-out motion-reduce:transition-none',
  searchOpen: 'w-36 border-app-border-btn bg-app-surface',
  searchInput:
    'min-w-0 flex-1 border-0 bg-transparent py-1 pl-2 text-[0.75rem] text-app-text outline-none placeholder:text-app-text-dim',
  list: 'scene-list-scrollbar m-0 min-h-0 flex-1 list-none overflow-y-auto',
  item: 'group h-[120px] border-b border-app-page-border',
  itemButton:
    'flex h-full w-full cursor-pointer flex-row gap-2.5 border-0 bg-transparent px-3 py-2 text-left transition-colors duration-[120ms] hover:bg-app-row-hover focus-visible:bg-app-row-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
  thumb: 'h-[88px] w-[88px] shrink-0 rounded-sm bg-app-cell-bg object-cover',
  itemContent: 'flex min-w-0 flex-1 flex-col gap-[0.4rem] overflow-hidden pb-6',
  detailButton:
    'absolute right-3 bottom-1.5 flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1.5 py-1 text-accent transition-colors hover:bg-app-row-hover focus-visible:outline-2 focus-visible:outline-accent',
  nameRow: 'flex min-w-0 flex-col items-start gap-1',
  sceneName: 'min-w-0 truncate text-[0.8125rem] font-bold text-app-text',
  splitBadge: 'shrink-0 rounded px-1 py-px text-[0.6rem] font-semibold text-white uppercase',
  locationBadge: 'shrink-0 rounded px-1 py-px text-[0.6rem] font-semibold text-white capitalize',
  description:
    'm-0 max-h-[2.9rem] overflow-hidden text-[0.72rem] leading-[1.35] text-app-text-muted [mask-image:linear-gradient(to_bottom,#000_62%,transparent_100%)]'
}

function formatLocation(location?: string): string {
  return LOCATIONS.find(item => item.id === location)?.label ?? 'Unknown'
}

type Props = {
  scenes: ProjectionMapPoint[]
  searchableScenes: ProjectionMapPoint[]
  hasFilters?: boolean
  onReset: () => void
  onScenesLocate: (scenes: ProjectionMapPoint[]) => void
  onSceneOpen: (scene: ProjectionMapPoint) => void
  activeScene: string | null
}

export function SceneListPanel({
  scenes,
  searchableScenes,
  hasFilters = false,
  onReset,
  onScenesLocate,
  onSceneOpen,
  activeScene
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [availableScenes, setAvailableScenes] = useState<Set<string>>(() => new Set())

  async function checkAvailability(scene: ProjectionMapPoint): Promise<void> {
    if (availableScenes.has(scene.scene_name)) return
    if ((await sceneAvailabilityProbe.check(scene)) === 'available') {
      setAvailableScenes(previous => new Set(previous).add(scene.scene_name))
    }
  }
  // Triggers fetch on first scene selection; returns cached Map on subsequent renders.
  const meta = useSceneMetadata(scenes.length > 0)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredScenes = useMemo(
    () =>
      normalizedQuery
        ? searchableScenes.filter(scene => scene.scene_name.toLowerCase().includes(normalizedQuery))
        : scenes,
    [normalizedQuery, scenes, searchableScenes]
  )
  const showReset = hasFilters || filteredScenes.length !== searchableScenes.length

  const virtualizer = useVirtualizer({
    count: filteredScenes.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 120,
    overscan: 4
  })

  useEffect(() => {
    virtualizer.scrollToOffset(0)
  }, [filteredScenes, virtualizer])

  function toggleSearch(): void {
    setSearchOpen(open => {
      if (!open) {
        requestAnimationFrame(() => searchInputRef.current?.focus())
      }
      return !open
    })
  }

  function locateSearchResults(): void {
    if (normalizedQuery && filteredScenes.length) onScenesLocate(filteredScenes)
  }

  return (
    <section className={cls.panel} aria-label='Scenarios'>
      <div className={cls.header}>
        <span className={cls.title}>Scenarios</span>
        <form
          className={`${cls.search} ${searchOpen ? cls.searchOpen : ''}`}
          role='search'
          onSubmit={event => {
            event.preventDefault()
            locateSearchResults()
          }}
        >
          {searchOpen && (
            <input
              ref={searchInputRef}
              className={cls.searchInput}
              type='search'
              value={query}
              placeholder='Search scene name'
              aria-label='Search scene name'
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  setQuery('')
                  setSearchOpen(false)
                }
              }}
            />
          )}
          <button
            className={cls.headerAction}
            type='button'
            onClick={toggleSearch}
            aria-label={searchOpen ? 'Collapse scene search' : 'Expand scene search'}
            title={searchOpen ? 'Collapse scene search' : 'Expand scene search'}
            aria-expanded={searchOpen}
          >
            <Search size={15} strokeWidth={1.8} aria-hidden='true' />
          </button>
        </form>
        {showReset && (
          <button
            className={cls.headerAction}
            type='button'
            onClick={() => {
              setQuery('')
              onReset()
            }}
            aria-label='Reset scene list'
            title='Reset scene list'
          >
            <RotateCcw size={15} strokeWidth={1.8} aria-hidden='true' />
          </button>
        )}
      </div>

      {!filteredScenes.length && (
        <p className='m-0 px-4 py-6 text-center text-[0.75rem] leading-relaxed text-app-text-muted'>
          {normalizedQuery ? `No scenes match “${query.trim()}”.` : 'No scenes available.'}
        </p>
      )}
      <div ref={listRef} className={cls.list} role='list'>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(virtualItem => {
            const scene = filteredScenes[virtualItem.index]
            const summary = meta?.get(scene.scene_name)

            return (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                role='listitem'
                onPointerEnter={() => void checkAvailability(scene)}
                onFocusCapture={() => void checkAvailability(scene)}
                className={`${cls.item} ${activeScene === scene.scene_name ? 'bg-app-bg-hover' : ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`
                }}
              >
                <button
                  className={cls.itemButton}
                  type='button'
                  aria-label={`Locate ${scene.scene_name} in projection view`}
                  onClick={() => onScenesLocate([scene])}
                >
                  <GlyphThumbnail className={cls.thumb} sceneName={scene.scene_name} />
                  <div className={cls.itemContent}>
                    <div className={cls.nameRow}>
                      <span className={cls.sceneName} title={scene.scene_name}>
                        {scene.scene_name}
                      </span>
                      <div className='flex items-center gap-1 whitespace-nowrap'>
                        <span
                          className={cls.splitBadge}
                          style={{ background: SPLIT_BG[scene.split] }}
                        >
                          {scene.split}
                        </span>
                        {summary?.location && (
                          <span
                            className={cls.locationBadge}
                            style={{ background: locationBg(summary.location) }}
                          >
                            {formatLocation(summary.location)}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className={cls.description} title={summary?.scene_description}>
                      {summary?.scene_description ?? 'No scene description available'}
                    </p>
                  </div>
                </button>
                {(availableScenes.has(scene.scene_name) || activeScene === scene.scene_name) && (
                  <button
                    className={`${cls.detailButton} ${activeScene === scene.scene_name ? '' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'}`}
                    type='button'
                    aria-label={`View ${scene.scene_name} in 3D`}
                    aria-pressed={activeScene === scene.scene_name}
                    onClick={() => onSceneOpen(scene)}
                  >
                    <Box size={12} aria-hidden='true' />
                    <span className='text-[0.6875rem]'>View in 3D</span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
