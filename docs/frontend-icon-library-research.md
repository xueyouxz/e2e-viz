# React 图标库候选研究

日期：2026-09-05

## 研究范围

比较以下 React 图标库：

- `lucide-react`
- `@radix-ui/react-icons`
- `@heroicons/react`
- `@tabler/icons-react`
- `@phosphor-icons/react`（旧包名为 `phosphor-react`）

只使用各项目的官方文档、官方仓库源码和 npm 官方包元数据。数量按 2026-09-05
固定的官方仓库提交统计；发布状态来自 npm `dist-tags` 和发布时间。本文只提供候选库的客观比较，
不代替结合当前项目图标清单和界面风格后的最终选型。

## 结论摘要

| 库                      | 当前覆盖                                                                 | 基础视觉                                                        | React / TypeScript                              | 按需加载                                                                                  | 主要样式控制                                                                   | 许可 |
| ----------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---- |
| `lucide-react`          | 1,813 个 SVG 图标                                                        | 24×24、2px、圆端点的统一线框；官方不支持完整填充风格            | 官方 React 包、内置类型，React 16.5–19          | ESM、`sideEffects: false`；静态命名导入可 tree-shake                                      | `size`、`color`、`strokeWidth`、`nonScalingStroke`，以及 SVG props             | ISC  |
| `@radix-ui/react-icons` | 332 个图标                                                               | 为 15×15 小尺寸 UI 绘制，轮廓常以填充 path 塑形，紧凑清晰       | 官方 React 包、TS 源码和声明，React 16–19       | ESM、`sideEffects: false`，并提供逐图标子路径导出                                         | `color` 和通用 SVG props；可覆盖 `width`/`height`，没有统一 stroke 权重 API    | MIT  |
| `@heroicons/react`      | 324 个主要图标概念；24 outline/solid 与 20 solid 各 324，16 solid 为 316 | 24px 线框默认 1.5 stroke，另有 24/20/16 实心变体                | 官方 React 包、生成的 SVG props 类型，React 16+ | 按尺寸/风格子路径导入，逐图标 ESM 导出且 `sideEffects: false`                             | 通过 `className` 或标准 SVG props 控制尺寸、颜色；outline/solid 是独立组件集合 | MIT  |
| `@tabler/icons-react`   | 6,184 个资产：5,130 outline + 1,054 filled                               | 24×24、2px、圆端点线框为主，并提供部分 filled                   | 官方 React 包、内置声明，React 16+              | 官方声明 ESM 可 tree-shake，`sideEffects: false`                                          | `size`、`color`、`stroke`；filled 使用 `color` 控制 fill                       | MIT  |
| `@phosphor-icons/react` | 1,512 个图标概念 × 6 weights = 9,072 个 SVG 变体                         | 同一图标提供 thin/light/regular/bold/fill/duotone，视觉选择最多 | 官方 React 包、TS 和声明，React 16.8+           | 支持 tree-shaking；官方提示 barrel import 可能拖慢部分 bundler 的开发编译，提供逐图标路径 | `size`、`color`、`weight`、`mirrored`，可用 Context 设全局默认                 | MIT  |

数量依据：Lucide 的固定提交 [`icons/`](https://github.com/lucide-icons/lucide/tree/94e4cb9d9db5907053ebf3636a97c45529cf776b/icons)
中有 1,813 个 SVG；Radix 的固定提交
[`manifest.json`](https://github.com/radix-ui/icons/blob/112af91ad275a63c3a29b0da2588342af74ef9bf/packages/radix-icons/manifest.json)
列出 332 个 15px 图标；Heroicons 固定提交的
[`src/`](https://github.com/tailwindlabs/heroicons/tree/616b7a4dbbf3d011760af8066262cd5c6b3868f3/src)
分别包含 324 个 24px outline、324 个 24px solid、324 个 20px solid 和 316 个 16px solid；
Tabler 官方站给出 [6,184 总数和 5,130 outline](https://tabler.io/icons)，其固定提交资产目录对应
1,054 个 filled；Phosphor 固定提交的
[`assets/`](https://github.com/phosphor-icons/core/tree/2b75f3ad12b420c9504ef05df8d2564a28f8500e/assets)
在每种 weight 下各有 1,512 个 SVG。

## 1. Lucide React

Lucide 是 Feather 的延续，强调一致、简洁的线框语言。当前官方 README 称其为 1,600+ 图标库；
固定提交的实际 `icons/*.svg` 数量为 1,813。图标以 24×24、默认 2px stroke、圆形
line cap/join 为基线。React 文档明确说明所有图标使用 stroke；filled icons
“officially not supported”，即使个别图标可通过 SVG `fill` 属性获得可接受结果，也不能把它视为
完整的 outline/filled 双套图标系统。

React 包是 ESM，静态导入只保留使用到的图标；包清单同时声明 `sideEffects: false`、TypeScript
声明和 React 16.5–19 peer range。标准参数为 `size`、`color`、`strokeWidth`、
`nonScalingStroke`，并透传 SVG 属性。默认颜色为 `currentColor`。

来源：

- [官方 README：覆盖、定位与 ISC 许可](https://github.com/lucide-icons/lucide/blob/94e4cb9d9db5907053ebf3636a97c45529cf776b/README.md)
- [React 入门：ESM/tree-shaking、props 与默认值](https://github.com/lucide-icons/lucide/blob/94e4cb9d9db5907053ebf3636a97c45529cf776b/docs/guide/react/getting-started.md)
- [React stroke 规则](https://github.com/lucide-icons/lucide/blob/94e4cb9d9db5907053ebf3636a97c45529cf776b/docs/guide/react/basics/stroke-width.md)
- [filled icons 的官方限制](https://github.com/lucide-icons/lucide/blob/94e4cb9d9db5907053ebf3636a97c45529cf776b/docs/guide/react/advanced/filled-icons.md)
- [`lucide-react` 包清单：types、peer React、`sideEffects`](https://github.com/lucide-icons/lucide/blob/94e4cb9d9db5907053ebf3636a97c45529cf776b/packages/lucide-react/package.json)

## 2. Radix Icons

Radix Icons 是 WorkOS 团队为 15×15 网格绘制的紧凑图标，适合菜单、树、工具条等低尺寸 UI。
当前 manifest 有 332 个图标，覆盖明显少于其他四个候选。源码中的典型图标使用
`fill={color}` 形成清晰的小尺寸轮廓，而不是依赖一个可统一调节的 stroke；因此它不提供类似
Lucide/Tabler 的全库 stroke 权重参数。

每个图标都是单独 React 组件。组件 props 继承 React `SVGAttributes`，`color` 默认
`currentColor`，传入的 SVG props 位于默认 `width="15"`、`height="15"` 之后，因此可以覆盖
尺寸。包以 TypeScript 编写，发布 ESM/CJS 和声明文件，支持 React 16–19；包清单声明
`sideEffects: false`，并同时提供 barrel 和 `./*` 逐图标子路径导出。

来源：

- [官方页面：15×15 定位、React 用法与 MIT 许可](https://www.radix-ui.com/icons)
- [包清单：ESM/CJS、逐图标导出、types、peer React](https://github.com/radix-ui/icons/blob/112af91ad275a63c3a29b0da2588342af74ef9bf/packages/radix-icons/package.json)
- [组件 props 类型](https://github.com/radix-ui/icons/blob/112af91ad275a63c3a29b0da2588342af74ef9bf/packages/radix-icons/src/types.tsx)
- [`EyeOpenIcon` 源码：15px、`currentColor` 和 props 覆盖顺序示例](https://github.com/radix-ui/icons/blob/112af91ad275a63c3a29b0da2588342af74ef9bf/packages/radix-icons/src/EyeOpenIcon.tsx)

## 3. Heroicons React

Heroicons 将同一套界面图标分为 24px outline、24px solid、20px solid 和 16px solid。
24px outline 默认使用 `strokeWidth=1.5`、`stroke=currentColor`；solid 使用
`fill=currentColor`。它的优势是线框/实心和多目标尺寸是设计好的独立资产，不需要把线框图标
强行填充；代价是 324 个主要概念的覆盖小于 Lucide、Tabler 和 Phosphor。

官方 React 用法要求从尺寸/风格子路径导入，例如
`@heroicons/react/24/solid`。构建脚本为每个图标生成独立 ESM 文件和
`React.SVGProps<SVGSVGElement>` 声明；包清单提供逐图标 exports，并声明
`sideEffects: false`。图标没有独立 `size` API，通常用 `className` 或 SVG
`width`/`height`/`strokeWidth`/`fill` 属性覆盖默认值。

官方 README 还明确表示不再接受新增图标，只接受错误、类型和导出修复；因此它是稳定、收敛的
图标集合，而不是持续扩张覆盖的集合。

来源：

- [React README：尺寸/风格入口、使用方式、维护范围与 MIT 许可](https://github.com/tailwindlabs/heroicons/blob/616b7a4dbbf3d011760af8066262cd5c6b3868f3/react/README.md)
- [24px outline `Eye`：1.5 stroke 示例](https://github.com/tailwindlabs/heroicons/blob/616b7a4dbbf3d011760af8066262cd5c6b3868f3/src/24/outline/eye.svg)
- [24px solid `Eye`：fill 示例](https://github.com/tailwindlabs/heroicons/blob/616b7a4dbbf3d011760af8066262cd5c6b3868f3/src/24/solid/eye.svg)
- [构建脚本：逐图标 ESM 与 TypeScript SVG props](https://github.com/tailwindlabs/heroicons/blob/616b7a4dbbf3d011760af8066262cd5c6b3868f3/scripts/build.js)
- [React 包清单：exports、`sideEffects`、peer React](https://github.com/tailwindlabs/heroicons/blob/616b7a4dbbf3d011760af8066262cd5c6b3868f3/react/package.json)

## 4. Tabler Icons React

Tabler 当前官方站列出 6,184 个资产，其中 5,130 个 outline、1,054 个 filled，是五个候选中
目录覆盖最大的一项。基础线框设计是 24×24、默认 2px stroke、圆形 cap/join；filled
只覆盖其中一部分图标，不能假设任意 outline 都有同名 filled 版本。

React 包的每个图标是组件，官方文档声明 ESM 可 tree-shake；包清单声明
`sideEffects: false` 和 TypeScript 类型，React peer range 为 16+。outline 组件默认
`size=24`、`color=currentColor`、`stroke=2`；filled 组件将 `color` 用作 fill。
当前 React 包没有官方的全局默认值 Provider，需要调用方包装组件或逐次传参来统一非默认 stroke。

来源：

- [官方站：总量、outline 数量、24×24/2px 设计与可调项](https://tabler.io/icons)
- [React README：ESM/tree-shaking、props、types 与 MIT 许可](https://github.com/tabler/tabler-icons/blob/55f87a73f45cf1d9eaf16d7da705065483a9e4f9/packages/icons-react/README.md)
- [React 组件工厂：outline/filled 的 size、color、stroke 实现](https://github.com/tabler/tabler-icons/blob/55f87a73f45cf1d9eaf16d7da705065483a9e4f9/packages/icons-react/src/createReactComponent.ts)
- [React 包清单：ESM、types、`sideEffects`、peer React](https://github.com/tabler/tabler-icons/blob/55f87a73f45cf1d9eaf16d7da705065483a9e4f9/packages/icons-react/package.json)

## 5. Phosphor Icons React

当前官方包名是 `@phosphor-icons/react`。官方已用它替代 `phosphor-react`；旧包只维护，不再同步
上游新增图标。新包包含 1,512 个图标概念，每个概念都有 thin、light、regular、bold、fill、
duotone 六种变体。它不是通过任意 strokeWidth 改出所有效果，而是通过设计好的 `weight`
资产切换；其中 fill 和 duotone 是正式支持的风格。

React 组件支持全部 SVG props，核心参数为 `color`、`size`、`weight`、`mirrored`；
`IconContext.Provider` 可集中设默认样式。包以 TypeScript 构建并发布声明，React peer range 为
16.8+，清单声明 `sideEffects: false`。官方说明普通命名导入支持 tree-shaking，但也警告部分
bundler 在开发期可能预编译 barrel 暴露的 9,000+ 模块；可改用
`@phosphor-icons/react/dist/csr/<Icon>` 逐图标路径降低这类开发编译成本。

来源：

- [React README：新旧包关系、tree-shaking、逐图标导入、props、Context](https://github.com/phosphor-icons/react/blob/81ac06f9bf4b4dedf9b8fead0a1ebd47c41d67ef/README.md)
- [React 包清单：ESM/CJS、types、exports、`sideEffects`、peer React](https://github.com/phosphor-icons/react/blob/81ac06f9bf4b4dedf9b8fead0a1ebd47c41d67ef/package.json)
- [Core README：六种 weight 的官方资产目录与 MIT 许可](https://github.com/phosphor-icons/core/blob/2b75f3ad12b420c9504ef05df8d2564a28f8500e/README.md)

## 6. 发布与维护快照

| 包                      | npm `latest` | `latest` 发布时间（UTC） | 固定分支最新提交 | 维护信号                                                        |
| ----------------------- | ------------ | ------------------------ | ---------------- | --------------------------------------------------------------- |
| `lucide-react`          | 1.41.0       | 2026-09-04               | 2026-09-04       | 稳定包和主分支都在近期更新                                      |
| `@radix-ui/react-icons` | 1.3.2        | 2024-11-14               | 2025-12-17       | 稳定版更新慢；npm 另有 2026-04-14 发布的 2.0 RC                 |
| `@heroicons/react`      | 2.2.0        | 2024-11-18               | 2026-05-12       | 稳定版更新慢；有对应 2026-05-12 insiders 包，但官方不扩充新图标 |
| `@tabler/icons-react`   | 3.46.0       | 2026-07-28               | 2026-09-03       | 稳定包和主分支持续更新                                          |
| `@phosphor-icons/react` | 2.1.10       | 2025-05-22               | 2026-01-06       | 有后续仓库维护，但稳定发布频率低于 Lucide/Tabler                |

npm 数据来源：

- [`lucide-react` registry metadata](https://registry.npmjs.org/lucide-react)
- [`@radix-ui/react-icons` registry metadata](https://registry.npmjs.org/%40radix-ui%2Freact-icons)
- [`@heroicons/react` registry metadata](https://registry.npmjs.org/%40heroicons%2Freact)
- [`@tabler/icons-react` registry metadata](https://registry.npmjs.org/%40tabler%2Ficons-react)
- [`@phosphor-icons/react` registry metadata](https://registry.npmjs.org/%40phosphor-icons%2Freact)

固定分支提交：

- [Lucide `94e4cb9`](https://github.com/lucide-icons/lucide/commit/94e4cb9d9db5907053ebf3636a97c45529cf776b)
- [Radix Icons `112af91`](https://github.com/radix-ui/icons/commit/112af91ad275a63c3a29b0da2588342af74ef9bf)
- [Heroicons `616b7a4`](https://github.com/tailwindlabs/heroicons/commit/616b7a4dbbf3d011760af8066262cd5c6b3868f3)
- [Tabler Icons `55f87a7`](https://github.com/tabler/tabler-icons/commit/55f87a73f45cf1d9eaf16d7da705065483a9e4f9)
- [Phosphor React `81ac06f`](https://github.com/phosphor-icons/react/commit/81ac06f9bf4b4dedf9b8fead0a1ebd47c41d67ef)
- [Phosphor Core `2b75f3a`](https://github.com/phosphor-icons/core/commit/2b75f3ad12b420c9504ef05df8d2564a28f8500e)

## 7. 用于项目选型时需要继续核对的差异

- 如果现有界面主要是 16–20px 的细线工具图标，Lucide 和 Tabler 的视觉基线最接近；二者的
  核心差别是 Lucide 更收敛、已有项目依赖，Tabler 覆盖更大且有部分正式 filled 变体。
- 如果大量图标需要用“线框/实心”表达开关、选中或层级，Heroicons 和 Phosphor 提供正式设计的
  变体；Lucide 不应依靠通用 `fill` 代替完整 filled 集合。
- 如果工具条固定使用 15px 并强调像素级清晰度，Radix 的尺寸目标最直接，但 332 个图标可能
  无法覆盖 3D、相机、轨迹、图表等领域语义，必须先做逐图标映射。
- 如果需要同一语义在多种视觉权重、fill 和 duotone 间切换，Phosphor 能力最完整；同时应在
  当前 Vite 构建中实测其 barrel import 的开发启动和构建影响。
- 无论选择哪一项，都应把“UI 操作图标”和业务数据图形分开：类别 glyph、地图标记、选中对象
  图形等若携带数据协议或业务语义，不应仅因形状相似就替换为通用 UI 图标。
