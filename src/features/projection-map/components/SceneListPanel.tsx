import { type CSSProperties, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import styles from './SceneListPanel.module.css'
import type { ProjectionMapPoint, SceneObjectSummary } from '../types/vectorMap.types'

const GLYPH_BASE = '/data/glyphs/'

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
  const listRef = useRef<HTMLUListElement>(null)

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
    <aside className={styles.panel} data-visible={visible}>
      <div className={styles.header}>
        <span className={styles.title}>Selected Scenes</span>
        <span className={styles.badge}>{scenes.length}</span>
        <button className={styles.clearBtn} type='button' onClick={onClear}>
          Clear
        </button>
      </div>

      <ul ref={listRef} className={styles.list}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(virtualItem => {
            const scene = scenes[virtualItem.index]
            const summary = scene.summary
            const objectGroups = buildObjectGroups(summary)
            const objectTotal =
              summary?.object_total_unique ??
              objectGroups.reduce((total, group) => total + group.count, 0)

            return (
              <li
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                className={styles.item}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`
                }}
              >
                <img
                  className={styles.thumb}
                  src={`${GLYPH_BASE}${scene.scene_name}.webp`}
                  alt={scene.scene_name}
                  width={92}
                  height={92}
                  loading='lazy'
                />
                <div className={styles.itemContent}>
                  <div className={styles.nameRow}>
                    <span className={styles.sceneName} title={scene.scene_name}>
                      {scene.scene_name}
                    </span>
                    <span className={styles.splitBadge} data-split={scene.split}>
                      {scene.split}
                    </span>
                    {summary?.location && (
                      <span className={styles.locationBadge} data-location={summary.location}>
                        {formatLocation(summary.location)}
                      </span>
                    )}
                  </div>
                  <p className={styles.description}>
                    {summary?.scene_description ?? 'No scene description available'}
                  </p>

                  <div
                    className={styles.objectChart}
                    aria-label={`${scene.scene_name} object distribution`}
                  >
                    {objectGroups.length > 0 ? (
                      <div className={styles.barRow}>
                        <div className={styles.stackedBar}>
                          {objectGroups.map(group => (
                            <span
                              key={group.key}
                              className={styles.barSegment}
                              data-group={group.key}
                              style={
                                {
                                  '--segment-width': `${Math.max(group.ratio * 100, 1.5)}%`
                                } as CSSProperties
                              }
                              title={`${group.label}: ${group.count} (${Math.round(group.ratio * 100)}%)`}
                            />
                          ))}
                        </div>
                        <span className={styles.barCount}>{objectTotal} unique</span>
                      </div>
                    ) : (
                      <div className={styles.noObjects}>No object counts</div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </div>
      </ul>
    </aside>
  )
}
