import { formatByteSize, getLoadingLabel, getLoadingPercent } from './data/loadingProgress'
import type { SceneLoadingProgress } from './data/loadingProgress'

interface SceneLoadingOverlayProps {
  progress: SceneLoadingProgress
  fullScreen?: boolean
}

export function SceneLoadingOverlay({ progress, fullScreen = false }: SceneLoadingOverlayProps) {
  const percent = getLoadingPercent(progress)
  const transfer =
    progress.totalBytes === null
      ? `${formatByteSize(progress.loadedBytes)} 已接收`
      : `${formatByteSize(progress.loadedBytes)} / ${formatByteSize(progress.totalBytes)}`

  return (
    <div
      aria-busy='true'
      aria-live='polite'
      className={
        fullScreen
          ? 'flex h-full w-full items-center justify-center bg-app-surface-raised p-6'
          : 'absolute inset-0 z-20 flex items-center justify-center bg-app-surface-raised/88 p-6 backdrop-blur-[2px]'
      }
    >
      <div className='w-full max-w-[360px] rounded-lg border border-app-border bg-app-surface p-5 shadow-lg'>
        <div className='mb-1 text-sm font-semibold text-app-text-strong'>加载场景</div>
        <div className='text-xs text-app-text-muted'>{getLoadingLabel(progress.phase)}</div>

        <div className='mt-4 h-1.5 overflow-hidden rounded-full bg-app-surface-raised'>
          {percent === null ? (
            <div className='h-full w-2/5 animate-[scene-loading_1.2s_ease-in-out_infinite] rounded-full bg-accent' />
          ) : (
            <div
              className='h-full rounded-full bg-accent transition-[width] duration-200 ease-out'
              style={{ width: `${Math.max(4, percent)}%` }}
            />
          )}
        </div>

        <div className='mt-2 flex justify-between gap-3 text-[11px] tabular-nums text-app-text-muted'>
          <span>{transfer}</span>
          <span>{percent === null ? '正在传输' : `${percent}%`}</span>
        </div>
      </div>
    </div>
  )
}
