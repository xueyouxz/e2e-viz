# Projection Map 性能优化

## 背景

投影视图（`src/features/projection-map/`）在缩放、平移、数据切换时存在明显卡顿。通过逐层分析网络、数据处理、渲染三个维度，识别出若干瓶颈并依优先级逐一修复。

---

## 优化点

### 1. 消除 zoom 每帧 React 重渲染（P0）

**问题**：D3 zoom 事件每秒触发 ~60 次。每次都调用 `setViewport` → React 重新渲染整个组件树（850+ 个 `<circle>` reconcile + 多个 `useMemo` 重算）。

**根因**：glyph 位置更新依赖 React state，但 glyph 所在的 DOM 完全由 D3 管理，React 层的更新是多余的。

**Before**：

```ts
// zoom 事件 —— 每帧调用
.on('zoom', (event) => {
  const t = event.transform
  transformRef.current = t
  scatterGroupRef.current?.setAttribute('transform', formatTransform(t))

  // 每帧触发 React 重渲染
  if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current)
  zoomRafRef.current = requestAnimationFrame(() => {
    setViewport(computeViewport(transformRef.current))  // ← 60fps re-render
  })
})

// React render 后，useEffect 再做 glyph 位置更新
useEffect(() => {
  d3.select(glyphGroupRef.current)
    .selectAll('g.glyph')
    .attr('transform', toTranslate)  // ← 一帧延迟，且依赖 React state
}, [culledGlyphPoints, snappedK, scales, viewport])
```

**After**：

```ts
.on('zoom', (event) => {
  const prevT = transformRef.current
  const t = event.transform
  transformRef.current = t

  // 1. scatter group 变换（不变）
  scatterGroupRef.current?.setAttribute('transform', formatTransform(t))

  // 2. glyph 位置直接在 zoom handler 里更新 —— 零延迟，不触发 React
  d3.select(glyphGroupRef.current)
    .selectAll<SVGGElement, ProjectionMapPoint>('g.glyph')
    .attr('transform', d => {
      const x = sc.x(d.tsne_comp1) * t.k + t.x - half
      const y = sc.y(d.tsne_comp2) * t.k + t.y - half
      return `translate(${x},${y})`
    })

  // 3. 仅在 LOD 或 snap 级别变化时更新 React state
  const needsUpdate =
    (t.k >= LOD_GLYPH_MIN_K) !== (prevT.k >= LOD_GLYPH_MIN_K) ||
    snapGridK(t.k) !== snapGridK(prevT.k)

  if (needsUpdate) {
    zoomRafRef.current = requestAnimationFrame(() =>
      setViewport(computeViewport(transformRef.current))
    )
  }
})
// zoom 结束时做一次最终同步（修正边缘 culling）
.on('end', () => {
  setViewport(computeViewport(transformRef.current))
})
```

**效果**：zoom 过程中 React 重渲染从 ~60次/s 降至仅在 LOD 切换或 zoom 结束时触发（通常 < 5次/次完整手势）。

---

### 2. 移除 scatter dots viewport culling（P0 附）

**问题**：`culledScatterPoints` 每帧过滤 850 个点，依赖 `viewport` state，随 P0 的 setViewport 被触发。

**关键洞察**：scatter dots 在 `scatterGroupRef`（D3 transform group）内部，浏览器按 viewBox 自动裁剪，JS 层 culling 没有必要。

```ts
// Before — 依赖 viewport，每帧过滤
const culledScatterPoints = useMemo(() => {
  const { x0, x1, y0, y1 } = viewport
  return base.filter(p => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1)
}, [glyphsActive, visibleGlyphPoints, scales, viewport])

// After — 去掉 viewport 依赖
const culledScatterPoints = useMemo(
  () => (glyphsActive ? [] : visibleGlyphPoints),
  [glyphsActive, visibleGlyphPoints]
)
```

---

### 3. 修复 D3 transition 与直接 attr() 的写冲突（视觉残影）

**问题**：snap 级别变化时 glyph join effect 启动 280ms transition，同时 zoom handler 每帧直接写同一 `transform` 属性，两者交替覆盖导致位置抖动（视觉残影）。

```ts
// Before —— transition 和 attr() 争抢同一属性
if (isSnapChange) {
  joined.transition('reposition').duration(280).attr('transform', toTranslate)
} else {
  joined.attr('transform', toTranslate)
}

// After —— interrupt 终止所有 transition，保持 zoom handler 独占控制权
joined.interrupt().attr('transform', toTranslate)
```

---

### 4. 消除 850 个 `<title>` DOM 节点（P2）

```tsx
// Before —— 850 circle × 1 title = 1700 DOM 节点
{points.map(p => (
  <circle ...>
    <title>{p.scene_name}</title>
  </circle>
))}

// After —— 850 DOM 节点
{points.map(p => <circle key={p.scene_name} ... />)}
```

---

### 5. CSS hover 替代 JS 宽高变化（P2）

**问题**：`mouseenter` 修改 SVG `<image>` 的 `width`/`height` 属性触发 SVG layout reflow。

```ts
// Before —— 触发 layout
.on('mouseenter', function () {
  d3.select(this).raise()
    .select('image')
    .attr('width', MAP_GLYPH_SIZE * 1.18)
    .attr('height', MAP_GLYPH_SIZE * 1.18)
})

// After —— CSS transform 不触发 layout，JS 只保留 z-order
.on('mouseenter', function () { d3.select(this).raise() })
```

```css
/* CSS 处理 scale */
.glyphImage {
  transform-origin: 22px 22px;
  transition:
    filter 120ms ease,
    transform 120ms ease;
}
.glyphGroup:hover .glyphImage {
  transform: scale(1.18);
}
```

---

### 6. 模块级常量替代函数内 Map 构建（P2）

```ts
// Before —— 每次 useEffect 触发重建 Map（~850 次 set）
function buildSplitLookup() {
  const lookup = new Map<string, SplitName>()
  for (const split of ...) for (const scene of ...) lookup.set(scene, split)
  return lookup
}
// 在 load() 内调用

// After —— 模块加载时执行一次
const SPLIT_LOOKUP: ReadonlyMap<string, SplitName> = (() => {
  const m = new Map<string, SplitName>()
  for (const split of ...) for (const scene of ...) m.set(scene, split)
  return m
})()
```

---

### 7. 网络请求缓存（P1）

```ts
// Before —— 每次点击发一次 fetch
async function probeScene(name: string) {
  const res = await fetch(`/data/scenes/${name}/message_index.json`)
  ...
}

// After —— 命中缓存直接返回，无网络往返
const probeCache = new Map<string, boolean>()
async function probeScene(name: string) {
  const cached = probeCache.get(name)
  if (cached !== undefined) return cached
  // ... fetch, 结果写入 probeCache
}
```

---

### 8. startTransition 降低切换更新优先级（P2）

```tsx
// Before —— 阻塞式更新，KDE 重计算期间按钮卡顿
onClick={() => setShowVal(v => !v)}

// After —— 非紧急更新，按钮响应立即，KDE 在后台完成
onClick={() => startTransition(() => setShowVal(v => !v))}
```

---

## 方法论总结

### 一、分层定位瓶颈

按照 **网络 → 数据处理 → 渲染** 三层顺序排查，每层关注：

- 网络：请求数量、重复请求、未缓存
- 数据处理：计算在哪个线程、重建频率、数据结构选择
- 渲染：触发频率、DOM 节点数量、回流 vs 重绘

### 二、识别"驱动源" vs "被驱动者"

区分什么是动画的**驱动源**（D3 zoom 事件），什么是**被驱动者**（glyph 位置）。驱动源不应经过框架（React state → re-render → useEffect）这条路径来更新被驱动者——这引入了一帧延迟和不必要的 reconcile 开销。

**原则**：高频驱动的可视属性直接走命令式 DOM 更新；React state 只用于驱动 DOM 结构变化（增删节点）。

### 三、控制 React 重渲染的触发频率

```
setViewport 的触发条件由"每帧"收窄为"状态语义变化时"：
  - 每帧（60fps）→ LOD 切换 / snap 级别变化 / 手势结束
```

判断哪些 state 变化是"语义变化"（需要 React 介入）而非"连续变化"（应走命令式路径）。

### 四、避免多个写路径争抢同一 DOM 属性

D3 transition 和直接 `.attr()` 都能写 `transform`，共存时互相覆盖。原则：**一个 DOM 属性同一时刻只有一个控制者**。若 zoom handler 直接管理 glyph 位置，则关闭 join effect 里的 transition。

### 五、CSS vs JS 做动画

| 操作                        | 推荐方式                           | 原因                          |
| --------------------------- | ---------------------------------- | ----------------------------- |
| scale / opacity / translate | CSS transition                     | 走合成层，不触发 layout       |
| width / height / DOM 属性   | 避免在动画路径上                   | 触发 layout reflow            |
| 大量元素位置更新（60fps）   | JS 命令式（requestAnimationFrame） | 可控时机，避免 React overhead |

### 六、缓存不变的计算结果

静态数据（manifest lookup、probe 结果）在适当的生命周期内缓存，避免重复计算或网络往返：

- 模块级常量：跨组件实例共享，应用生命周期内不变
- 组件级 useMemo：组件实例内缓存，依赖变化时重算
- 模块级 Map 缓存：跨调用共享，适合网络请求去重
