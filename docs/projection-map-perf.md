# 投影视图渲染与交互

## 模块职责

- `index.tsx`：拥有选中场景与 train/val 显示模式，协调常驻左栏和投影视图。
- `components/SceneSummary.tsx`：左栏上方 1/4 区域的数据总量、选中数量和 Train/Val 分布控件。
- `components/SceneListPanel.tsx`：左栏下方 3/4 区域的选中场景虚拟列表，无选择时显示操作提示。
- `components/ProjectionMapView.tsx`：组合 SVG 分布层与 Canvas glyph 层；拥有 D3 zoom 和每帧重绘。
- `spatial.ts`：坐标转换、网格索引、可见网格查询、数据空间多边形筛选与选区 fit。
- `glyph/glyphLayout.ts`：zoom 范围、glyph 尺寸、采样档位、hover 倍率和裁剪留白。
- `glyph/glyphCanvasRenderer.ts`：Atlas 裁剪绘制、选中边框和命中检测。
- `useLassoSelection.ts`：套索草稿、指针捕获、完成/取消和数据空间选区。
- `useScenePreview.ts`：场景打开请求顺序、弹窗状态、全屏状态和短时提示。
- `data/`：投影与元信息缓存、场景可用性探测及共用请求重试。

## zoom 与尺寸

所有布局尺寸使用 1280×760 SVG viewBox 单位。容器缩放决定实际 CSS 像素尺寸，devicePixelRatio 只影响 Canvas 背板清晰度。

交互 zoom 范围为 1–16。zoom ≤4 时 glyph 边长为 50；之后按 log2(zoom) 上的 smoothstep 曲线增长，到 zoom=16 时为 62.5，最大增幅 25%。

采样网格基准边长为 80，使用 `snapGridScale(zoom / growth)` 选择预计算档位。目标屏幕网格边长为 80–100；受离散档位影响，实际边长为 `80 * zoom / gridScale`，会在档位边界出现小幅跳变。glyph 图像尺寸连续变化。

hover 放大 1.18 倍。视口查询的留白包含放大后的半径。每次绘制保存点集合与布局快照，点击和 hover 使用该快照，避免缩放时命中尺寸与画面不同步。

## 采样与渲染

points 或 scales 改变时，为 train/val 各自预建 17 个网格档位。每格选最接近网格中心的点；合并分类时继续比较距离，相等时按 scene_name 决胜。结果不依赖分类或输入排列顺序。

zoom 回调直接更新散点组的 transform 与半径，不更新 React state。glyph 重绘通过 requestAnimationFrame 合并，在同一帧用同一 transform 完成档位选择、可见网格查询、投影与绘制。密度等值线按 points/scales 缓存。

Train/Val 控件切换 glyph/scatter 显示模式，不隐藏数据，不限制最后一个 glyph 分类切换。两行柱状图由 React SVG 渲染，模式用外观及可访问标签区分；有选区时统一显示 selected/total，包括 0/total。

## 套索选择

左栏始终占据固定宽度，上下区域按 1:3 分配可用高度。选取和清空只更新内容，不改变左栏宽度或可见性，避免与 zoom-to-fit 同时触发地图容器尺寸动画。较矮窗口的摘要区域独立滚动。

绘制草稿使用 viewBox 坐标，绘制期间暂停 zoom。完成时一次转换到数据坐标，筛选所有数据点，而非仅筛选网格代表点。选区轮廓随视图重新投影。

少于三个坐标点的手势视为误触。取消或失去指针捕获会结束草稿并恢复原轮廓；关闭工具或外部清空选择会清除轮廓。有效选区保留原有 fit 动画，fit 的缩放值受交互最小 zoom 约束。

## 加载与缓存

路由模块加载时并行预加载投影数据与 Atlas。各自缓存结果和进行中的 Promise，避免组件挂载造成重复网络请求。

Atlas bitmap 是应用级共享资源，主图和虚拟列表缩略图订阅同一状态。任一调用方重试成功，所有消费者同步恢复。失败时主图用散点保留分布，并提供重试按钮。组件卸载不关闭共享 bitmap。

`requestWithRetry` 统一处理临时 HTTP 错误、网络错误、单次请求与响应体读取超时及指数退避；数据解析与缓存仍由各模块负责。metadata 在首次选择后按需加载。

场景探测为同一 scene 合并进行中的请求，仅缓存 available 和明确的 404 missing；非 JSON 响应作为临时错误。当前部署仅提供 val 详情，train 不发探测请求。探测读取 message_index 后，SceneLoader 仍独立加载该索引；应用层不共享响应体。

场景预览仅接受最后一次点击的探测结果；关闭和卸载会使旧结果失效。

## 验证

```sh
pnpm exec vitest run src/features/projection-map
pnpm typecheck
pnpm exec eslint src/features/projection-map
pnpm check
```

浏览器重点检查 zoom 1/4/8/16、放大后边缘命中、平移中的裁剪、两组 scatter 切换、套索完成/取消、绘制期间滚轮、Atlas 失败后恢复。交互与视觉检查由用户手动完成；自动化测试覆盖坐标、采样、请求、缓存与资源生命周期。
