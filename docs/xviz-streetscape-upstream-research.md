# XVIZ 与 streetscape.gl 上游架构研究

日期：2026-08-28

研究范围：

- [`aurora-opensource/xviz`](https://github.com/aurora-opensource/xviz)，固定到
  [`b326535f28e0a08d70b4c4252ec2cccedc237381`](https://github.com/aurora-opensource/xviz/commit/b326535f28e0a08d70b4c4252ec2cccedc237381)。
  该提交位于 `v1.0.13` 之后，只更新了 Protobuf 生成物；协议、Parser 和 IO 源码仍对应
  `1.0.13`。
- [`aurora-opensource/streetscape.gl`](https://github.com/aurora-opensource/streetscape.gl)，固定到
  [`befae1354ca8605c9f6cb1229b494858a8690e4f`](https://github.com/aurora-opensource/streetscape.gl/commit/befae1354ca8605c9f6cb1229b494858a8690e4f)，
  即 `v1.0.13`。

只使用两个上游仓库的源码、规范、示例、提交记录和包清单。本文不分析当前
`scene-viewer` 源码；“对 e2e-viz 的建议”需要与当前实现分析合并后再形成最终改造计划。
应用建议按从零重做处理：只保留一个严格 schema，不设计版本协商、旧字段兼容、stream alias
或 Adapter 层。

## 1. 结论

XVIZ/streetscape.gl 实现解耦的主要手段不是别名，也不是统一 stream 名称，而是以下四层约束：

1. `metadata.streams` 是运行时目录。stream ID 是 map key，类型、坐标系、样式和单位是
   descriptor；前端先读 descriptor，再处理 data message。
2. `state_update` 只通过 stream ID 关联数据；Parser 遍历消息中实际出现的 key，
   Buffer 和 Synchronizer 也以任意 stream ID 建索引，不维护业务名称清单。
3. 3D Viewer 遍历当前 frame 的所有 stream，并根据 primitive 数据的 `type` 选择
   renderer。添加一个已有类型的新 stream，不需要增加前端 Layer。
4. 需要业务语义的 UI 仍会绑定 stream ID。XVIZ 用 metadata 中的 declarative UI
   将这部分绑定从前端代码移到数据生产端，但它只是转移配置责任，不会消除语义耦合。

因此，对 e2e-viz 最有价值的方向是：让 stream 名称退化成不透明标识，把“如何解析和渲染”
放进类型 descriptor，把“这个 stream 在业务上是什么”放进独立、稳定的 role/capability；
普通 3D stream 按类型自动渲染，只有确实需要语义的功能按 role 查询。

需要特别澄清：XVIZ 规范定义了 `stream_aliases`，但开源实现没有形成端到端的别名解析。
它不能作为“上游已经验证的完整方案”直接照搬。

## 2. XVIZ 数据格式

### 2.1 World state 与 stream

XVIZ 把世界状态拆成一组 stream。每个 stream 在时间上原子更新；某个时刻的 world state
是所有 stream 最近状态的集合。一个对象的几何、速度等信息可以分布在不同 stream，使用
`object_id` 维持关联，从而允许不同频率更新和更好的压缩。规范明确把 stream 视为语义容器，
而 primitive、variable、time series 是基础数据类型。参见
[`introduction.md` 5-38 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/protocol-schema/introduction.md#L5-L38)。

这带来两个不同层次：

- stream ID 负责在 metadata、消息和客户端状态之间建立引用关系；
- stream descriptor 负责声明客户端需要如何理解数据。

层次化名称如 `/object/shape` 便于浏览，但 XVIZ 核心处理链并不需要知道这个名字代表什么。
上游对这一目标的直接描述是：一个消息可以包含多个 stream；客户端可以组合同类数据并显示，
而不必知道实际 stream 名称。参见
[`structure-of-xviz.md` 22-29 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/developers-guide/structure-of-xviz.md#L22-L29)。

### 2.2 Metadata message

会话建立后，服务端先发送 metadata。核心结构是：

```json
{
  "version": "2.0.0",
  "streams": {
    "/objects/bounds": {
      "category": "PRIMITIVE",
      "primitive_type": "POLYGON",
      "coordinate": "VEHICLE_RELATIVE",
      "stream_style": {}
    }
  },
  "stream_aliases": {},
  "cameras": {},
  "ui_config": {},
  "log_info": {
    "start_time": 0,
    "end_time": 1
  }
}
```

metadata 的 `streams` 是 `map<stream_id, stream_metadata>`。同一个消息还可以声明 camera、
UI panel、日志时间范围和别名。参见
[`session-protocol.md` 122-156 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/protocol-schema/session-protocol.md#L122-L156)
和
[`metadata.schema.json` 6-47 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/schema/schema/session/metadata.schema.json#L6-L47)。

`stream_metadata` 的主要字段如下：

| 字段                               | 作用                                                    | 对解耦的影响                     |
| ---------------------------------- | ------------------------------------------------------- | -------------------------------- |
| `category`                         | `PRIMITIVE`、`POSE`、`TIME_SERIES`、`VARIABLE` 等       | 决定解析路径，不依赖 stream 名称 |
| `primitive_type`                   | `POINT`、`POLYLINE`、`POLYGON`、`IMAGE` 等              | 决定几何 renderer                |
| `scalar_type`                      | `FLOAT`、`INT32`、`STRING`、`BOOL`                      | 决定标量解释                     |
| `coordinate`                       | `IDENTITY`、`GEOGRAPHIC`、`VEHICLE_RELATIVE`、`DYNAMIC` | 决定坐标转换                     |
| `transform` / `transform_callback` | 静态或动态变换                                          | 将坐标策略从 Layer 移出          |
| `stream_style` / `style_classes`   | stream 默认样式和按 class 样式                          | 样式可随数据发布                 |
| `source`、`units`                  | 数据来源和量纲                                          | 支持 UI 展示和诊断               |

Schema 会根据 `category` 要求对应的 type 字段，并约束动态坐标必须有 callback。参见
[`stream_metadata.schema.json` 20-69 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/schema/schema/session/stream_metadata.schema.json#L20-L69)
和
[`stream_metadata.schema.json` 71-153 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/schema/schema/session/stream_metadata.schema.json#L71-L153)。

MetadataBuilder 也是以任意 stream ID 为入口，逐项写入 category、type、coordinate、style，
最后以 `this.data.streams[this.streamId]` 生成目录。参见
[`xviz-metadata-builder.js` 92-147 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/builder/src/builders/xviz-metadata-builder.js#L92-L147)
和
[`xviz-metadata-builder.js` 174-202 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/builder/src/builders/xviz-metadata-builder.js#L174-L202)。

### 2.3 Data message

V2 的数据消息是 `state_update`：

```json
{
  "update_type": "INCREMENTAL",
  "updates": [
    {
      "timestamp": 1001.3,
      "poses": {},
      "primitives": {
        "/objects/bounds": {
          "polygons": []
        }
      },
      "future_instances": {},
      "variables": {},
      "time_series": [],
      "ui_primitives": {},
      "annotations": {},
      "no_data_streams": [],
      "links": {}
    }
  ]
}
```

`stream_set` 以 timestamp 为时间边界，并按 category 分成多个 stream map。除 `time_series`
外，map 的 key 都是任意 stream ID；Schema 使用 `additionalProperties` 接受新 ID。参见
[`stream_set.schema.json` 7-71 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/schema/schema/core/stream_set.schema.json#L7-L71)。

Parser 不枚举业务名称。它遍历 `poses`、`primitives`、`variables`、`future_instances`、
`ui_primitives` 的实际 key，将结果统一归入 `{poses, streams, links}`；`no_data_streams`
被写为显式 `null`。参见
[`parse-timeslice-data-v2.js` 97-192 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/parsers/parse-timeslice-data-v2.js#L97-L192)。

Primitive Parser 根据消息中的 primitive 字段识别类型，并把每个 primitive 归一化。
启用 `DYNAMIC_STREAM_METADATA` 后，它还能从消息反推 `category` 和 `primitive_type`，作为
缺失 metadata 的兜底。参见
[`parse-xviz-stream.js` 91-189 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/parsers/parse-xviz-stream.js#L91-L189)。

`DYNAMIC_STREAM_METADATA` 也覆盖 pose、variable 和 time series；time series 会把消息中
平行的 `streams[]` 与 `values[]` 重新建立按 stream ID 的索引。参见
[`parse-xviz-stream.js` 293-308 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/parsers/parse-xviz-stream.js#L293-L308)
和
[`parse-xviz-stream.js` 404-472 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/parsers/parse-xviz-stream.js#L404-L472)。

动态反推只适合作为容错：它能得到几何/标量类型，却无法恢复 coordinate、transform、style、
单位、camera calibration 或业务语义。

### 2.4 完整状态、增量状态与删除

协议区分 `COMPLETE_STATE` 与 `INCREMENTAL`：

- complete 中未出现的既有 stream 在该 timestamp 视为空；
- incremental 中未出现的 stream 保持不变；
- 两种模式都允许同 timestamp 替换已有值；
- `no_data_streams`/空 marker 明确删除一个 stream 的当前值。

规范给出了 create、update、replace、delete 的完整状态表，参见
[`session-protocol.md` 166-220 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/protocol-schema/session-protocol.md#L166-L220)。

`XVIZStreamBuffer` 为首次出现的任意 stream 动态建立稀疏时间数组；同 timestamp 的 complete
执行替换，incremental 执行合并。参见
[`xviz-stream-buffer.js` 205-265 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/synchronizers/xviz-stream-buffer.js#L205-L265)
和
[`xviz-stream-buffer.js` 381-412 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/synchronizers/xviz-stream-buffer.js#L381-L412)。

实现还接受 `PERSISTENT`，将这类 timeslice 保存在不随普通时间窗口裁剪的区域；`SNAPSHOT`
只作为已废弃输入兼容，并被归一成 incremental。参见
[`constants.js` 26-33 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/constants.js#L26-L33)
和
[`xviz-stream-buffer.js` 225-229 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/synchronizers/xviz-stream-buffer.js#L225-L229)。
这说明正式规范、兼容输入和内部 update model 必须分开命名，不能让旧 wire enum 直接渗入
Repository。

这个设计解决的是“不同 stream 不同频率更新”问题，不只是文件分页问题。缺少明确更新语义时，
前端只能猜测“未出现”代表保持、删除还是生产端遗漏。

### 2.5 JSON、GLB 与内存形态

XVIZ 的 JSON 格式是 Schema 的直接映射，并可放进 `{type: "xviz/...", data: ...}` envelope。
参见
[`json-protocol.md` 18-41 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/protocol-formats/json-protocol.md#L18-L41)。

Binary 格式使用 GLB：JSON chunk 保存语义结构，BIN chunk 保存大型 TypedArray 和图片；
JSON 内使用 `#/accessors/n`、`#/images/n` 指针引用二进制资产。解析后，业务结构仍接近 JSON，
只是大数组变成扁平 TypedArray。参见
[`binary-protocol.md` 1-45 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/protocol-formats/binary-protocol.md#L1-L45)
和
[`binary-protocol.md` 131-155 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/protocol-formats/binary-protocol.md#L131-L155)。

IO 层先识别 JSON object/string/buffer、GLB 或 Protobuf，再统一产出 `XVIZMessage`；
Parser 不直接负责传输格式探测。参见
[`xviz-data.js` 28-60 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/io/src/common/xviz-data.js#L28-L60)
和
[`xviz-data.js` 93-145 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/io/src/common/xviz-data.js#L93-L145)。

这一点适合保留：wire container、协议对象和前端领域对象是三个边界，不应让 Layer 直接处理
GLB pointer、bufferView 或 Blob。

## 3. Stream name 在哪里动态消费，在哪里仍被硬编码

### 3.1 动态消费路径

| 位置                   | 行为                                              | 是否依赖业务名称         |
| ---------------------- | ------------------------------------------------- | ------------------------ |
| XVIZ MetadataBuilder   | 任意 key 写入 `streams`                           | 否                       |
| V2 timeslice Parser    | 遍历消息中出现的 stream key                       | 否                       |
| XVIZStreamBuffer       | 首次出现时建立 stream 索引                        | 否                       |
| LogSlice/Synchronizer  | 在时间窗口内按 key 选择最近值                     | 否                       |
| Loader stream settings | metadata 每个 key 默认启用，动态新增 key 也可启用 | 否                       |
| Core3DViewer           | 遍历 frame 的 `Object.keys(streams)`              | 否                       |
| XVIZLayer              | 根据 primitive `type` 选择 renderer               | 否                       |
| StreamSettingsPanel    | 根据 metadata 自动生成开关                        | 只把路径首段用于展示分组 |
| XVIZVideo              | 从 metadata 中筛选 `primitive_type === IMAGE`     | 否                       |

`LogSlice` 从反向时间序列中为每个 stream 选择第一个可用值，并保留显式 `null` 的删除语义。
参见
[`log-slice.js` 155-201 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/synchronizers/log-slice.js#L155-L201)。

streetscape.gl 的 Viewer 直接遍历 `frame.streams` 和 `lookAheads`，为每个实际存在的 stream
解析坐标、样式并构建 `XVIZLayer`。参见
[`core-3d-viewer.js` 244-310 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/log-viewer/core-3d-viewer.js#L244-L310)。

`XVIZLayer` 不是按 stream ID 注册，而是将数据中的 `point`、`polyline`、`polygon`、`text`
等 primitive type 映射到 deck.gl layer handler。参见
[`xviz-layer.js` 33-60 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/layers/xviz-layer.js#L33-L60)
和
[`xviz-layer.js` 379-475 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/layers/xviz-layer.js#L379-L475)。

这是“新增/删除 stream 名称不改 Layer”的直接实现依据。

### 3.2 有意保留的显式绑定

以下位置仍使用确切 stream ID：

- Declarative UI 的 metric、plot、table、video 需要指定输入 stream。配置位于 metadata，
  streetscape.gl 根据 panel type 选择组件并传入配置，而不是在组件内部维护所有业务流名称。
  参见
  [`components.md` 69-113 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/declarative-ui/components.md#L69-L113)
  和
  [`xviz-panel.js` 32-94 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-panel.js#L32-L94)。
- 自定义 Layer 可以通过 `streamName` 精确绑定，也可以通过 `streamMatch(streamName,
streamMetadata)` 匹配 metadata。后者允许按 type 或扩展字段匹配。参见
  [`xviz-layer.js` 418-455 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/layers/xviz-layer.js#L418-L455)。
- 示例应用中的 HUD widget、样式覆盖和业务行为直接写 `/vehicle/velocity`、
  `/vehicle/turn_signal`、`/tracklets/objects` 等名称。这些属于应用配置，而不是通用 Loader、
  Synchronizer 或默认 renderer。

这说明通用 3D 渲染可以完全数据驱动，但“某个统计卡需要哪种指标”“哪条轨迹代表规划结果”
依然必须有稳定语义。把硬编码从 TSX 移到 JSON 只能减少发版，不会定义语义契约。

### 3.3 上游仍存在的固定名称

XVIZ Parser 默认把 `/vehicle_pose` 作为 `PRIMARY_POSE_STREAM`。Synchronizer 从该 key 获取
主车 pose；可以通过全局配置修改，也可以允许缺失，但 metadata 本身没有 `primary_pose`
role。参见
[`xviz-config.js` 18-45 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/config/xviz-config.js#L18-L45)
和
[`base-synchronizer.js` 74-99 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/synchronizers/base-synchronizer.js#L74-L99)。

这正是 e2e-viz 不应照搬的部分：全局可配置名称仍是名称耦合，而且同进程多 Viewer/多协议版本
时会产生共享状态。

### 3.4 `stream_aliases` 的真实状态

规范把 `stream_aliases` 定义为“旧名称到新名称”的 map，目标是后端重命名时客户端无需修改。
Schema 也接受这个字段，并提供 `/data/velocity -> /velocity` 的示例。参见
[`session-protocol.md` 127-134 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/protocol-schema/session-protocol.md#L127-L134)
和
[`complete.json` 29-49 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/schema/examples/session/metadata/complete.json#L29-L49)。

但开源实现没有完成闭环：

- MetadataBuilder 把 `stream_aliases` 留在 TODO 中；参见
  [`xviz-metadata-builder.js` 31-48 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/builder/src/builders/xviz-metadata-builder.js#L31-L48)。
- Metadata Parser 只过滤并原样复制 `streams`，通过对象展开保留 alias 字段，但不改写 stream
  key；参见
  [`parse-log-metadata.js` 76-113 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/parsers/parse-log-metadata.js#L76-L113)。
- XVIZ Parser 和 streetscape.gl 其余源码没有 alias resolver；Declarative UI、stream settings、
  filters 和自定义 Layer 仍直接使用实际 ID。

所以 `stream_aliases` 只是一项未完成的上游设想，不能证明 alias 能解决前端与数据源的语义
耦合。本轮 e2e-viz 方案不引入 alias：stream ID 只作为当前数据集内的 identity，跨名称变化的
稳定性由 role/capability 提供。

## 4. streetscape.gl 的模块分层

### 4.1 实际依赖流

```text
文件 / WebSocket
  -> XVIZFileLoader / XVIZWebsocketLoader
  -> @xviz/io: 识别 JSON / GLB / Protobuf，解 envelope
  -> @xviz/parser: metadata / timeslice 归一化
  -> XVIZStreamBuffer: 稀疏时间数据、增量合并、裁剪
  -> StreamSynchronizer -> LogSlice -> CurrentFrame
  -> XVIZLoaderInterface: observable log/store + selectors + playback API
  -> connectToLog: 将所需 selector 投影为 React props
  -> LogViewer / Core3DViewer
  -> XVIZLayer: primitive type registry
  -> deck.gl Layer / GPU resource
```

### 4.2 Loader 与传输

`LoaderInterface` 同时是数据加载器和一个轻量 observable store；`set` 合并同一 RAF 内的通知。
参见
[`loader-interface.js` 21-31 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/loader-interface.js#L21-L31)
和
[`loader-interface.js` 60-105 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/loader-interface.js#L60-L105)。

具体 Loader 只处理传输差异：

- `XVIZFileLoader` 先加载 timing，再加载 metadata，然后并发加载 frame 文件；所有文件都进入
  同一个 `parseStreamMessage`。参见
  [`xviz-file-loader.js` 29-55 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/xviz-file-loader.js#L29-L55)
  和
  [`xviz-file-loader.js` 105-134 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/xviz-file-loader.js#L105-L134)。
- `XVIZWebsocketLoader` 管理连接、重试和 Worker 解析，不负责 frame 语义；参见
  [`xviz-websocket-loader.js` 31-70 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/xviz-websocket-loader.js#L31-L70)
  和
  [`xviz-websocket-loader.js` 86-109 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/xviz-websocket-loader.js#L86-L109)。

传输层和 Parser 共用一个归一化输出，是值得采用的 Protocol Decoder 边界。

### 4.3 Log、Buffer 与 Synchronizer

`XVIZLoaderInterface` 接收解析后的 metadata/timeslice，持有 `XVIZStreamBuffer` 和
`StreamSynchronizer`，对 UI 暴露 metadata、stream metadata、stream settings、时间范围和
current frame selectors。参见
[`xviz-loader-interface.js` 70-89 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/xviz-loader-interface.js#L70-L89)
和
[`xviz-loader-interface.js` 118-180 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/xviz-loader-interface.js#L118-L180)。

metadata 到达时，Loader 用 `metadata.streams` 初始化可见性；新 timeslice 到达时写入 Buffer。
启用动态 metadata 后，新 stream 会自动生成 descriptor 并默认打开。参见
[`xviz-loader-interface.js` 183-225 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/xviz-loader-interface.js#L183-L225)。

Synchronizer 的职责是从异步 stream 更新构造一个可渲染快照。它在时间窗口内向后查找，
每个 stream 取最近有效数据，处理 pose、link、future 和显式 no-data，最终输出完整 frame。
这层让 React 和 Layer 不必理解增量消息。

### 4.4 React 连接层

`connectToLog` 只负责订阅 Loader，并通过 `getLogState` 把组件需要的 selector 结果投影为 props。
参见
[`connect.js` 26-73 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/connect.js#L26-L73)。

`LogViewer` 获取 `frame`、`metadata`、`streamsMetadata` 三个输入，再交给 `Core3DViewer`。
参见
[`log-viewer/index.js` 162-168 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/log-viewer/index.js#L162-L168)。

这个方向正确：渲染组件消费完整 frame 和 descriptor，不消费原始 message。但 streetscape.gl
的订阅粒度是整个 Loader version，容易让所有连接组件一起刷新；e2e-viz 应保留更窄 selector，
不复制这个 HOC/store 实现。

### 4.5 Render layers

`Core3DViewer` 负责：

- 遍历当前 frame 的 stream；
- 应用 stream filter；
- 从 metadata 解析坐标和 stylesheet；
- 创建一个通用 `XVIZLayer`；
- 合并自定义 Layer，并统一排序。

`XVIZLayer` 再负责把 primitive type 映射为 Scatterplot、PointCloud、Path、Polygon、Text 等
具体 deck.gl Layer，并把 XVIZ style 属性映射成 Layer props。

这形成两级 registry：

```text
stream ID -> 当前 payload + descriptor
payload primitive type -> renderer handler
```

业务 stream 数量可以增长，renderer 数量只随协议 type 增长。

坐标变换同样由 descriptor 驱动。`resolveCoordinateTransform` 处理 geographic、dynamic、
vehicle-relative 和 link/pose 图，Layer 只接收 `coordinateSystem`、`coordinateOrigin`、
`modelMatrix`。参见
[`transform.js` 86-149 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/utils/transform.js#L86-L149)。

### 4.6 数据驱动的辅助 UI

`StreamSettingsPanel` 遍历 metadata 自动生成开关，只用 stream 路径的第一个 segment 做展示分组。
参见
[`stream-settings-panel.js` 35-101 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/stream-settings-panel.js#L35-L101)。

`XVIZVideo` 遍历 metadata，筛出 image type 并自动生成选择器；当前选择被删除后自动回落到
第一个有效 stream。参见
[`xviz-video.js` 81-120 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-video.js#L81-L120)。

这说明“新增/删除 camera 名称”本身无需改组件；前提是 metadata 能完整描述它。

## 5. 状态管理、播放与更新粒度

### 5.1 五层状态实际共存

streetscape.gl/XVIZ 没有单一、不可变的 state tree，而是五层状态共同工作：

| 层次           | 持有者                                     | 内容与更新方式                                                             |
| -------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| Wire/解析      | File/WebSocket Loader + XVIZ Parser        | metadata、timeslice 先被归一化，再通过 `onXVIZMessage` 分发                |
| 时序缓存       | `XVIZStreamBuffer`                         | 可变的 timeslice 数组、按 stream 建立的稀疏数组、裁剪范围和 update counter |
| 派生快照       | `StreamSynchronizer` / `LogSlice`          | 根据 playhead、look-ahead、可见 stream 计算临时 current frame              |
| 会话状态       | `XVIZLoaderInterface.state`                | metadata、timestamp、lookAhead、streamSettings、dataVersion                |
| React 本地状态 | `PlaybackControl` / `LogViewer` / 各 panel | playing、视角、选中与 hover、组件格式化缓存、当前 camera                   |

`LoaderInterface` 的注释明确把 Loader 定义成“同时加载数据的 Store”；它只提供任意字符串
key 的 `get/set` 和全局 listener list，而不是一个有类型的 scene state。参见
[`loader-interface.js` 21-31 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/loader-interface.js#L21-L31)
和
[`loader-interface.js` 60-105 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/loader-interface.js#L60-L105)。

`XVIZLoaderInterface` 又在这个 Store 上叠加消息事件、Buffer、Synchronizer、seek、stream
visibility 和 selector；具体 File/Stream/Live Loader 再继承它并加入传输和缓存策略。比如
`XVIZStreamLoader.seek` 同时更新 playhead、计算服务端请求、裁剪 Buffer 并触发 WebSocket
转换请求。参见
[`xviz-stream-loader.js` 164-204 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/xviz-stream-loader.js#L164-L204)。

这个 façade 使用方便，但资源所有权不清晰：Transport 断开、Buffer 生命周期、播放时钟和 React
订阅没有各自的接口。对从零实现不应复制这一继承树。

### 5.2 通知批处理不等于细粒度订阅

`set` 对引用做不等比较，每次变化增加全局 `_version`，同一 animation frame 只安排一次
通知。这能把 metadata、settings、初始 seek 的连续写入合成一次 React 更新。参见
[`loader-interface.js` 80-98 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/loader-interface.js#L80-L98)。

selector 用 Reselect 包装。无参数 selector 实际把 Loader 的全局 `_version` 当成隐式参数，再由
各 input selector 读取可变 state；结果函数只有在其投影依赖变化时才重算。参见
[`create-selector.js` 21-28 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/utils/create-selector.js#L21-L28)。

实际更新粒度仍较粗：

- 每个 `connectToLog` 都订阅同一个 Loader listener list；任意 key 变化都会更新 wrapper 的
  `logVersion` 并重新执行 `getLogState`。子组件是 `PureComponent` 时可能因投影 props 未变而
  跳过，但 wrapper 和 selector 调用仍发生。参见
  [`connect.js` 26-73 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/connect.js#L26-L73)。
- Buffer 每成功插入一个 timeslice 就增加统一 `dataVersion`；`getStreams` 和
  `getCurrentFrame` 都依赖它，所以任意 stream 的新数据会使全量 stream map 和完整 frame
  重新派生。参见
  [`xviz-loader-interface.js` 126-180 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/xviz-loader-interface.js#L126-L180)
  和
  [`xviz-loader-interface.js` 203-208 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/xviz-loader-interface.js#L203-L208)。
- `XVIZStreamBuffer` 原地修改数组，通过 `lastUpdate/valueOf` 暴露变化计数；Loader 又维护第二个
  `dataVersion`。这要求所有绕过 Loader 的 Buffer 变化都正确同步版本。参见
  [`xviz-stream-buffer.js` 268-289 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/synchronizers/xviz-stream-buffer.js#L268-L289)。

因此它优化的是“同一帧只通知一次”，不是“某个 stream 只通知它的消费者”。

### 5.3 Synchronizer 的边界与限制

`StreamSynchronizer` 从 `(playhead - TIME_WINDOW, playhead]` 取所有 timeslice，反向遍历；
`LogSlice` 对每个启用的 stream 采用遇到的第一个值，显式 `null` 会阻止继续向旧数据回退。
参见
[`stream-synchronizer.js` 38-52 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/synchronizers/stream-synchronizer.js#L38-L52)
和
[`log-slice.js` 155-201 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/synchronizers/log-slice.js#L155-L201)。

这层正确地把增量更新还原成完整快照。但它有三项边界：

- 选择策略是固定时间窗内的 last-known-value，不是插值，也没有按 stream 指定 freshness/
  interpolation policy；
- BaseSynchronizer 自己的注释承认 stream 数据究竟对应哪个 vehicle pose 并不明确，然后仍以
  全局 `PRIMARY_POSE_STREAM` 生成整个 frame；参见
  [`base-synchronizer.js` 50-99 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/synchronizers/base-synchronizer.js#L50-L99)；
- memoization 以完整 stream filter、时间窗口切片和 pose 为输入，输出也是一个全量 frame，不支持
  单 stream selector 的独立 revision。

从零实现应让 descriptor 声明 `hold-last`、`nearest`、`interpolate`、`event` 等同步策略，
Repository 保存 per-stream revision；完整 frame 可以按需组装，但 React 订阅应能只观察
`streamId + time bucket` 或稳定 role。

### 5.4 播放状态被拆在 Loader 和 React 组件两侧

`PlayableLoaderInterface` 只保存 timestamp/lookAhead 并定义 seek、connect、close 等接口，
没有 playing、speed 或 clock。参见
[`playable-loader-interface.js` 21-101 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/playable-loader-interface.js#L21-L101)。

`PlaybackControl` 自己保存 `isPlaying`，用 `requestAnimationFrame + Date.now()` 推进时间，
再调用 `log.seek`；它只在缓冲区包含目标时间时前进，并把大 delta 截断到配置帧率。参见
[`playback-control/index.js` 71-157 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/playback-control/index.js#L71-L157)。

结果是播放时钟属于某个 UI 实例，而 playhead 属于 Loader。多个控制器可以各自启动 RAF；卸载
控制器会停止时钟，但 Loader 没有统一的播放状态。新的实现应由单一 PlaybackTimeline/Session
持有 clock、status、rate、loop 和 seek，控件只派发命令并订阅投影。

### 5.5 Stream settings 的可取之处和数据污染

`StreamSettingsPanel` 从 descriptor map 自动生成 checkbox，用户变更后统一写回
`Record<streamId, boolean>`。这是 inventory 驱动 UI 的正确方向。参见
[`stream-settings-panel.js` 56-150 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/stream-settings-panel.js#L56-L150)
和
[`stream-settings-panel.js` 186-214 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/stream-settings-panel.js#L186-L214)。

但 Loader 初始化时直接把 `metadata.streams` descriptor map 当作 `streamSettings`；过滤时利用
descriptor object 为 truthy 的事实。动态 stream 路径还原地修改该对象，再通过另一个
`streamsMetadata` state write 触发通知。参见
[`xviz-loader-interface.js` 185-222 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/loaders/xviz-loader-interface.js#L185-L222)。

这混合了 catalog 与用户偏好，也使“descriptor 更新”“默认可见性变化”“用户主动开关”无法独立
表达。新的模型应至少分成：

- `catalogById`：不可变 descriptor、独立 catalog revision；
- `visibilityById`：纯 boolean，记录用户覆盖；
- `effectiveVisibility`：用户覆盖优先，否则取 descriptor default；
- `dataRevisionById`：单 stream 数据 revision；
- `playback`：独立时间状态。

## 6. Metrics、Variables 与 Declarative UI

### 6.1 协议中有两种不同的“曲线”

XVIZ 明确区分：

- `time_series` 表示随日志时间逐次到达的瞬时标量。一个 entry 包含一个 timestamp、平行的
  `streams[]` 与 `values[]`，并可带 `object_id`。参见
  [`timeseries_state.schema.json` 1-30 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/schema/schema/core/timeseries_state.schema.json#L1-L30)。
- `variables` 表示某个当前时刻的一整组数组值，例如未来十秒的规划速度；每次更新会替换整组
  values。一个 stream 可包含多个带 `base.object_id` 的 variable。参见
  [`variable_state.schema.json` 1-18 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/schema/schema/core/variable_state.schema.json#L1-L18)
  和
  [`variable.schema.json` 1-24 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/schema/schema/core/variable.schema.json#L1-L24)。

规范用 `/plan/time`、`/plan/velocity`、`/plan/jerk` 三个等长 variable stream 表达一张
X-Y 图；time series 则用于实际值随 playback time 的历史图。参见
[`core-types.md` 200-229 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/protocol-schema/core-types.md#L200-L229)
和
[`core-types.md` 253-268 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/protocol-schema/core-types.md#L253-L268)。

这个区分值得保留，但名称需要更直接。新的领域模型可以分别命名为 `TimelineSample` 和
`SeriesSnapshot`，避免两者在内存中都变成 `streams[id]` 后再靠数组形状判断。

### 6.2 Parser、Buffer 和 Frame 如何处理

V2 Parser 对 variable 做一次标量类型归一化，输出
`{time, variable: [{type, values, id?}]}`；对 time series 则把 wire 上的平行数组拆成
`streamId -> [{time, variable, id?}]`，并拒绝同 stream/object/timestamp 的重复项。参见
[`parse-xviz-stream.js` 334-364 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/parsers/parse-xviz-stream.js#L334-L364)
和
[`parse-xviz-stream.js` 392-487 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/parsers/parse-xviz-stream.js#L392-L487)。

`parseStreamSets` 最终把 primitive、variable、time series、future 和 UI primitive 都合进
同一个 `newStreams` map；Buffer 也对它们使用同一套稀疏 timeslice 索引。参见
[`parse-timeslice-data-v2.js` 97-190 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/parsers/parse-timeslice-data-v2.js#L97-L190)。

`LogSlice` 只把带 `variable` 字段的 datum 另投影到 `frame.variables`；time series 仍留在
`frame.streams`。如果 time series 带 object ID，它还把 stream 路径最后一段当作对象属性名。
参见
[`log-slice.js` 207-260 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/synchronizers/log-slice.js#L207-L260)
和
[`log-slice.js` 42-55 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/synchronizers/log-slice.js#L42-L55)。

最后一项仍让 rename 改变对象属性语义，是不应继承的隐性名称耦合。对象属性应由 descriptor
中的稳定 role/attribute key 明确声明。

### 6.3 Metric、Plot、Table、Video、Panel 的实际绑定

| 组件            | 配置绑定                                     | 数据选择路径                                                        | 名称依赖                     |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------- | ---------------------------- |
| Metric          | `streams: streamId[]`                        | `log.getStreams()` 取整个已加载历史，再按 ID 形成时间图             | 精确 ID                      |
| Plot            | `independentVariable` + `dependentVariables` | `getCurrentFrame().variables[id]`，把 X 数组与每个 Y 数组配对       | 精确 ID                      |
| Table/TreeTable | `stream`                                     | `getCurrentFrame().streams[id].treetable`                           | 精确 ID                      |
| Video           | `cameras` filter                             | metadata 自动发现 IMAGE，再从 `getStreams()[selectedId]` 取图片历史 | 可自动发现；filter 可精确 ID |
| Panel           | `name`                                       | `metadata.ui_config[name]`，递归渲染 children                       | 精确 panel name              |

Metric 的 helper 只选择没有 object ID 的 stream-level sample，可应用 `scale/valueMap`，并报告
缺失 stream。参见
[`metrics-helper.js` 23-79 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/utils/metrics-helper.js#L23-L79)
和
[`xviz-metric.js` 95-174 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-metric.js#L95-L174)。

这里还有协议/实现漂移：V2 schema 字段是 `units`，而 metrics helper 读取 `metadata.unit`；
`scale`、`nograph`、`valueMap` 也不在 V2 `stream_metadata` schema 中。参见
[`stream_metadata.schema.json` 6-69 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/schema/schema/session/stream_metadata.schema.json#L6-L69)
和
[`metrics-helper.js` 26-44 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/utils/metrics-helper.js#L26-L44)。
这说明声明式 UI 的字段必须与协议 schema 共用类型和测试，不能在 renderer 中另增未声明属性。

Plot 从 current frame 精确索引 X/Y stream，并在组件 state 中缓存格式化后的点对；它没有验证
X/Y 长度、scalar type 或单位是否兼容。参见
[`xviz-plot.js` 80-177 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-plot.js#L80-L177)
和
[`xviz-plot.js` 232-240 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-plot.js#L232-L240)。

Table 直接假定绑定 stream 包含 `treetable`；Video 则是少数先按 descriptor type 发现候选项的
组件。参见
[`xviz-table.js` 147-153 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-table.js#L147-L153)
和
[`xviz-video.js` 81-150 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-video.js#L81-L150)。

### 6.4 Declarative UI 解除了代码发布耦合，但没有解除语义耦合

`ui_config` 随 metadata 下发，数据模型是 Panel/Container/Component 树。后端可以组合 metric、
plot、table、video 等允许的组件。参见
[`overview.md` 5-16 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/docs/declarative-ui/overview.md#L5-L16)
和
[`panel.schema.json` 16-79 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/schema/schema/declarative-ui/panel.schema.json#L16-L79)。

MetadataBuilder 把每个 panel 包装成 `ui_config[panelKey] = {name, config}`；streetscape.gl 再按
调用方传入的 panel `name` 精确查找。参见
[`xviz-metadata-builder.js` 50-72 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/builder/src/builders/xviz-metadata-builder.js#L50-L72)
和
[`xviz-panel.js` 87-95 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-panel.js#L87-L95)。

因此后端重命名 stream 时，只要同步修改 declarative config，前端 TSX 可以不发版；但配置里的
`streams`、`stream`、`independentVariable`、`dependentVariables` 和 `cameras` 仍是精确
ID。它把 binding 从代码迁到了协议，没有提供稳定 role 或查询语义。

### 6.5 从零实现的取舍

适合借鉴：

- 保留 timeline sample 与 current series snapshot 的语义区分；
- 配置树只允许注册过的 component type，并为每个节点执行 schema 校验；
- Panel 配置与数据一起发布，使数据生产者能声明合理的默认展示；
- Protocol Decoder 在边界把高效 wire shape 一次归一成前端领域 shape。

不应照搬：

- 不把 primitive、variable、time series、table 全塞进一个靠运行时 shape 区分的
  `frame.streams`；
- 不让 panel binding 默认依赖可变 stream ID。绑定应优先使用
  `{role, payloadType, cardinality}`，解析成功后才得到 Catalog 中的 stream ID；精确 ID 只作为明确的
  低层 escape hatch；
- 不让全局 visibility 决定 metric/plot 的数据是否存在。渲染可见性、数据保留和 panel 订阅是
  三个策略；
- 不保留 beta panel 包装与旧 camel/snake、V1/V2 双形态。新协议只接受一个严格 schema；
- 未知 component、缺失 role、重复单例 role、类型/单位不兼容都应产生结构化诊断，不能静默
  返回 `null`。

## 7. React 组件层级、目录与注册表

### 7.1 上游不是单一 Viewer 树，而是共享 Log 的多个兄弟入口

core package 分别导出 `LogViewer`、`PlaybackControl`、`StreamSettingsPanel`、
`XVIZPanel` 和 HUD widgets；应用把同一个 `log` prop 传给它们，每个入口独立
`connectToLog`。参见
[`modules/core/src/index.js` 28-64 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/index.js#L28-L64)。

典型层级是：

```text
Application
├─ LogViewer -> Core3DViewer -> DeckGL / StaticMap
│               ├─ XVIZLayer -> deck.gl primitive layer
│               └─ ObjectLabelsOverlay
├─ PlaybackControl
├─ StreamSettingsPanel
├─ XVIZPanel -> Container -> Metric / Plot / Table / Video
└─ HUD widgets
```

`LogViewer` 是交互容器：本地保存 view state、offset、selected/hover state，也允许调用方用 props
接管；它把 frame 和交互回调交给 `Core3DViewer`。参见
[`log-viewer/index.js` 35-159 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/log-viewer/index.js#L35-L159)。

`Core3DViewer` 是 renderer/compositor，但仍同时管理 style parser、views、map/deck lifecycle、
layer creation、picking 和 debug metrics。参见
[`core-3d-viewer.js` 115-207 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/log-viewer/core-3d-viewer.js#L115-L207)
和
[`core-3d-viewer.js` 388-463 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/log-viewer/core-3d-viewer.js#L388-L463)。

Metric/Plot/Table/Video 也不是纯展示组件：默认导出已连接 Loader 的组件，内部再保存格式化缓存或
camera selection。所以上游有“container 与 renderer 分开”的方向，但没有稳定贯彻到每个组件。

### 7.2 目录和 package 边界

`modules/core/src` 按技术职责分为 `loaders`、`components`、`layers`、`utils`、`perf`；
复杂 UI 再按 `log-viewer`、`playback-control`、`declarative-ui`、`hud` 分目录。通用
`XVIZLayer` 和 PointCloudLayer 在 core；Lane、Sign、TrafficLight、Imagery 等领域 Layer 放在
单独 `@streetscape.gl/layers` package。参见
[`modules/layers/src/index.js` 21-24 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/layers/src/index.js#L21-L24)。

可借鉴的是“通用 payload renderer 不认识业务，领域 Layer 独立注册”。不需要照搬多 npm package；
如果 e2e-viz 规模较小，使用同一仓库内的 `scene-data`、`playback`、`rendering`、
`panels`、`scene-viewer` 边界即可，避免技术目录下再次混入 store 和 transport。

### 7.3 Panel registry

`XVIZPanel` 内置 `type -> React component` allowlist，并允许应用用 `components[type]`
覆盖；Container 递归渲染 children。未知 type 被静默跳过。参见
[`xviz-panel.js` 32-83 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-panel.js#L32-L83)
和
[`xviz-container.js` 24-66 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-container.js#L24-L66)。

这个 allowlist/override 机制适合保留，但 registry entry 应同时提供 component、config schema、
binding requirements 和 error fallback；不能只有一个 React class。

### 7.4 两种 custom layer 机制

Core3DViewer 支持：

1. `customLayers`：调用方直接提供 deck.gl Layer；如果 props 带 `streamName`，Viewer 会用精确
   ID 注入 data 和坐标变换。
2. `customXVIZLayers`：在通用 XVIZLayer 内执行
   `streamMatch(streamName, streamMetadata)`，用第一个匹配项替换默认 primitive renderer。

参见
[`core-3d-viewer.js` 312-347 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/log-viewer/core-3d-viewer.js#L312-L347)
和
[`xviz-layer.js` 411-475 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/layers/xviz-layer.js#L411-L475)。

第二种比精确名称绑定更好，但仍不是完整插件系统：

- 使用数组 `.find`，只取第一个匹配项，没有 priority、冲突诊断或组合规则；
- custom match 发生前，payload 必须先被内部 `XVIZ_TO_LAYER_TYPE` 识别；未知 primitive type 在
  `renderLayers` 开头就返回，custom registry 不能扩展新协议类型；
- 预处理只对内置 handler 开放；
- 官方示例明确标注该 API 不受 semver 保护。参见
  [`custom-xviz-layers/README.md` 1-6 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/examples/custom-xviz-layers/README.md#L1-L6)。

新的 RendererRegistry 应直接以 `payloadType` 注册 decoder/renderer，并允许
entry 声明 `matches(descriptor)`、priority、validation 和 fallback。重复同优先级匹配应在注册
或 catalog 解析时失败，不能由数组顺序决定。

### 7.5 从零重做时应删除的 legacy 结构

当前固定提交仍同时维护 V1/V2 primitive 名、旧 inline style、替代属性名和 lowercase image；
Panel 也同时接受 `panel.config` 与 beta 直接结构。参见
[`xviz-layer.js` 43-60 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/layers/xviz-layer.js#L43-L60)、
[`xviz-layer.js` 237-325 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/layers/xviz-layer.js#L237-L325)、
[`xviz-video.js` 81-87 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-video.js#L81-L87)
和
[`xviz-panel.js` 87-94 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/src/components/declarative-ui/xviz-panel.js#L87-L94)。

既然目标明确为从零重做，就应只保留一个严格 schema：

- wire 字段只接受一种命名；
- Parser 不按全局 major version 分支；
- Renderer 不保留旧 primitive/style fallback；
- React 不保留旧 export 名和旧 lifecycle；
- Panel 不接受 beta shape；
- Decoder 边界之外不出现旧字段或 wire 协议对象。

目标依赖方向应收敛为：

```text
Transport -> Protocol Decoder -> SceneRepository -> SceneSession/Playback
                                      |                  |
                                      v                  v
                               typed selectors     UI commands
                                      |
                         RendererRegistry / PanelRegistry
                                      |
                              presentational React
```

其中 Session 是 composition root；Transport 不充当 Store，React 不直接持有 Buffer，Panel 和 Layer
都只消费经过 binding resolver 与 schema validation 的 selector 结果。

## 8. 协议与架构演进

上游提交历史显示，解耦是逐步移除名称特例，而不是不断增加名称映射：

| 时间    | 变化                                                         | 含义                                                            |
| ------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| 2018-08 | XVIZ 删除 `NON_RENDERING_STREAMS` 和 `VIDEO_STREAM_PATTERNS` | 不再用正则从名称猜 video 或维护“不渲染名单”                     |
| 2019-01 | streetscape.gl 删除 `OBJECT_STREAM` 依赖                     | 通过 primitive 的 ID/type 识别对象，不指定唯一对象流            |
| 2019-07 | XVIZ 与 streetscape.gl 增加 dynamic stream metadata          | metadata 缺失时可从 payload type 兜底，新 stream 可自动加入设置 |
| 2019-11 | XVIZ/streetscape.gl 增加 link/pose transform graph           | 坐标关系不再只能指向固定 vehicle pose                           |
| 2021-01 | XVIZ 内部将 pose 与普通 stream 分开                          | 强化 pose 的独立时序和变换职责                                  |
| 2021-04 | streetscape.gl 增加 `customXVIZLayers`                       | 自定义 renderer 可按 metadata 匹配，而不只按固定名称            |

证据：

- [`fd5770f: remove NON_RENDERING_STREAMS and VIDEO_NAME_PATTERN`](https://github.com/aurora-opensource/xviz/commit/fd5770fd61a986e2891e57a024fea5d4ae855bd9)
- [`025be03: Remove dependency on OBJECT_STREAM config`](https://github.com/aurora-opensource/streetscape.gl/commit/025be03be57803965250829449d44ea9342c9fc1)
- [`2c9d3aa: Support dynamic stream metadata`](https://github.com/aurora-opensource/xviz/commit/2c9d3aa630b799e6c858a8a9998ef23db2aca764)
- [`888405d: streetscape.gl support dynamic stream metadata`](https://github.com/aurora-opensource/streetscape.gl/commit/888405d49a9fcc8606a20246c3b5e85b2a99d79a)
- [`9cb3c30: Transform streams`](https://github.com/aurora-opensource/xviz/commit/9cb3c30a28ffadb5a7f7414cddfe93d7d0ca2799)
- [`6a3549e: resolve transform links scene graph`](https://github.com/aurora-opensource/streetscape.gl/commit/6a3549eba1ff122fe2135c87d576ac4dbe6ee255)
- [`d745817: Separate Pose from Streams`](https://github.com/aurora-opensource/xviz/commit/d7458175c4fcbb9312eab64a5c01c7b7ca0e39bd)
- [`308bc30: Added Custom XVIZ Layer Capability`](https://github.com/aurora-opensource/streetscape.gl/commit/308bc3034f86370fc083fe90b42b4e01c6deac74)

维护状态也必须纳入判断：streetscape.gl 最新提交和发布均停在 2022-06；XVIZ 最新正式发布
是 2022-06 的 `v1.0.13`，2024-07 的 master 提交只更新 Protobuf 生成物。streetscape.gl core
依赖 React 16+、deck.gl 8.1、react-map-gl 5.2，参见
[`modules/core/package.json` 18-37 行](https://github.com/aurora-opensource/streetscape.gl/blob/befae1354ca8605c9f6cb1229b494858a8690e4f/modules/core/package.json#L18-L37)。
它们适合作为架构样本，不适合作为现代 e2e-viz 的直接运行时依赖。

## 9. 对 e2e-viz 可采用的设计

本章按“从零重做、只接受当前 schema、可直接删除旧字段”的前提给出最终方向。上文中的
XVIZ 版本分支、兼容输入和 `stream_aliases` 只作为上游事实，不进入 e2e-viz 设计。

### 9.1 采用：自描述 StreamCatalog

metadata 应成为唯一 stream inventory。建议把“名字、类型、业务角色、显示信息”拆开：

```ts
type StreamId = string

interface StreamDescriptor {
  payloadType: 'pose' | 'point' | 'polyline' | 'polygon' | 'cuboid' | 'image'
  role?: string
  coordinate: 'world' | 'ego' | 'sensor'
  transform?: number[]
  display?: {
    label?: string
    group?: string
    order?: number
    defaultVisible?: boolean
    style?: Record<string, unknown>
  }
  capabilities?: string[]
}

interface StreamCatalog {
  streams: Record<StreamId, StreamDescriptor>
}
```

职责需要明确：

- `StreamId` 是 wire identity，不承诺包含业务含义；
- `payloadType` 决定 decoder、校验器和 renderer；
- `role` 是稳定业务语义，例如 `ego.pose`、`objects.bounds`、`planning.trajectory`；
- `display` 只负责默认展示，不进入几何解析；
- `capabilities` 用于声明 selectable、statistics、camera 等可选能力；
- Catalog 与数据文件按同一严格 schema 一次加载；不做版本协商或旧字段回退。

### 9.2 采用：按 type 注册，不按 name 分支

目标调用关系应是：

```text
StreamCatalog
  -> descriptor(payloadType)
  -> PayloadDecoderRegistry[payloadType]
  -> normalized payload
  -> LayerRegistry[payloadType]
```

添加或删除一个已有 type 的 stream，只改变 Catalog 和数据，不改变 Decoder/Layer 注册表。
只有新增 payload type 或修改 payload schema 才需要前端实现和发版。

未知情况必须有确定行为：

- Catalog 增加任意新 stream ID、且 payloadType 已注册：自动解码并渲染；
- payloadType 符合 schema、但前端没有对应 renderer：隔离该 stream 并显示一次诊断；
- frame 出现但 metadata 缺失：作为 schema 错误拒绝该场景，不推断 coordinate、role 或 style；
- metadata 声明但 frame 暂无数据：保留可见性设置，不构造空 GPU Layer。

### 9.3 采用：role 只服务真正的业务功能

普通 3D 渲染不查询 `role`，直接遍历所有 descriptor/payload。以下功能才查询 role：

- 主车 pose 和 ego-relative transform；
- 统计面板的输入；
- 选中对象的 bounds/label 关联；
- 特定 camera 面板；
- 规划/GT 对比等业务组合。

Role selector 应明确基数，例如 `requireOne(role)`、`findMany(role)`，并在缺失、重复时给出可诊断
结果。这样后端把 `/gt/objects/bounds` 改成 `/labels/boxes` 时，只要 `role` 保持不变，前端业务
逻辑不需要修改。

### 9.4 采用：单一严格 Schema 与 Decoder

Protocol Decoder 是唯一 wire 边界：

```text
wire metadata + payload
  -> strict schema validation
  -> payloadType decoder
  -> normalized scene data
  -> repository/frame/store
```

Decoder 必须拒绝未知字段、缺失 descriptor、payloadType 与数据结构不一致、重复单例 role 和非法
坐标定义。名称变化不是兼容事件：生产端直接输出符合当前 schema 的新 Catalog，业务选择器继续按
稳定 role 查询。前端不维护旧字段、旧名称或双读逻辑。

### 9.5 采用：Repository 输出完整领域帧

XVIZ 的 Buffer/Synchronizer 适合 WebSocket 和不同频率异步流。e2e-viz 当前是一帧一个可随机访问
文件，生产端已经把动态数据对齐到关键帧；继续保留 complete/incremental 会让随机跳转从较早帧
开始重放 patch。新的 frame 文件应直接保存该帧所有动态 stream 的完整快照：出现即有值，缺失即
当前帧无值。静态 stream 和全场景 series 分别加载，不参与帧 patch。

领域帧只需要：

```ts
interface SceneFrame {
  index: number
  timestamp: number
  streams: Readonly<Record<StreamId, StreamPayload>>
}
```

Repository 可以将 immutable static stream 与单帧 snapshot 组合成完整领域帧，但不能从第 0 帧
重放到目标帧。这样随机跳转、删除 stream 和缓存语义都不再依赖历史消息。

### 9.6 采用：受约束的声明式展示

可以让后端 metadata 声明 label、group、style、default visibility，以及统计/视频面板需要的 role
或 stream binding。前端仍维护有限 component/Layer allowlist 和 props schema，不执行服务端提供的
代码。

这保留 XVIZ declarative UI 的免发版能力，同时避免把产品布局和任意组件执行权全部交给数据源。

### 9.7 采用：Schema 与契约测试

XVIZ Schema 对 metadata、state update、stream set 和 primitive 分层验证；Validator 直接暴露
对应入口，参见
[`validator.js` 26-74 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/schema/src/validator.js#L26-L74)。

e2e-viz 应建立以下契约测试：

- metadata 中增加一个已有 type 的随机名称 stream，前端自动显示且无需代码配置；
- 删除一个非必需 stream，Viewer 正常运行且控件同步消失；
- 修改 ID 但保持 role，业务 selector 结果不变；
- 旧字段、未知字段和缺失 descriptor 被严格拒绝；
- payloadType 合法但 renderer 未注册时只隔离该 stream；
- 任意帧只读取一个 frame 文件即可构造，缺失 stream 不从旧帧继承；
- payloadType 与 payload shape 不匹配时不进入 Repository。

## 10. 不应照搬的部分

### 10.1 不直接引入完整 XVIZ/streetscape.gl

当前项目不需要复制 XVIZ 的全部 autonomy world model、WebSocket session、Declarative UI、
Protobuf、deck.gl 或对象关联系统。协议和依赖栈已老化，直接迁移会扩大范围并替换现有渲染技术，
却不能自动补上 e2e-viz 所需的业务 role。

应借鉴 descriptor、严格 schema、声明式 Panel 和 type registry，而不是迁移框架。当前离线关键帧
数据不需要复制 XVIZ 的实时 update semantics、Buffer 或 Synchronizer。

### 10.2 不复制 Loader = transport + store + log + playback

streetscape.gl 的 `XVIZLoaderInterface` 同时管理消息、Buffer、Synchronizer、可见性、时间和
observable state。这个 API 使用方便，但所有职责共用版本号和订阅通知，资源所有权与测试边界
不够清晰。

e2e-viz 应保持 Transport、Protocol Decoder、Repository、Session/Playback 和 Store selector
分离。

### 10.3 不复制全局 XVIZ config

XVIZ 在解析 metadata 时把当前 major version 写入模块级 config；stream blacklist、primary pose、
dynamic metadata 也是全局设置。参见
[`parse-log-metadata.js` 19-43 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/parsers/parse-log-metadata.js#L19-L43)
和
[`xviz-config.js` 47-76 行](https://github.com/aurora-opensource/xviz/blob/b326535f28e0a08d70b4c4252ec2cccedc237381/modules/parser/src/config/xviz-config.js#L47-L76)。

Decoder 的规则应由唯一 schema 确定，不能由一个场景 metadata 改变另一个 Viewer。

### 10.4 不把路径层级当成业务类型系统

`/gt/...`、`/pred/...`、`/camera/...` 适合作为可读名称和 UI 分组，但不应通过 `startsWith`、
正则或 `split('/')` 决定 decoder、renderer 或业务角色。上游 2018 年删除 video 名称正则的历史
已经说明这种做法无法长期演进。

### 10.5 不把动态推断当作正常协议

从 payload 第一个 primitive 推断 type 可以在 metadata 缺失时维持可见，但：

- 空 stream 无法推断；
- 同一 stream 混合类型会产生歧义；
- 无法推断 coordinate、transform、role、style 和单位；
- 错误 metadata 可能被静默掩盖。

生产协议应要求 descriptor 完整；不提供动态推断模式。

### 10.6 不引入 `stream_aliases`

Alias 只处理 rename，不能处理：

- 新增/删除 stream；
- 一个 role 对应多个 stream；
- payload schema 或坐标语义变化；
- UI/统计功能需要的稳定语义；
- 运行中 catalog 更新。

它还会引入第二套 ID、冲突规则和额外状态迁移。本方案直接以 type registry 处理数据结构，以
role/capability 处理稳定语义，不设计 alias resolver。

## 11. 建议的落地顺序

上游研究支持以下依赖顺序，具体文件和提交阶段需结合当前实现确定：

1. 定义唯一的 `StreamDescriptor`、`StreamCatalog`、`SceneFrame` schema；先补协议 fixture
   与严格 Schema 测试。
2. 建立 Protocol Decoder，集中完成 descriptor 与 payload validation，不接受旧字段或未声明字段。
3. 将静态 stream、全场景 series 和逐帧 snapshot 分开；Repository 直接按帧随机读取，不重放 patch。
4. 建立 `PayloadDecoderRegistry` 与 `LayerRegistry`，删除按名称选择 payload/Layer 的逻辑。
5. 建立 role index，只迁移主车 pose、统计、camera、对象关联等确有语义需求的功能。
6. 从 metadata 生成 stream settings、label、group、默认样式；合法但无 renderer 的 type
   降级隔离。
7. 最后删除旧名称常量、路径正则和所有旧字段分支，并用随机 stream ID 的契约测试证明解耦完成。

## 12. 验证方法

本研究执行了以下只读检查：

- 完整 clone 两个上游仓库，并记录 HEAD、tag、最近提交和 package version；
- 从 Schema、规范、Builder、IO、Parser、Buffer、Synchronizer、Loader、React connector、
  Viewer、Layer registry 逐层追踪 stream ID；
- 对 `stream_alias`、`PRIMARY_POSE_STREAM`、`OBJECT_STREAM`、`DYNAMIC_STREAM_METADATA`、
  `customXVIZLayers` 和源码中的绝对 stream 字符串做仓库级检索；
- 使用 `git log -S` 和 `git show` 验证名称特例的移除、动态 metadata、transform link、pose
  分离和自定义 Layer 的演进；
- 所有源码引用使用 commit permalink，避免 master 漂移；本地核对了 107 个 blob 链接的固定
  commit、文件路径和行号范围，以及 10 个 commit 链接；
- 使用项目内 Prettier 检查本文，并执行 `git diff --check`；由于本文是未跟踪新文件，另以
  `git diff --no-index --check /dev/null <file>` 覆盖新文件本身。

未执行上游构建和测试。本文结论依赖静态源码、规范和历史记录，不声称验证两个已老化依赖栈在
当前 Node/浏览器环境中的可运行性。
