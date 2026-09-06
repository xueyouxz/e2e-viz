# SceneViewer 架构重构与热路径优化实施方案

> 状态：历史实施记录，已被后续模块收敛替代。文中的 SceneSession、SceneRepository、FrameDecoder 和 rendererRegistry 不是当前实现要求。现行结构以根目录 CLAUDE.md、CONTEXT.md 和 ADR-0007 为准。

## 1. 目标与范围

本方案处理以下问题：

1. Scene session 生命周期分散。
2. Playback 存在两套时钟和未使用的泛化实现。
3. Frame decoder 的 Worker 与主线程 fallback 行为不一致。
4. Camera 投影、绘制和选取逻辑分散。
5. Renderer 热路径存在不必要的 React 更新、临时分配和 GPU 对象重建。
6. 删除无调用实现，保留具有实际约束的 seam。

目标是在不降低首帧加载、帧切换和三维渲染性能的前提下：

- 缩小公开 interface。
- 集中生命周期和资源所有权。
- 保持每个 `SceneViewer` 使用独立 Zustand store。
- 保持 Worker 解码、主线程创建 Blob URL。
- 保持 Renderer 直接管理 TypedArray、Three.js 对象和释放过程。
- 保持 `rendererRegistry`、Worker IPC 和纯数学函数等有效 seam。

本方案不修改 NUSVIZ 协议，不迁移渲染框架，不引入新的状态管理库。

## 2. 当前约束

必须遵守：

- [ADR-0001](./adr/0001-per-instance-scene-store.md)：store 必须按 `SceneViewer` 实例创建。
- [ADR-0002](./adr/0002-worker-parse-main-thread-materialize.md)：Worker 负责解码，Blob URL 在主线程创建和释放。
- [ADR-0003](./adr/0003-layer-renderer-split.md)：Renderer 持有完整渲染生命周期，不恢复已删除的 Layer 抽象。
- 后台 Frame 请求并发数保持为 2，用户请求优先于预取。
- Frame 缓存仍以当前窗口大小为默认值，不在结构重构中调整缓存策略。
- 文件移动与删除必须在同一阶段完成调用方迁移，不保留长期转发文件或双实现。

## 3. 命名规范

### 3.1 module 和类型

| 名称                      | 用途                                                    | 说明                                          |
| ------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| `SceneSession`            | 管理单个 Scene 的运行时生命周期                         | 代替分散在 View、hook 和 manager 中的时序控制 |
| `SceneRepository`         | 负责 Frame 获取、请求去重、队列、缓存和 Blob URL 所有权 | 代替职责过宽且语义模糊的 `SceneDataManager`   |
| `FrameDecoder`            | 统一 Worker 与主线程 fallback 的解码行为                | `decode` 表示二进制到领域数据的转换           |
| `PlaybackClock`           | 根据时间增量计算下一个 Frame                            | 不包含 React 或 DOM                           |
| `PlaybackTimeline`        | Scene 专用时间轴 UI                                     | 只保留受控行为                                |
| `CameraProjector`         | 生成六路相机共享的投影结果                              | 每个 `CameraPanel` 实例持有一个实例           |
| `CameraProjectionFrame`   | 单个 Frame 的投影、绘制和选取数据                       | 包含复用后的 image-space bounds               |
| `CameraViewportTransform` | 图片空间与容器空间的映射                                | 绘制与选取共用                                |

### 3.2 函数

- 创建资源：`createPointGeometry`、`createCanvasRenderScratch`。
- 原地更新：`updatePointGeometryInPlace`、`updateCoordinateTransformInPlace`。
- 容量管理：`ensurePointCapacity`、`ensurePathCapacity`。
- 释放资源：`disposeRendererResources`、`revokeFrameImageUrls`。
- 纯计算：`advancePlaybackClock`、`findNearestFrameIndex`、`computeViewportTransform`。
- 事件处理：React 内部使用 `handlePlay`、`handleSeek`；跨 module 回调使用 `onFrameApplied`、`onLoadingProgress`。

### 3.3 变量

- 使用完整领域含义：`requestedFrameIndex`、`latestRequestId`、`decodedFrame`、`cameraProjectionFrame`。
- Three.js 临时量按实例保存为 `scratchPosition`、`scratchQuaternion`，不使用 `_v3`、`_mat4` 等缩写。
- Abort 对象使用 `lifecycleAbortController`、`frameRequestAbortController`。
- boolean 使用 `isDestroyed`、`isFrameRequestCurrent`，不使用 `flag`、`status` 等模糊名称。

## 4. 目标结构

```text
src/features/scene-viewer/
├── SceneViewer.tsx
├── SceneSession.ts
├── context.ts
├── index.ts
├── rendererRegistry.ts
├── store/
│   ├── sceneStore.ts
│   └── sceneStore.test.ts
├── data/
│   ├── SceneRepository.ts
│   ├── SceneRepository.test.ts
│   ├── FrameDecoder.ts
│   ├── FrameDecoder.test.ts
│   ├── GlbReader.ts
│   ├── MetadataParser.ts
│   ├── loadingProgress.ts
│   └── workers/
│       ├── frameDecoder.worker.ts
│       └── frameDecoderMessages.ts
├── playback/
│   ├── PlaybackClock.ts
│   ├── PlaybackClock.test.ts
│   ├── PlaybackTimeline.tsx
│   └── PlaybackTimeline.test.tsx
├── camera/
│   ├── CameraPanel.tsx
│   ├── cameraProjection.ts
│   ├── cameraRendering.ts
│   └── __test__/
│       ├── cameraProjection.test.ts
│       └── cameraRendering.test.ts
└── renderers/
    ├── rendererResources.ts
    ├── PointRenderer.tsx
    ├── PathRenderer.tsx
    ├── PolygonRenderer.tsx
    ├── CuboidRenderer.tsx
    └── ImageRenderer.tsx
```

目录调整只在对应实现稳定后执行。第一轮提交不做纯目录搬迁。

## 5. 行为与热路径实现基线

性能优化从代码内部实现和资源生命周期判断，不做外部计时、Profiler 采样或性能数值门禁。

| 检查项                    | 当前实现证据                                             | 目标条件                                          |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| Frame 请求调度            | `SceneDataManager` 的 queue、in-flight map 和 cache      | 关键请求优先、并发数 2、相同 Frame 去重           |
| React 高频订阅            | Renderer 和 `TimelineBar` 订阅 Frame 数据                | 高频数据改为 store imperative read 或 DOM 更新    |
| 播放时钟                  | `SceneEffects.useFrame()` 与 Timeline 内部 RAF 并存      | 只保留 R3F tick                                   |
| 热路径分配                | Path、Polygon、Camera 每 Frame 创建临时数组或 Three 对象 | scratch 与可增长 TypedArray 按组件实例复用        |
| GPU 资源重建              | 部分 Renderer 随 payload 替换 geometry、material 或 mesh | payload 变化时原地更新，仅容量不足时扩容          |
| 异步结果有效性            | hook cancellation 与 frameIndex check                    | request id、destroy guard 和 AbortSignal 同时约束 |
| Blob URL 与 Three.js 资源 | manager 和 Renderer 分别持有释放责任                     | 每个已创建资源只有一个 owner，并且恰好释放一次    |

每阶段至少运行功能测试。热路径阶段使用针对实现不变量的测试和静态搜索验收，不添加外部性能采集逻辑。

## 6. 影响文件总表

| 文件                                    | 变更         | 依赖关系                                                                |
| --------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| `SceneViewer.tsx`                       | 修改         | 依赖 `SceneSession`、Playback 和 Camera 完成                            |
| `SceneSession.ts`                       | 新建         | 依赖 `SceneRepository` 与现有 store                                     |
| `context.ts`                            | 修改         | `dataManager` 改为 `session` 或只保留 store                             |
| `store/sceneStore.ts`                   | 修改         | 增加 Scene 数据 reset，澄清偏好状态                                     |
| `hooks/useFrameData.ts`                 | 删除         | 被 `SceneSession` 吸收后删除                                            |
| `data/SceneDataManager.ts`              | 重命名并拆分 | 迁移到 `SceneRepository.ts` 与 `FrameDecoder.ts`                        |
| `data/MessageParser.ts`                 | 重命名       | 迁移到 `FrameDecoder.ts`                                                |
| `data/workers/messageParse.worker.ts`   | 重命名       | 依赖 `FrameDecoder.ts`                                                  |
| `data/workers/workerMessages.ts`        | 重命名       | 保留真实 IPC seam                                                       |
| `scene/SceneEffects.tsx`                | 修改或重命名 | 移除 playback 时钟，只保留渲染初始化责任                                |
| `panels/PlaybackTimeline.tsx`           | 移动并收敛   | 删除 uncontrolled 和未使用 options                                      |
| `panels/TimelineBar.tsx`                | 删除         | 被 Scene 专用 `PlaybackTimeline` 吸收                                   |
| `hooks/useCoordinateTransform.ts`       | 删除         | 被 Renderer imperative lifecycle 吸收                                   |
| `renderers/_shared.ts`                  | 重命名并收敛 | 删除无调用函数和模块级可变临时量                                        |
| 四个非 Cuboid Renderer                  | 修改         | 与 `CuboidRenderer` 使用一致更新模型                                    |
| `CameraPanel.tsx`                       | 移动并修改   | 依赖 `CameraProjector`                                                  |
| `useCameraProjectedBoxes.ts`            | 删除         | 被 projector 与 panel 吸收                                              |
| camera pure modules                     | 移动或保留   | 保持纯函数 test surface                                                 |
| `index.ts`                              | 修改         | 最终只公开 feature interface                                            |
| `CONTEXT.md`                            | 修改         | 增加 `SceneSession`、`SceneRepository`、`FrameDecoder`、`PlaybackClock` |
| `docs/adr/0003-layer-renderer-split.md` | 修改         | 同步最终 Renderer 实现约束和路径                                        |

## 7. 分阶段实施

### Phase 0：锁定行为和热路径实现基线

#### 实施

- [x] 为 `SceneDataManager` 补充当前行为测试，暂不改名。
- [x] 为 Scene 切换、销毁、并发 Frame 请求建立测试夹具。
- [x] 为 Playback 补充当前受控模式测试。
- [x] 为 Renderer 测试增加最小 store provider 和资源释放检查。
- [x] 记录第 5 节的热路径实现基线，不进行外部性能测量。

#### 必须覆盖的行为

- 首帧与 metadata 并行下载。
- 关键请求优先于后台预取。
- 相同 Frame 请求去重。
- COMPLETE_STATE 与 INCREMENTAL 的合并语义。
- 多个 `SceneViewer` 的 store 相互隔离。
- 切换 Scene 后旧异步结果不能提交。
- Renderer 卸载后释放自身 Three.js 资源。

#### 验证

```bash
pnpm typecheck
pnpm exec vitest run src/features/scene-viewer
pnpm lint
```

#### 提交

```text
test(scene-viewer): lock behavior and hot-path invariants
```

#### 回滚与停止条件

- 本阶段只新增测试和实现审计记录，可整提交回滚。
- 如果现有行为无法稳定复现，停止后续结构修改，先修复测试夹具。

### Phase 1：统一 Frame decoder 双 adapter

#### 当前问题

`MessageParserWorker.setStreamsMeta()` 和 `parse()` 分离。Worker adapter 使用 `streamsMeta`，主线程 fallback 调用 `parseMessage(buffer)` 时没有传入 metadata，导致 polygon 可能被解析为 polyline。

#### 目标责任

- `FrameDecoder` 持有 `streamsMeta`。
- Worker adapter 与 main-thread adapter 输出相同的 `RawDecodedFrame`。
- `frameDecoderMessages.ts` 只描述 Worker IPC，不包含业务调度。
- Blob URL 仍由 `SceneRepository` 在主线程创建。

#### 文件和符号

| 当前                     | 目标                      |
| ------------------------ | ------------------------- |
| `MessageParser.ts`       | `FrameDecoder.ts`         |
| `parseMessage`           | `decodeFrame`             |
| `MessageParserWorker`    | `FrameDecoder`            |
| `messageParse.worker.ts` | `frameDecoder.worker.ts`  |
| `workerMessages.ts`      | `frameDecoderMessages.ts` |
| `raw`                    | `decodedFrame`            |

#### 实施

- [x] 先添加 fallback/Worker parity 测试，使用同一 polygon fixture。
- [x] 把 `streamsMeta` 变成 `FrameDecoder` 构造时必需数据，消除先 init 后 parse 的 temporal seam。
- [x] fallback 显式调用 `decodeFrame(buffer, streamsMeta)`。
- [x] Worker init 消息在 decoder 内部发送，调用方不再单独调用 `setStreamsMeta()`。
- [x] 保留 Transferable 收集和传递逻辑。
- [x] Worker error、destroy 和 pending promise rejection 使用明确的 `FrameDecoderDestroyedError` 或统一 `Error` 文本，不静默挂起。
- [x] 同一提交完成 import、Worker URL、测试路径和旧文件删除。

#### 测试

- polygon/polyline 判别一致。
- Worker 不可用时结果一致。
- Worker 返回错误时 promise reject。
- destroy 后 pending decode 全部 reject。
- Transferable 数量与底层 ArrayBuffer 不重复。

#### 验证

```bash
pnpm typecheck
pnpm exec vitest run src/features/scene-viewer/data
pnpm build
```

#### 提交

```text
refactor(scene-viewer): unify frame decoder adapters
```

#### 回滚与停止条件

- 回滚整个提交即可恢复旧 Worker contract。
- Worker 构建产物失败、fallback parity 失败或解析耗时显著增加时停止。

### Phase 2：建立 SceneSession 并收拢生命周期

#### 当前问题

Scene 初始化、Frame 加载、store 提交、prefetch、buffer 更新和销毁分散在 `SceneViewer`、`useFrameData`、store 和 `SceneDataManager`。`onCacheUpdate` 是单槽可变回调，Scene 切换时旧 fetch 也不能被中止。

#### 目标责任

`SceneSession` 负责：

- 初始化 Scene。
- 订阅 `frameIndex` 并执行 latest-request-wins。
- 把解码完成的 Frame 提交到当前 store。
- 启动预取并更新连续 buffer 范围。
- Scene 切换、失败和销毁。
- 使旧异步任务失效。

`SceneRepository` 负责：

- HTTP 获取。
- 请求优先级、并发限制和去重。
- Frame cache 与淘汰。
- `RawDecodedFrame` materialize。
- Blob URL 创建和释放。
- repository 生命周期内的 fetch abort。

#### store 状态分类

Scene 切换时重置：

- `streamsMeta`
- `cameras`
- `totalFrames`
- `timestamps`
- `statistics`
- `sceneName`
- `sceneDescription`
- `staticStreamState`
- `streamState`
- `egoPose`
- `frameIndex`
- `isPlaying`
- `bufferEndFrame`
- `visibleStreams`
- `selectedTrackId`

保留为 Viewer 偏好：

- `cameraMode`
- `playbackSpeed`

新增 store action 使用 `resetSceneData()`，不使用含义模糊的 `reset()`。

#### 实施

- [x] 把 `SceneDataManager` 重命名为 `SceneRepository`，先保持行为不变。
- [x] repository 的 `fetch` 全部接收生命周期 `AbortSignal`。
- [x] 使用 `subscribeCacheChanges(listener)` 代替公开可变字段 `onCacheUpdate`。
- [x] 创建 `SceneSession`，内部保存 `latestFrameRequestId` 和 `isDestroyed`。
- [x] `SceneSession.start()` 先调用 `resetSceneData()`，再初始化 repository。
- [x] session 订阅 store 的 `frameIndex`；请求完成时同时检查 request id、当前 Frame 和销毁状态。
- [x] `SceneSession.destroy()` 依次取消订阅、abort fetch、终止 decoder、释放 Blob URL。
- [x] `SceneViewer` 只创建 session、订阅加载状态并渲染。
- [x] 删除 `useFrameData.ts` 和 `SceneContextValue.dataManager`。
- [x] 切换 `sceneUrl` 时复用当前 store 实例，但先完整重置 Scene 数据。

#### 关键函数命名

```text
SceneSession.start
SceneSession.destroy
SceneSession.handleFrameIndexChange
SceneSession.applyLoadedFrame
SceneRepository.loadFrame
SceneRepository.prefetchAround
SceneRepository.subscribeCacheChanges
SceneRepository.destroy
```

#### 测试

- sceneUrl 快速切换时只有最新 Scene 可写入 store。
- Frame 5 请求晚于 Frame 6 返回时不能覆盖 Frame 6。
- destroy 后未完成 fetch 被 abort。
- destroy 后晚到的 decode 不创建 Blob URL 或 cache entry。
- 所有 Blob URL 恰好释放一次。
- 两个 session 使用两个独立 store。
- reset 只重置 Scene 数据，保留 Viewer 偏好。

#### 验证

```bash
pnpm typecheck
pnpm exec vitest run src/features/scene-viewer/data src/features/scene-viewer/store
pnpm exec vitest run src/features/scene-viewer
pnpm build
```

#### 提交

```text
refactor(scene-viewer): centralize scene session lifecycle
```

#### 回滚与停止条件

- `SceneSession`、repository 重命名、调用方迁移和旧 hook 删除必须在同一提交中完成。
- 出现双 session、双 cache、Blob URL 重复释放或旧请求提交时停止。

### Phase 3：收敛 Playback 为单一时钟

#### 当前问题

- 实际播放时钟位于 `SceneEffects.useFrame()`。
- `PlaybackTimeline` 的 uncontrolled RAF 在当前仓库没有调用方。
- `TimelineBar` 订阅 `frameIndex`，使时间轴在播放期间逐 Frame React render。
- `Array.from(rawTimestamps)` 复制完整时间戳数组。
- markers、可选 format 和通用 options 没有第二个使用场景。

#### 目标责任

- `PlaybackClock.ts` 只包含时间推进和 Frame 计算。
- R3F 帧循环继续提供 `deltaSeconds`，但使用同一个 `PlaybackClock`。
- `PlaybackTimeline.tsx` 是 Scene 专用受控 UI。
- 时间轴游标通过 store subscription 和 DOM transform 更新，不通过逐 Frame React render。
- `Float32Array` 直接作为只读时间序列使用。

#### 实施

- [x] 提取纯函数 `advancePlaybackClock()` 和 `findNearestFrameIndex()`。
- [x] 使用真实 timestamps 计算 Frame，不再固定使用 `playbackSpeed * 5`。
- [x] 保留 R3F `useFrame` 作为唯一 tick 来源；删除 Timeline 内部 RAF。
- [x] 删除 `internalFrame`、`internalPlaying`、`isControlled` 分支。
- [x] 删除未使用的 `TimelineMarker`、`PlaybackTimelineOptions` 和自定义 `formatTick` interface。
- [x] 把 `TimelineBar` 的 store adapter 吸收到 `PlaybackTimeline`，随后删除 `TimelineBar.tsx`。
- [x] 时间轴根节点只订阅低频状态；frame cursor 使用 `store.subscribe()` 更新 `transform`。
- [x] 保留文件内私有 `Ruler`、`SliderTrack` 和 `PlayButton`，不把它们拆成独立文件。
- [x] 播放到末尾时明确提交最后一个 Frame 并 pause；再次 play 从 0 开始。
- [x] seek 时重置 clock anchor，避免下一 tick 跳回旧时间。

#### 测试

- 不规则 timestamps 下的推进。
- 0 Frame、1 Frame 和末尾行为。
- pause、resume、replay。
- 播放中 scrub 后从新位置继续。
- 不同 `playbackSpeed`。
- 100 次 Frame 更新不触发 `PlaybackTimeline` 主体 100 次 render。
- RAF 由 R3F 生命周期停止，不存在第二活动时钟。

#### 验证

```bash
pnpm typecheck
pnpm exec vitest run src/features/scene-viewer/playback
pnpm exec vitest run src/features/scene-viewer
pnpm lint
```

#### 热路径验收

- 时间轴 React render 次数不随 Frame 数线性增长。
- cursor 更新只写 `transform`，不读取同步布局。
- 不存在 Timeline 自有 RAF，播放只由 R3F tick 驱动。

#### 提交

```text
refactor(scene-viewer): use a single playback clock
```

#### 回滚与停止条件

- 整阶段回滚，不能同时保留两个时钟作为兼容方案。
- 出现游标与实际 Frame 不一致、seek 回跳或播放速度漂移时停止。

### Phase 4：优化 Renderer 热路径

#### 当前问题

`PointRenderer`、`PathRenderer`、`PolygonRenderer`、`ImageRenderer` 订阅 Frame 数据；`useCoordinateTransform` 又订阅 `egoPose`。Frame 更新会进入 React reconciliation。Path 每条 path 创建切线数组，Polygon 会创建多组数组和 Three.js 资源。

#### 统一生命周期

每个 Renderer 持有：

- 稳定的 store API 引用。
- 当前 payload、visibility、style 和 coordinate 的引用快照。
- 按实例创建的 Three.js 临时对象。
- 可增长的 TypedArray 和 GPU attribute。
- 明确的 mount、update、dispose 路径。

每次 R3F tick：

1. 通过 `store.getState()` 读取当前值。
2. 对 payload、visibility、egoPose 和 style 做引用或值比较。
3. 没有变化时立即返回。
4. 有变化时原地更新 matrix、TypedArray、draw range 和 material。
5. 仅当容量不足时扩容，扩容到 `nextPowerOfTwo(requiredCapacity)`。

#### 共享文件收敛

- `_shared.ts` 重命名为 `rendererResources.ts`。
- 删除无调用的 `normalizeDatum`。
- 保留纯函数 `nextPowerOfTwo`。
- `updateCoordinateTransformInPlace()` 接收目标 `Matrix4`，不创建新对象。
- 模块级 `_col`、`_v3`、`_mat4` 改为 Renderer 实例拥有的 scratch 对象，避免多 Viewer 共享可变状态。
- 不创建 `BaseRenderer`、`AbstractRenderer` 或通用继承体系。

#### PointRenderer

- [x] 删除 reactive payload、visibility、frameIndex、egoPose subscription。
- [x] point count 超过容量时才扩容 geometry。
- [x] 只写实际 draw range。
- [x] style 没变化时不重写颜色 buffer。
- [x] 卸载时释放 geometry 和 material。

#### PathRenderer

- [x] 删除每条 path 的 `new Float32Array(n - 1)`。
- [x] 使用 Renderer 实例级 tangent buffer，按最大 path 长度扩容复用。
- [x] 移除固定 `MAX_RIBBON_VERTS` 静默截断；改为容量增长并设置显式告警上限。
- [x] 只有 payload 或影响几何的 style 改变时更新 buffer。
- [x] opacity 和 render order 只更新 material/object。

#### PolygonRenderer

- [x] 静态 polygon 依靠稳定 payload 引用只构建一次。
- [x] 动态 polygon 使用可增长 fill/outline buffer，复用 geometry 和 material。
- [x] triangulation scratch 数组按 Renderer 实例复用。
- [x] payload 未变时不重新 triangulate。
- [x] 不在 payload 更新时替换 React element tree。

#### ImageRenderer

- [x] 删除 mesh React state。
- [x] 用 payload token 防止旧 ImageBitmap decode 覆盖新 Frame。
- [x] decode 完成后直接替换 Renderer 持有的 texture/mesh，并释放旧资源。
- [x] payload 没变化时不重复 decode。
- [x] hidden 时保留已解码资源，只有 payload 变化或卸载时释放。

#### CuboidRenderer

- [x] 保留当前 zero-subscription 模型作为参考实现。
- [x] 把模块级 scratch 对象改为实例级。
- [x] 对超过 `MAX_CUBOIDS` 的数据增加显式告警，不静默改变协议行为。
- [x] 保持 selection、instance matrix、edge buffer 和 dispose 路径。

#### 删除

- [x] 删除 `hooks/useCoordinateTransform.ts`。
- [x] 删除旧 reactive update 分支。
- [x] 检查 `SceneViewer.tsx` 注释与实际实现一致。

#### 测试

保留现有 Renderer 行为和 dispose 测试。其余热路径约束通过代码检查、类型检查和现有 SceneViewer 测试验证，不增加逐项重复的实现细节测试。

#### 验证

```bash
pnpm typecheck
pnpm exec vitest run src/features/scene-viewer/renderers
pnpm exec vitest run src/features/scene-viewer
pnpm lint
pnpm build
```

#### 热路径验收

- 目标 Renderer 不再逐 Frame React render。
- payload 容量未增长时不创建新的 geometry、material 或 texture。
- Frame update 路径不创建逐对象 TypedArray 或 Three.js scratch 对象。

#### 提交

```text
perf(scene-viewer): move renderer updates off the react hot path
```

#### 回滚与停止条件

- 每种 Renderer 可独立提交和回滚，但同一 Renderer 内不能保留双更新路径。
- 出现 GPU 资源所有权不清、对象选择错误或 world/ego 坐标错误时停止。

### Phase 5：收拢 Camera 投影、绘制和选取

#### 当前问题

- `useCameraProjectedBoxes` 每 Frame 创建 center/size/rotation tuple、结果数组和 wireframe 对象。
- `CameraPanel` 与旧 Canvas helper 分别计算 cover viewport transform。
- hit test 重新过滤 points 并计算 bbox，绘制和选取可能使用不同几何。
- 六路相机由父级一次性 React 更新。

#### 目标责任

`CameraProjector`：

- 每个 `CameraPanel` 实例创建一次。
- 复用 camera matrix、box corner、projection 和 bounds scratch。
- 为六路 camera 生成 `CameraProjectionFrame`。
- 在投影时同时计算 image-space bounds。

`CameraViewportTransform`：

- 描述 source image 到 viewport 的 scale 和 offset。
- draw 与 pick 使用同一个实例。
- `cover` 和 `contain` 行为由纯函数测试。

`CameraViewport`：

- 每个 channel 一个稳定的私有 React subcomponent。
- 只处理当前 channel 的 image、canvas、resize 和 click。
- 通过 imperative canvas rendering 更新高频投影结果。

#### 符号命名

| 当前                        | 目标                           |
| --------------------------- | ------------------------------ |
| `useCameraProjectedBoxes`   | `CameraProjector.projectFrame` |
| `hitTestBoxes`              | `pickTrackAtViewportPoint`     |
| `boxes`                     | `projectedCuboids`             |
| `scale`/`offsetX`/`offsetY` | `viewportTransform` 的字段     |
| `_centerVec`                | `scratchCenter`                |
| `_boxCorners`               | `scratchCorners`               |
| `_cornerBuf`                | `scratchProjectedCorners`      |

#### 实施

- [x] 创建 `cameraProjection.ts`，迁移现有投影行为并保持输出一致。
- [x] `ProjectedCuboid` 增加投影时生成的 image-space bounds，避免 hit test 重算。
- [x] 提取纯函数 `computeViewportTransform()` 和 `pickTrackAtViewportPoint()`。
- [x] `cameraRendering` 使用已经计算的 viewport transform 和共享 frame 数据。
- [x] 将六路 cell 收敛为文件内私有 `CameraViewport`。
- [x] 订阅只覆盖 camera image、cuboid payload、egoPose、camera calibration 和 selection。
- [x] 高频投影结果使用 canvas imperative rendering；面板结构不随 Frame 重建。
- [x] 删除 `hooks/useCameraProjectedBoxes.ts`。
- [x] 将投影与渲染分别收敛到 `cameraProjection.ts` 和 `cameraRendering.ts`，不合入 React 文件。

#### 测试

保留最小纯函数与 projector 测试：六路 calibration 映射、相机后方剔除、`cover` 与 pick 坐标一致、重叠 bounds 选择和 projector 实例隔离。DPR、ResizeObserver 与选择重绘由单一 imperative lifecycle 代码路径和类型检查覆盖，不增加重复 DOM 测试。

#### 验证

```bash
pnpm typecheck
pnpm exec vitest run src/features/scene-viewer/camera
pnpm exec vitest run src/features/scene-viewer
pnpm lint
```

#### 热路径验收

- 每 Frame 不再为每个 cuboid 创建 center/size/rotation tuple。
- viewport transform 每个 channel、每次 resize 只计算一次。
- 面板主体不随 Frame 进行完整 React render。
- 每个 `CameraViewport` 复用 projector scratch、bounds 和 viewport transform。

#### 提交

```text
perf(scene-viewer): consolidate camera projection and picking
```

#### 回滚与停止条件

- projector、panel 迁移和旧 hook 删除在同一提交完成。
- 绘制与选取坐标不一致、六路映射错误或逐帧分配未下降时停止。

### Phase 6：删除无效实现并收紧 feature interface

#### 可删除实现

- [x] `rendererResources.ts` 中无调用的 `normalizeDatum`。
- [x] `SceneRepository.getLoadingProgress()`；当前使用 subscription 推送进度。
- [x] `SceneRepository.index` getter；没有外部调用方。
- [x] Playback uncontrolled state、第二套 RAF、markers 和未使用 options。
- [x] `TimelineBar.tsx`。
- [x] `useFrameData.ts`。
- [x] `useCoordinateTransform.ts`。
- [x] `useCameraProjectedBoxes.ts`。

删除前必须用 `rg` 再次确认无调用；删除后不建立兼容 re-export。

#### 必须保留的 seam

- `rendererRegistry`：NUSVIZ `StreamType` 到 Renderer 的集中映射。
- `frameDecoderMessages.ts`：Worker host 与 worker 的 IPC contract。
- Worker decode 与主线程 materialize：平台能力不同。
- per-instance Scene store：多 Viewer 隔离。
- camera projection 与 wireframe 纯函数：独立 test surface。
- Renderer 文件：每种 payload 和 GPU 生命周期不同，不建立通用基类。

#### feature interface

当前仓库外部调用方只需要 `SceneViewer`。最终 `index.ts` 只公开：

```ts
export { default as SceneViewer } from './SceneViewer'
export type { SceneViewerProps } from './SceneViewer'
```

以下实现不再从 feature 根导出：

- `createSceneStore`
- `useSceneStore`
- `useSceneStoreApi`
- `SceneRepository`
- `SceneStore`
- `StreamRendererProps`

`src/app/SceneViewerRoute.tsx` 改为通过 feature 根导入，禁止深层导入内部实现。

#### 文档

- [x] 更新 `CONTEXT.md` 的领域术语和真实目录。
- [x] 更新 ADR-0003 中 Renderer 热路径约束。
- [x] 更新 `docs/scene-loading-optimization.md` 中 `SceneRepository` 名称和后续约束。
- [x] 新增 ADR-0007，记录 SceneSession 的长期生命周期约束。

#### 验证

```bash
rg -n "SceneDataManager|MessageParserWorker|TimelineBar|useFrameData|useCoordinateTransform|useCameraProjectedBoxes|normalizeDatum" src docs --glob '!scene-viewer-architecture-refactor-plan.md'
pnpm typecheck
pnpm exec vitest run src/features/scene-viewer
pnpm test
pnpm lint
pnpm build
```

#### 提交

```text
refactor(scene-viewer): remove obsolete interfaces and update architecture docs
```

#### 回滚与停止条件

- 清理提交只能删除已无调用的实现。
- 发现仓库外公共消费者时停止收紧 `index.ts`，先确认兼容要求。

## 8. 阶段依赖

```text
Phase 0  行为测试与热路径实现审计
   ↓
Phase 1  Frame decoder 一致性
   ↓
Phase 2  SceneSession 生命周期
   ├──────────────┐
   ↓              ↓
Phase 3 Playback  Phase 4 Renderer
   └──────┬───────┘
          ↓
Phase 5 Camera projection
          ↓
Phase 6 删除与文档收敛
```

Phase 3 和 Phase 4 在 Phase 2 完成后可以分别实施，但不建议并行修改 `SceneViewer.tsx`。Phase 5 应在 Renderer/store 更新模型稳定后进行。

## 9. 全局风险

| 风险                              | 控制方式                                                     |
| --------------------------------- | ------------------------------------------------------------ |
| React render 减少但画面未及时更新 | payload/reference gate、draw range 检查和现有行为测试        |
| Scene 销毁后异步任务继续创建资源  | AbortSignal、request id 和 destroy guard 三层控制            |
| Worker 与 fallback 再次漂移       | 对同一 fixture 执行 parity 测试                              |
| 时间轴与实际 Frame 漂移           | 单一 PlaybackClock，seek 时重置 anchor                       |
| Polygon triangulation 仍产生分配  | 静态 Stream 单次构建，动态路径复用容量并检查实现不变量       |
| Camera draw 与 pick 坐标漂移      | 共享 `CameraViewportTransform` 和 image-space bounds         |
| 目录收敛造成 mock/import 遗漏     | 同阶段搜索 `import`、dynamic import、Worker URL 和 `vi.mock` |
| 优化引入过度抽象                  | 不创建 BaseRenderer、BaseRepository 或单调用方转发 module    |

## 10. 最终验收

全部满足后才视为完成：

- [x] 所有现有 SceneViewer 行为保持一致。
- [x] Worker 与 fallback 解码 parity 测试通过。
- [x] Scene 切换和销毁后无旧请求提交。
- [x] Worker、RAF、fetch、Blob URL 和 Three.js 资源无泄漏。
- [x] Renderer 和时间轴不再按 Frame 触发不必要的 React render。
- [x] world Stream 不因 egoPose 更新执行无效 geometry 更新。
- [x] 高频更新路径不创建逐 Frame 临时数组或 Three.js 对象。
- [x] geometry、material、texture、Worker、fetch 和 Blob URL 的 owner 与释放路径明确。
- [x] 正常构建与现有 bundle 检查通过。
- [x] 不存在旧新双实现和兼容转发文件。
- [x] `CONTEXT.md`、ADR 和加载文档与最终代码一致。
- [x] `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build` 全部通过。
