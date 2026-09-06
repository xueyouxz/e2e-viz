import { arc, pie, type PieArcDatum } from 'd3'

type DonutDatum<Id extends string = string> = {
  id: Id
  label: string
  description?: string
  total: number
  color: string
}

type Props<Id extends string> = {
  data: DonutDatum<Id>[]
  title: string
  selectedId: Id | null
  onSelect: (id: Id) => void
}

const ring = arc<PieArcDatum<DonutDatum>>().innerRadius(21).outerRadius(34)

export function CategoryDonutChart<Id extends string>({
  data,
  title,
  selectedId,
  onSelect
}: Props<Id>) {
  const total = data.reduce((sum, item) => sum + item.total, 0)
  const count =
    selectedId === null ? total : (data.find(item => item.id === selectedId)?.total ?? 0)
  const segments = pie<DonutDatum<Id>>()
    .sort(null)
    .startAngle(-Math.PI / 2)
    .endAngle((Math.PI * 3) / 2)
    .value(item => item.total)(data)
  const nonEmptySegments = segments.filter(segment => segment.value > 0)

  return (
    <figure className='m-0 flex min-w-0 flex-col gap-0.5'>
      <div className='flex min-w-0 items-start gap-3' role='group' aria-label={`${title} filters`}>
        <svg
          className='block h-[72px] w-[68px] shrink-0'
          viewBox='0 0 68 72'
          role='img'
          aria-label={`${title} distribution`}
        >
          <g transform='translate(34,36)'>
            <circle r={27.5} fill='none' strokeWidth={13} className='stroke-app-bar-track' />
            {segments.map(segment => {
              const item = segment.data
              const muted = selectedId !== null && selectedId !== item.id
              return (
                <path
                  key={item.id}
                  className='cursor-pointer'
                  d={ring(segment) ?? undefined}
                  fill={item.color}
                  fillOpacity={muted ? 0.15 : 1}
                  onClick={() => onSelect(item.id)}
                >
                  <title>
                    {item.description ?? item.label}: {item.total} scenes
                  </title>
                </path>
              )
            })}
            {selectedId !== null && nonEmptySegments.length > 1 && (
              <g className='pointer-events-none' aria-hidden='true'>
                {nonEmptySegments.map(segment => (
                  <line
                    key={segment.data.id}
                    x1={Math.sin(segment.startAngle) * 21}
                    y1={-Math.cos(segment.startAngle) * 21}
                    x2={Math.sin(segment.startAngle) * 34}
                    y2={-Math.cos(segment.startAngle) * 34}
                    stroke={segment.data.color}
                    strokeOpacity={0.65}
                    strokeWidth={0.8}
                  />
                ))}
              </g>
            )}
            <text
              textAnchor='middle'
              dominantBaseline='central'
              className='pointer-events-none fill-app-text text-[14px] font-semibold tabular-nums'
              aria-label={`${title}: ${count} matching scenes`}
            >
              {count}
            </text>
          </g>
        </svg>
        <div className='flex min-w-0 flex-col items-end pt-1 text-[8px] leading-3'>
          {data.map(item => (
            <button
              key={item.id}
              type='button'
              className='max-w-full cursor-pointer border-0 bg-transparent p-0 text-right outline-none focus-visible:underline'
              style={{
                color: item.color,
                fontWeight: selectedId === item.id ? 700 : 400
              }}
              aria-label={`Filter ${item.description ?? item.label}: ${item.total} scenes`}
              aria-pressed={selectedId === item.id}
              title={`${item.description ?? item.label}: ${item.total} scenes`}
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <figcaption className='w-[68px] text-center text-[10px] font-medium text-app-text-muted'>
        {title}
      </figcaption>
    </figure>
  )
}
