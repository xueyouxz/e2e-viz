import { useMemo } from 'react'
import { useSceneStore } from '../context'
import { HorizonChart } from './charts/HorizonChart'
import { EgoStateChart } from './charts/EgoStateChart'
import { ObjectCountChart } from './charts/ObjectCountChart'
import styles from './StatisticsPanel.module.css'

const GT_STREAM   = '/gt/objects/bounds'
const PRED_STREAM = '/pred/sparsedrive/objects/bounds'

interface MetricConfig {
  label: string
}

const METRIC_CONFIG: Record<string, MetricConfig> = {
  detection: { label: '检测' },
  mapping:   { label: '建图' },
  planning:  { label: '规划' },
}

const SCORE_METRICS = ['detection', 'mapping', 'planning'] as const

const CATEGORY_COLORS: Record<string, string> = {
  car: '#4B8CF8',
  pedestrian: '#16A34A',
  truck: '#0284C7',
  bicycle: '#D97706',
  bus: '#7C3AED',
  motorcycle: '#0D9488',
  trailer: '#4F46E5',
}

const GT_CATEGORIES   = ['car', 'pedestrian', 'truck']
const PRED_CATEGORIES = ['car', 'pedestrian']

const SPEED_COLOR = '#F59E0B'
const ACCEL_COLOR = '#22D3EE'

interface LegendProps {
  entries: { key: string; color: string; opacity: number }[]
}

function Legend({ entries }: LegendProps) {
  return (
    <div className={styles.legend}>
      {entries.map((e) => (
        <span key={e.key} className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: e.color, opacity: e.opacity }} />
          {e.key}
        </span>
      ))}
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className={styles.sectionHeader}>{children}</div>
}

function SceneInfoBlock({ name, description }: { name: string; description: string }) {
  return (
    <div className={styles.sceneInfo}>
      {name && <div className={styles.sceneName}>{name}</div>}
      {description && <div className={styles.sceneDesc}>{description}</div>}
    </div>
  )
}

interface StatisticsPanelProps {
  onClose: () => void
}

export function StatisticsPanel({ onClose }: StatisticsPanelProps) {
  const statistics    = useSceneStore((s) => s.statistics)
  const totalFrames   = useSceneStore((s) => s.totalFrames)
  const sceneName     = useSceneStore((s) => s.sceneName)
  const sceneDescription = useSceneStore((s) => s.sceneDescription)

  const gtSeries   = statistics?.objectCounts[GT_STREAM]
  const predSeries = statistics?.objectCounts[PRED_STREAM]

  const catKeys = useMemo(() => Array.from(new Set([...GT_CATEGORIES, ...PRED_CATEGORIES])), [])
  const legendEntries = useMemo(
    () =>
      catKeys
        .filter((k) => gtSeries?.categories[k] || predSeries?.categories[k])
        .map((k) => ({ key: k, color: CATEGORY_COLORS[k] ?? '#888', opacity: 0.75 })),
    [catKeys, gtSeries, predSeries],
  )

  const hasMetrics = statistics
    ? SCORE_METRICS.some((name) => statistics.metrics[name])
    : false

  const metricDomains = useMemo((): Record<string, [number, number]> => {
    const domains: Record<string, [number, number]> = {}
    for (const name of SCORE_METRICS) {
      const data = statistics?.metrics[name]
      if (!data || data.length === 0) { domains[name] = [0, 1]; continue }
      let dMax = 0
      for (let i = 0; i < data.length; i++) {
        if (data[i] > dMax) dMax = data[i]
      }
      domains[name] = [0, dMax > 0 ? dMax : 1]
    }
    return domains
  }, [statistics])

  if (!statistics) return null

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>统计信息</span>
        <button className={styles.closeBtn} onClick={onClose} title="收起">×</button>
      </div>

      <div className={styles.content}>
        {(sceneName || sceneDescription) && (
          <SceneInfoBlock name={sceneName} description={sceneDescription} />
        )}

        {hasMetrics && (
          <>
            <SectionHeader>场景指标</SectionHeader>
            {SCORE_METRICS.map((name) => {
              const cfg  = METRIC_CONFIG[name]
              const data = statistics.metrics[name] ?? null
              if (!data || !cfg) return null
              return (
                <HorizonChart
                  key={name}
                  data={data}
                  label={cfg.label}
                  domain={metricDomains[name]}
                  frameCount={totalFrames}
                  markers={name === 'planning' ? (statistics.metrics['collision'] ?? null) : null}
                />
              )
            })}
          </>
        )}

        <SectionHeader>自车状态</SectionHeader>
        <div className={styles.chartLegendRow}>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: SPEED_COLOR }} />速度
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: ACCEL_COLOR }} />加速度
          </span>
        </div>
        <EgoStateChart
          egoSpeed={statistics.egoSpeed}
          egoAcceleration={statistics.egoAcceleration}
          frameCount={statistics.frameCount}
        />

        <SectionHeader>目标计数对比</SectionHeader>
        <Legend entries={legendEntries} />
        <ObjectCountChart
          gtSeries={gtSeries}
          predSeries={predSeries}
          frameCount={totalFrames}
        />
      </div>
    </div>
  )
}
