import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { createSceneStore } from './store/sceneStore'
import { SceneCtx, useSceneStore } from './context'
import { SceneSession } from './SceneSession'
import { layerRegistry } from './layerRegistry'
import { getStyle } from './styleConfig'
import { CameraController } from './scene/CameraController'
import { SceneEffects } from './scene/SceneEffects'
import { EgoVehicle } from './scene/EgoVehicle'
import { SelectedObjectIcon } from './scene/SelectedObjectIcon'
import { StreamPanel } from './panels/StreamPanel'
import { CameraPanel } from './panels/CameraPanel'
import { StatisticsPanel } from './panels/StatisticsPanel'
import { PanelToggleBar } from './panels/PanelToggleBar'
import { TimelineBar } from './panels/TimelineBar'
import { SceneLoadingOverlay } from './SceneLoadingOverlay'
import type { SceneLoadingProgress } from './data/loadingProgress'

export interface SceneViewerProps {
  sceneUrl: string
}

// ─── 顶层加载组件 ─────────────────────────────────────────────────────────────
//
// 职责：创建单个 Viewer store，并把 sceneUrl 生命周期交给 SceneSession。

export default function SceneViewer({ sceneUrl }: SceneViewerProps) {
  // createSceneStore 工厂形式：每次组件挂载创建独立 store 实例（ADR-0001）
  const [store] = useState(() => createSceneStore())
  const contextValue = useMemo(() => ({ store }), [store])
  const [sessionReady, setSessionReady] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState<SceneLoadingProgress>({
    phase: 'index',
    loadedBytes: 0,
    totalBytes: null
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSessionReady(false)
    setError(null)

    const session = new SceneSession(sceneUrl, store)
    let isCurrentSession = true
    const unsubscribeLoadingProgress = session.subscribeLoadingProgress(setLoadingProgress)

    session
      .start()
      .then(() => {
        if (isCurrentSession) setSessionReady(true)
      })
      .catch((error: unknown) => {
        if (!isCurrentSession) return
        setError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      isCurrentSession = false
      unsubscribeLoadingProgress()
      session.destroy()
    }
  }, [sceneUrl, store])

  if (error) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-app-surface-raised p-6'>
        <div className='max-w-[420px] text-center text-sm text-app-text-muted'>
          无法加载场景：{error}
        </div>
      </div>
    )
  }

  if (!sessionReady) return <SceneLoadingShell progress={loadingProgress} />

  return (
    <SceneCtx.Provider value={contextValue}>
      <SceneViewerInner loadingProgress={loadingProgress} />
    </SceneCtx.Provider>
  )
}

function SceneLoadingShell({ progress }: { progress: SceneLoadingProgress }) {
  return (
    <div className='flex h-full w-full flex-col bg-app-surface-raised'>
      <div className='relative min-h-0 flex-1'>
        <div className='absolute top-4 left-4 h-28 w-52 rounded-md border border-app-border bg-app-surface/70' />
        <div className='absolute top-4 right-4 h-40 w-56 rounded-md border border-app-border bg-app-surface/70' />
        <SceneLoadingOverlay progress={progress} />
      </div>
      <div className='h-[62px] border-t border-app-border bg-app-surface' />
    </div>
  )
}

// ─── 主内层布局组件 ──────────────────────────────────────────────────────────
//
// 负责：
// 1. 订阅 store 中用于布局决策的最小切片（streamsMeta、cameraMode）
// 2. 管理三个面板（Streams / Cameras / Stats）的开关状态
// 3. 将流元数据映射为渲染器组件列表，传入 Canvas

function SceneViewerInner({ loadingProgress }: { loadingProgress: SceneLoadingProgress }) {
  const streamsMeta = useSceneStore(s => s.streamsMeta)
  const cameraMode = useSceneStore(s => s.cameraMode)
  const setCameraMode = useSceneStore(s => s.setCameraMode)

  const [streamsOpen, setStreamsOpen] = useState(false)
  const [camerasOpen, setCamerasOpen] = useState(true)
  const [statsOpen, setStatsOpen] = useState(true)

  // 这些处理器不用 useCallback 包裹：
  // StreamPanel、StatisticsPanel、PanelToggleBar 均未被 React.memo 包裹，
  // 稳定引用不能阻止它们的 re-render，包裹只会增加复杂度而无收益。
  // SceneViewerInner 仅在 streamsMeta 或 cameraMode 变化时 re-render，频率很低。

  // 根据流类型从注册表中查找对应 Renderer 组件。
  // pose 类型不参与注册（由 EgoVehicle 单独处理），通过 flatMap 过滤掉。
  // 依赖 streamsMeta，场景加载后仅计算一次。
  const layers = useMemo(() => {
    return Object.entries(streamsMeta).flatMap(([streamName, meta]) => {
      if (meta.type === 'pose') return []
      const Renderer = layerRegistry[meta.type]
      if (!Renderer) return []
      return [{ streamName, Renderer }]
    })
  }, [streamsMeta])

  return (
    <div className='flex h-full w-full flex-col'>
      {/* 画布区域：包含三维 Canvas 和所有浮层面板 */}
      <div className='relative min-h-0 flex-1'>
        {streamsOpen && <StreamPanel onClose={() => setStreamsOpen(false)} />}
        {statsOpen && <StatisticsPanel onClose={() => setStatsOpen(false)} />}
        {camerasOpen && <CameraPanel />}

        {/*
         * R3F Canvas 配置：
         * - flat: 禁用色调映射，使颜色与原始输入一致（适合 UI 色调的数据可视化）
         * - camera: 初始俯仰视角，up=[0,0,1] 使 Z 轴朝上（匹配 nuScenes 坐标系）
         * - antialias: 开启 MSAA 抗锯齿
         */}
        <Canvas
          flat
          camera={{ position: [0, -50, 80], up: [0, 0, 1], fov: 60 }}
          gl={{ antialias: true }}
        >
          <Suspense fallback={null}>
            {/* SceneEffects: 着色器预编译 + 帧同步驱动（内部无 React 订阅） */}
            <SceneEffects />
            {/* CameraController: follow / bev / free 三种模式的平滑过渡 */}
            <CameraController />
            <ambientLight intensity={0.5} />
            {/* EgoVehicle: 读取 egoPose 更新自身位姿，独立于流注册表 */}
            <EgoVehicle />
            {/*
             * 按注册表逐流渲染：每个 Renderer 组件完全自治，
             * 通过 useFrame + getState() 读取数据（零 React 订阅），
             * key=streamName 保证切换场景时旧组件被卸载并释放 GPU 资源
             */}
            {layers.map(({ streamName, Renderer }) => (
              <Renderer key={streamName} streamName={streamName} style={getStyle(streamName)} />
            ))}
            {/* SelectedObjectIcon: 在选中对象上方渲染浮动 SVG 图标 */}
            <SelectedObjectIcon />
          </Suspense>
        </Canvas>

        {loadingProgress.phase !== 'ready' && <SceneLoadingOverlay progress={loadingProgress} />}

        {/* 中央工具栏：面板开关 + 相机模式切换，由 CSS absolute 定位居中 */}
        <PanelToggleBar
          streamsOpen={streamsOpen}
          camerasOpen={camerasOpen}
          statsOpen={statsOpen}
          onToggleStreams={() => setStreamsOpen(v => !v)}
          onToggleCameras={() => setCamerasOpen(v => !v)}
          onToggleStats={() => setStatsOpen(v => !v)}
          cameraMode={cameraMode}
          onSetCameraMode={setCameraMode}
        />
      </div>

      {/* 底部时间轴：独立于画布区域，高度由自身内容决定 */}
      <TimelineBar />
    </div>
  )
}
