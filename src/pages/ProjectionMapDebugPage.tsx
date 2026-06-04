import { useNavigate } from 'react-router-dom'
import { ProjectionMapDebug } from '@/components/projection-map/ProjectionMapDebug'
import { useProjectionMapData } from '@/hooks/useProjectionMapData'

const cls = {
  page: 'flex h-screen w-screen flex-col overflow-hidden bg-app-surface font-body',
  header:
    'flex h-11 shrink-0 items-center gap-3 border-b border-app-border bg-app-surface-raised px-4',
  backBtn:
    'cursor-pointer rounded-[5px] border border-app-border-btn bg-transparent px-2.5 py-1 font-mono text-[12px] text-app-text-label transition-colors hover:border-app-border-hover hover:text-app-text-primary',
  title: 'font-mono text-[13px] font-medium text-app-text-primary',
  badge:
    'rounded border border-[rgb(245_200_66/28%)] bg-[rgb(245_200_66/12%)] px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] text-[#f5c842]',
  body: 'flex min-h-0 flex-1',
  status: 'm-auto font-mono text-[13px] text-app-text-dim',
  error:
    'm-auto rounded-[7px] border border-[rgb(248_113_113/20%)] bg-[rgb(248_113_113/8%)] px-4 py-3 font-mono text-[12px] text-[#f87171]'
}

export default function ProjectionMapDebugPage() {
  const { points, loading, error } = useProjectionMapData()
  const navigate = useNavigate()

  return (
    <div className={cls.page}>
      <header className={cls.header}>
        <button type='button' className={cls.backBtn} onClick={() => navigate('/projection-map')}>
          ← 返回
        </button>
        <span className={cls.title}>Projection Map · LOD Debug</span>
        <span className={cls.badge}>DEBUG</span>
      </header>

      <div className={cls.body}>
        {loading && <div className={cls.status}>Loading projection data…</div>}
        {error && <div className={cls.error}>{error}</div>}
        {!loading && !error && <ProjectionMapDebug points={points} />}
      </div>
    </div>
  )
}
