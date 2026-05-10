import type { CSSProperties } from 'react'
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
  onClear: () => void
}

export function SceneListPanel({ scenes, onClear }: Props) {
  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Selected Scenes</span>
        {scenes.length > 0 && <span className={styles.badge}>{scenes.length}</span>}
        <button
          className={styles.clearBtn}
          type='button'
          disabled={scenes.length === 0}
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      {scenes.length === 0 ? (
        <div className={styles.empty}>
          <p>Draw a lasso on the map to select scenes</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {scenes.map(scene => {
            const summary = scene.summary
            const objectGroups = buildObjectGroups(summary)
            const objectTotal =
              summary?.object_total_unique ??
              objectGroups.reduce((total, group) => total + group.count, 0)

            return (
              <li key={scene.scene_name} className={styles.item}>
                <img
                  className={styles.thumb}
                  src={`${GLYPH_BASE}${scene.scene_name}.webp`}
                  alt={scene.scene_name}
                  width={72}
                  height={72}
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
                    <div className={styles.chartHeader}>
                      <span>Object distribution</span>
                      <span>{`${objectTotal} unique`}</span>
                    </div>

                    {objectGroups.length > 0 ? (
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
                    ) : (
                      <div className={styles.noObjects}>No object counts</div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
