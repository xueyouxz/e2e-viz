import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { createSceneStore } from './store/sceneStore'
import { SceneCtx, useSceneStore } from './context'
import { SceneDataManager } from './data/SceneDataManager'
import { useFrameData } from './hooks/useFrameData'
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
import styles from './SceneViewer.module.css'

interface SceneViewerProps {
  sceneUrl: string
}

// ─── 顶层加载组件 ─────────────────────────────────────────────────────────────
//
// 职责：加载场景元数据并初始化 Zustand store，完成后渲染内层组件。
// store 用 useState 初始化一次（factory 形式），保证同一 sceneUrl
// 切换时不会复用旧 store 实例（sceneUrl 变化会重新执行 useEffect）。

export default function SceneViewer({ sceneUrl }: SceneViewerProps) {
  // createSceneStore 工厂形式：每次组件挂载创建独立 store 实例（ADR-0001）
  const [store] = useState(() => createSceneStore())
  const [dataManager, setDataManager] = useState<SceneDataManager | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 当 sceneUrl 变化时重新加载：创建新的 SceneDataManager，
  // 解析 metadata.glb 拿到场景元数据后写入 store，
  // cancelled flag 防止 sceneUrl 切换时旧请求的回调污染新状态
  useEffect(() => {
    setLoading(true)
    setError(null)

    const manager = new SceneDataManager(sceneUrl)
    let cancelled = false

    manager
      .init()
      .then(({ metadata, initialStreamState }) => {
        if (cancelled) return
        store.getState().setMetadata(metadata, initialStreamState)
        setDataManager(manager)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
      // destroy 会终止 Worker、撤销所有 Blob URL（ADR-0002）
      manager.destroy()
    }
  }, [sceneUrl, store])

  if (loading) return <div>Loading scene…</div>
  if (error || !dataManager) return <div>⚠ Failed to load scene: {error}</div>

  // 通过 Context 将 store 和 dataManager 一起下传，
  // 子组件通过 useSceneStore / useSceneStoreApi 按需订阅，不经过 props drilling
  return (
    <SceneCtx.Provider value={{ store, dataManager }}>
      <SceneViewerInner />
    </SceneCtx.Provider>
  )
}

// ─── 帧数据同步组件 ──────────────────────────────────────────────────────────
//
// 孤立叶节点：仅调用 useFrameData hook，本身不渲染任何 DOM。
// 将帧加载引起的 re-render 隔离在此节点，避免污染主布局树。

function FrameDataSync() {
  useFrameData()
  return null
}

// ─── 主内层布局组件 ──────────────────────────────────────────────────────────
//
// 负责：
// 1. 订阅 store 中用于布局决策的最小切片（streamsMeta、cameraMode）
// 2. 管理三个面板（Streams / Cameras / Stats）的开关状态
// 3. 将流元数据映射为渲染器组件列表，传入 Canvas

function SceneViewerInner() {
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
    <div className={styles.root}>
      {/* 帧数据同步：渲染 null，隔离 frameIndex 变化引起的重渲染 */}
      <FrameDataSync />

      {/* 画布区域：包含三维 Canvas 和所有浮层面板 */}
      <div className={styles.canvasArea}>
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
