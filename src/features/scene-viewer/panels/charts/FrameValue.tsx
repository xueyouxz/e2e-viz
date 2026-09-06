import { useSceneStore } from '../../context'

interface FrameValueProps {
  data: Float32Array | null | undefined
  format?: (value: number) => string
  unit?: string
}

/** Only the readout subscribes to the current value; chart paths stay unchanged during playback. */
export function FrameValue({ data, format, unit }: FrameValueProps) {
  const value = useSceneStore(s => data?.[s.displayedFrameIndex])
  const label =
    value == null || !Number.isFinite(value)
      ? '—'
      : format
        ? format(value)
        : String(Number(value.toFixed(2)))
  return (
    <span className='scene-statistics-value'>
      {label}
      {unit && <span className='scene-statistics-unit'>{unit}</span>}
    </span>
  )
}
