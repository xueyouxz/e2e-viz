import { useMemo } from 'react'
import { useSceneStore } from '../context'
import { svgTokens } from '../styleConfig'
import { HorizonChart } from './charts/HorizonChart'
import { EgoStateChart } from './charts/EgoStateChart'
import { ObjectCountChart } from './charts/ObjectCountChart'
import { arrayMax } from './charts/chartUtils'
import './StatisticsPanel.css'

const METRICS = [
  { name: 'detection', label: 'Detection' },
  { name: 'mapping', label: 'Mapping' },
  { name: 'planning', label: 'Planning' }
] as const

export function StatisticsPanel() {
  const statistics = useSceneStore(s => s.statistics)
  const totalFrames = useSceneStore(s => s.totalFrames)
  const metrics = useMemo(
    () =>
      METRICS.flatMap(metric => {
        const data = statistics?.metrics[metric.name]
        return data?.length
          ? [{ ...metric, data, domain: [0, arrayMax(data)] as [number, number] }]
          : []
      }),
    [statistics]
  )

  if (!statistics) return null

  return (
    <div className='scene-statistics'>
      {metrics.length > 0 && (
        <section className='scene-statistics-section' aria-label='Metric'>
          <div className='scene-statistics-heading'>
            <h3>Metric</h3>
            <div className='scene-statistics-ramp' aria-label='Metric values from low to high'>
              <span>Low</span>
              {svgTokens.chart.horizonBands.map(color => (
                <i key={color} style={{ background: color }} />
              ))}
              <span>High</span>
            </div>
          </div>
          {metrics.map(metric => (
            <HorizonChart
              key={metric.name}
              data={metric.data}
              label={metric.label}
              domain={metric.domain}
              frameCount={totalFrames}
              markers={metric.name === 'planning' ? statistics.metrics.collision : undefined}
            />
          ))}
        </section>
      )}
      <section className='scene-statistics-section' aria-label='Ego state'>
        <h3>Ego state</h3>
        <EgoStateChart
          egoSpeed={statistics.egoSpeed}
          egoAcceleration={statistics.egoAcceleration}
          frameCount={statistics.frameCount}
        />
      </section>
      <section className='scene-statistics-section' aria-label='Object'>
        <ObjectCountChart
          gtSeries={statistics.objectCounts['/gt/objects/bounds']}
          frameCount={totalFrames}
        />
      </section>
    </div>
  )
}
