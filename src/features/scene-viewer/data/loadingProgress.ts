export type SceneLoadingPhase = 'index' | 'metadata' | 'first-frame' | 'parsing' | 'ready'

export interface SceneLoadingProgress {
  phase: SceneLoadingPhase
  loadedBytes: number
  totalBytes: number | null
}

const PHASE_PROGRESS: Record<SceneLoadingPhase, { start: number; end: number }> = {
  index: { start: 0, end: 8 },
  metadata: { start: 8, end: 58 },
  'first-frame': { start: 58, end: 92 },
  parsing: { start: 92, end: 98 },
  ready: { start: 100, end: 100 }
}

export function getLoadingPercent({
  phase,
  loadedBytes,
  totalBytes
}: SceneLoadingProgress): number | null {
  const range = PHASE_PROGRESS[phase]
  if (phase === 'ready') return 100
  if (totalBytes === null || totalBytes <= 0) return null

  const ratio = Math.max(0, Math.min(1, loadedBytes / totalBytes))
  return Math.round(range.start + (range.end - range.start) * ratio)
}

export function getLoadingLabel(phase: SceneLoadingPhase): string {
  switch (phase) {
    case 'index':
      return '正在获取场景目录'
    case 'metadata':
      return '正在下载场景结构'
    case 'first-frame':
      return '正在下载首帧数据'
    case 'parsing':
      return '正在解析并准备渲染'
    case 'ready':
      return '场景已就绪'
  }
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
