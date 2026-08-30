import { type CSSProperties, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { GlyphThumbnail } from '../glyph/GlyphThumbnail'
import { useSceneMetadata, type SceneObjectSummary } from '../data/useSceneMetadata'
import type { ProjectionMapPoint } from '../types'

type ObjectGroupKey = 'vehicle' | 'pedestrian' | 'movable' | 'static' | 'animal' | 'other'

type ObjectGroupDatum = {
  key: ObjectGroupKey
  label: string
  count: number
  ratio: number
}

const OBJECT_GROUP_LABELS: Record<ObjectGroupKey, string> = {
  vehicle: 'Vehicle',
  pedestrian: 'Pedestrian',
  movable: 'Movable',
  static: 'Static',
  animal: 'Animal',
  other: 'Other'
}

// Badge/segment colours moved out of CSS data-attribute selectors into JS maps,
// applied via inline style so the styling-only data attributes can be dropped.
const SPLIT_BG: Record<string, string> = { train: '#689cc2', val: '#a94c4c' }

const LOCATION_BG: { match: string; bg: string }[] = [
  { match: 'boston', bg: '#67897e' },
  { match: 'hollandvillage', bg: '#bdacdb' },
  { match: 'onenorth', bg: '#7b99a9' },
  { match: 'queenstown', bg: '#e3acc5' }
]

const GROUP_BG: Record<ObjectGroupKey, string> = {
  vehicle: '#2f7ed8',
  pedestrian: '#d95f59',
  movable: '#33a36f',
  static: '#8f6bc8',
  animal: '#c98922',
  other: '#7a8597'
}

function locationBg(location: string): string | undefined {
  return LOCATION_BG.find(l => location.includes(l.match))?.bg
}

const cls = {
  panel:
    'flex h-full w-[clamp(320px,26vw,400px)] shrink-0 -translate-x-full flex-col overflow-hidden border-r border-app-page-border bg-app-surface-raised transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] data-[visible=true]:translate-x-0 max-[720px]:w-[min(86vw,360px)]',
  header: 'flex h-10 shrink-0 items-center gap-2 border-b border-app-page-border px-3',
  title: 'flex-1 text-[0.8rem] font-semibold tracking-[0.01em] text-app-text',
  badge:
    'grid h-[1.375rem] min-w-[1.375rem] place-items-center rounded-[10px] bg-accent px-[0.3rem] text-[0.7rem] font-bold text-white',
  clearBtn:
    'cursor-pointer rounded border border-app-border-btn bg-transparent px-2 py-[0.2rem] text-[0.75rem] text-app-text-muted transition-colors disabled:cursor-default disabled:opacity-40 enabled:hover:border-[#c0392b] enabled:hover:text-[#c0392b]',
  list: 'm-0 flex-1 list-none overflow-y-auto px-2.5',
  item: 'flex flex-row gap-2.5 rounded-[7px] border border-app-card-border bg-app-surface p-[0.425rem] transition-[border-color,box-shadow] duration-[120ms] hover:border-app-border-hover hover:shadow-app-card-hover',
  thumb: 'h-[92px] w-[92px] shrink-0 rounded-sm bg-app-cell-bg object-cover',
  itemContent: 'flex min-w-0 flex-1 flex-col gap-[0.45rem]',
  nameRow: 'flex min-w-0 flex-wrap items-center gap-1.5',
  sceneName: 'min-w-0 truncate text-[0.95rem] font-bold text-app-text',
  splitBadge: 'shrink-0 rounded-md px-1.5 py-0.5 text-[0.6rem] font-semibold text-white uppercase',
  locationBadge:
    'shrink-0 rounded-md px-1.5 py-0.5 text-[0.6rem] font-semibold text-white capitalize',
  description: 'm-0 line-clamp-2 text-[0.72rem] leading-[1.35] text-app-text-muted',
  objectChart: 'flex min-w-0 flex-col gap-[0.35rem]',
  barRow: 'flex items-center gap-2',
  barCount: 'shrink-0 text-[0.65rem] font-semibold whitespace-nowrap text-app-text-muted',
  stackedBar: 'flex h-2 flex-1 overflow-hidden rounded-[3px] bg-app-border',
  barSegment: 'min-w-[2px]',
  noObjects: 'text-[0.7rem] text-app-text-dim'
}

function getObjectGroup(category: string): ObjectGroupKey {
  if (category.startsWith('vehicle.')) return 'vehicle'
  if (category.startsWith('human.pedestrian.')) return 'pedestrian'
  if (category.startsWith('movable_object.')) return 'movable'
  if (category.startsWith('static_object.')) return 'static'
  if (category === 'animal' || category.startsWith('animal.')) return 'animal'
  return 'other'
}

function buildObjectGroups(summary?: SceneObjectSummary): ObjectGroupDatum[] {
  if (!summary) return []

  const counts = new Map<ObjectGroupKey, number>()
  let total = 0
  for (const [category, count] of Object.entries(summary.object_counts_by_category)) {
    if (count <= 0) continue
    const key = getObjectGroup(category)
    counts.set(key, (counts.get(key) ?? 0) + count)
    total += count
  }

  if (total === 0) return []

  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: OBJECT_GROUP_LABELS[key],
      count,
      ratio: count / total
    }))
    .sort((a, b) => b.count - a.count)
}

function formatLocation(location?: string): string {
  return location?.replace(/-/g, ' ') ?? 'Unknown'
}

type Props = {
  scenes: ProjectionMapPoint[]
  visible: boolean
  onClear: () => void
}

export function SceneListPanel({ scenes, visible, onClear }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  // Triggers fetch on first scene selection; returns cached Map on subsequent renders.
  const meta = useSceneMetadata(scenes.length > 0)

  const virtualizer = useVirtualizer({
    count: scenes.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 108,
    gap: 10,
    paddingStart: 10,
    paddingEnd: 10,
    overscan: 4
  })

  return (
    <aside className={cls.panel} data-visible={visible}>
      <div className={cls.header}>
        <span className={cls.title}>Selected Scenes</span>
        <span className={cls.badge}>{scenes.length}</span>
        <button className={cls.clearBtn} type='button' onClick={onClear}>
          Clear
        </button>
      </div>

      <div ref={listRef} className={cls.list} role='list'>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(virtualItem => {
            const scene = scenes[virtualItem.index]
            const summary = meta?.get(scene.scene_name)
            const objectGroups = buildObjectGroups(summary)
            const objectTotal =
              summary?.object_total_unique ??
              objectGroups.reduce((total, group) => total + group.count, 0)

            return (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                role='listitem'
                className={cls.item}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`
                }}
              >
                <GlyphThumbnail className={cls.thumb} sceneName={scene.scene_name} />
                <div className={cls.itemContent}>
                  <div className={cls.nameRow}>
                    <span className={cls.sceneName} title={scene.scene_name}>
                      {scene.scene_name}
                    </span>
                    <span className={cls.splitBadge} style={{ background: SPLIT_BG[scene.split] }}>
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
                  <p className={cls.description}>
                    {summary?.scene_description ?? 'No scene description available'}
                  </p>

                  <div
                    className={cls.objectChart}
                    aria-label={`${scene.scene_name} object distribution`}
                  >
                    {objectGroups.length > 0 ? (
                      <div className={cls.barRow}>
                        <div className={cls.stackedBar}>
                          {objectGroups.map(group => (
                            <span
                              key={group.key}
                              className={cls.barSegment}
                              style={
                                {
                                  flex: `0 0 ${Math.max(group.ratio * 100, 1.5)}%`,
                                  background: GROUP_BG[group.key]
                                } as CSSProperties
                              }
                              title={`${group.label}: ${group.count} (${Math.round(group.ratio * 100)}%)`}
                            />
                          ))}
                        </div>
                        <span className={cls.barCount}>{objectTotal} unique</span>
                      </div>
                    ) : (
                      <div className={cls.noObjects}>No object counts</div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
