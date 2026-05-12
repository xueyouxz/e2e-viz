# NUSVIZ 流式数据协议

本文档定义 NUSVIZ 的流式数据结构与存储格式。协议使用 GLB 作为二进制容器，通过 metadata 声明 stream，通过 message 文件按时间写入每帧状态。

---

## 1. 目录结构

```text
<scene_dir>/
├── metadata.glb
├── message_index.json
└── messages/
    ├── 000000.glb
    ├── 000001.glb
    └── ...
```

| 文件                 | 内容                                                      |
| -------------------- | --------------------------------------------------------- |
| `metadata.glb`       | 场景级静态信息、stream 声明、相机参数、静态地图、栅格底图 |
| `message_index.json` | 帧索引，记录每帧时间戳与 message 文件路径                 |
| `messages/*.glb`     | 每帧流式状态数据                                          |

---

## 2. GLB 容器

所有 `.glb` 文件使用 glTF 2.0 Binary 格式，包含 JSON chunk 和 BIN chunk。

JSON chunk 顶层包含：

```json
{
  "bufferViews": [],
  "accessors": [],
  "images": [],
  "nuviz": {}
}
```

| 字段          | 说明                                   |
| ------------- | -------------------------------------- |
| `bufferViews` | BIN chunk 中二进制片段的字节位置和长度 |
| `accessors`   | 二进制数组的元素类型、维度、数量       |
| `images`      | 图像数据引用                           |
| `nuviz`       | NUSVIZ 协议数据                        |

NUSVIZ 字段通过 JSON Pointer 引用 accessor 或 image：

```json
"#/accessors/0"
"#/images/0"
```

BIN chunk 中所有数据按 4 字节对齐。

---

## 3. 固定 Stream Type

`type` 只表示可视化几何类型。前端根据 `type` 创建基础图层，根据 stream 名称决定样式。

| type       | 数据含义           | 典型图层                 |
| ---------- | ------------------ | ------------------------ |
| `pose`     | 位姿               | Ego pose / transform     |
| `point`    | 点集合或点云       | PointCloudLayer          |
| `polyline` | 折线、轨迹、地图线 | PathLayer                |
| `polygon`  | 多边形区域         | PolygonLayer             |
| `cuboid`   | 3D 目标框          | CuboidLayer              |
| `image`    | 相机图像或栅格图   | ImageLayer / BitmapLayer |

`type` 不承载业务语义。业务语义由 stream 名称表达。

---

## 4. Stream 命名

### 4.1 基础传感器与位姿

```json
{
  "/ego_pose": {
    "category": "POSE",
    "type": "pose",
    "coordinate": "world"
  },
  "/lidar": {
    "category": "PRIMITIVE",
    "type": "point",
    "coordinate": "world"
  },
  "/camera/CAM_FRONT": {
    "category": "PRIMITIVE",
    "type": "image",
    "coordinate": "ego"
  },
  "/camera/CAM_FRONT_LEFT": {
    "category": "PRIMITIVE",
    "type": "image",
    "coordinate": "ego"
  },
  "/camera/CAM_FRONT_RIGHT": {
    "category": "PRIMITIVE",
    "type": "image",
    "coordinate": "ego"
  },
  "/camera/CAM_BACK": {
    "category": "PRIMITIVE",
    "type": "image",
    "coordinate": "ego"
  },
  "/camera/CAM_BACK_LEFT": {
    "category": "PRIMITIVE",
    "type": "image",
    "coordinate": "ego"
  },
  "/camera/CAM_BACK_RIGHT": {
    "category": "PRIMITIVE",
    "type": "image",
    "coordinate": "ego"
  }
}
```

### 4.2 地图与底图

```json
{
  "/map/basemap": {
    "category": "PRIMITIVE",
    "type": "image",
    "coordinate": "world"
  },
  "/gt/map/drivable_area": {
    "category": "PRIMITIVE",
    "type": "polygon",
    "coordinate": "world"
  },
  "/gt/map/road_segment": {
    "category": "PRIMITIVE",
    "type": "polygon",
    "coordinate": "world"
  },
  "/gt/map/lane": {
    "category": "PRIMITIVE",
    "type": "polygon",
    "coordinate": "world"
  },
  "/gt/map/lane_connector": {
    "category": "PRIMITIVE",
    "type": "polygon",
    "coordinate": "world"
  },
  "/gt/map/ped_crossing": {
    "category": "PRIMITIVE",
    "type": "polygon",
    "coordinate": "world"
  },
  "/gt/map/walkway": {
    "category": "PRIMITIVE",
    "type": "polygon",
    "coordinate": "world"
  },
  "/gt/map/stop_line": {
    "category": "PRIMITIVE",
    "type": "polygon",
    "coordinate": "world"
  },
  "/gt/map/carpark_area": {
    "category": "PRIMITIVE",
    "type": "polygon",
    "coordinate": "world"
  }
}
```

### 4.3 GT 对象与轨迹

```json
{
  "/gt/objects/bounds": {
    "category": "PRIMITIVE",
    "type": "cuboid",
    "coordinate": "world"
  },
  "/gt/objects/future_trajectories": {
    "category": "PRIMITIVE",
    "type": "polyline",
    "coordinate": "world"
  },
  "/gt/ego/future_trajectory": {
    "category": "PRIMITIVE",
    "type": "polyline",
    "coordinate": "world"
  }
}
```

### 4.4 SparseDrive 预测

```json
{
  "/pred/sparsedrive/planning": {
    "category": "PRIMITIVE",
    "type": "polyline",
    "coordinate": "world"
  },
  "/pred/sparsedrive/objects/bounds": {
    "category": "PRIMITIVE",
    "type": "cuboid",
    "coordinate": "world"
  },
  "/pred/sparsedrive/map/divider": {
    "category": "PRIMITIVE",
    "type": "polyline",
    "coordinate": "world"
  },
  "/pred/sparsedrive/map/boundary": {
    "category": "PRIMITIVE",
    "type": "polyline",
    "coordinate": "world"
  },
  "/pred/sparsedrive/map/ped_crossing": {
    "category": "PRIMITIVE",
    "type": "polyline",
    "coordinate": "world"
  }
}
```

---

## 5. message_index.json

```json
{
  "message_format": "BINARY",
  "metadata": "metadata.glb",
  "log_info": {
    "start_time": 1533151709.572,
    "end_time": 1533151729.872
  },
  "messages": [
    {
      "index": 0,
      "timestamp": 1533151709.572,
      "file": "messages/000000.glb"
    }
  ],
  "extensions": {
    "nuscenes": {
      "scene_token": "cc8c0bf57f984915a77078b10eb33198",
      "scene_name": "scene-0916",
      "mapId": "singapore-onenorth"
    }
  }
}
```

---

## 6. metadata.glb

`metadata.glb` 的 `nuviz` 字段结构如下：

```json
{
  "type": "nuviz/metadata",
  "data": {
    "scene_name": "scene-0916",
    "scene_description": "Parked truck, construction, intersection, turn left, following a van",
    "log_info": {
      "start_time": 1533151709.572,
      "end_time": 1533151729.872
    },
    "streams": {},
    "cameras": {},
    "map": {},
    "statistics": {},
    "extensions": {}
  }
}
```

| 字段                | 说明                                        |
| ------------------- | ------------------------------------------- |
| `scene_name`        | 场景名称，来自 nuScenes `scene.name`        |
| `scene_description` | 场景描述，来自 nuScenes `scene.description` |
| `log_info`          | 场景时间范围                                |
| `streams`           | 场景包含的 stream 声明                      |
| `cameras`           | 相机内外参                                  |
| `map`               | 静态地图和底图 payload                      |
| `statistics`        | 与 message 帧对齐的场景统计                 |
| `extensions`        | 数据集或生产方扩展字段                      |

### 6.1 cameras

```json
{
  "CAM_FRONT": {
    "image_width": 1600,
    "image_height": 900,
    "intrinsic": [
      [1266.417, 0.0, 816.267],
      [0.0, 1266.417, 491.507],
      [0.0, 0.0, 1.0]
    ],
    "extrinsic": {
      "translation": [1.72200568, 0.00475453, 1.49491292],
      "rotation": [0.9999, 0.0, 0.0071, 0.0105]
    }
  }
}
```

### 6.2 map

静态地图按 stream 名称组织。每个矢量地图 stream 使用 `polygon` payload：

```json
{
  "/gt/map/lane": {
    "vertices": "#/accessors/N",
    "offsets": "#/accessors/N+1",
    "count": 128
  }
}
```

栅格底图使用 `image` payload：

```json
{
  "/map/basemap": {
    "image": "#/images/0",
    "width": 1742,
    "height": 2263,
    "bounds": {
      "min_x": 321.3,
      "min_y": 1029.6,
      "max_x": 495.5,
      "max_y": 1255.9
    },
    "resolution": {
      "meters_per_pixel_x": 0.1,
      "meters_per_pixel_y": 0.1
    }
  }
}
```

### 6.3 statistics

`statistics` 存储场景级统计时间序列。`timeline` 和 `ego_state` 使用按帧对齐的 dense 数组，数组长度与 `message_index.json.messages` 一致。对象计数使用 sparse 数组，仅记录非零帧。若场景包含 SparseDrive 预测，`object_counts` 同时写入 `/pred/sparsedrive/objects/bounds` 的预测对象数量统计。

```json
{
  "frame_count": 41,
  "timeline": {
    "values": "#/accessors/N",
    "unit": "second",
    "reference": "log_info.start_time"
  },
  "ego_state": {
    "speed": {
      "values": "#/accessors/N+1",
      "unit": "meter_per_second"
    },
    "acceleration": {
      "values": "#/accessors/N+2",
      "unit": "meter_per_second_squared"
    }
  },
  "object_counts": {
    "/gt/objects/bounds": {
      "unit": "count",
      "total": {
        "frame_indices": "#/accessors/N+3",
        "values": "#/accessors/N+4"
      },
      "categories": {
        "car": {
          "frame_indices": "#/accessors/N+5",
          "values": "#/accessors/N+6"
        },
        "pedestrian": {
          "frame_indices": "#/accessors/N+7",
          "values": "#/accessors/N+8"
        },
        "truck": {
          "frame_indices": "#/accessors/N+9",
          "values": "#/accessors/N+10"
        }
      }
    },
    "/pred/sparsedrive/objects/bounds": {
      "unit": "count",
      "total": {
        "frame_indices": "#/accessors/N+11",
        "values": "#/accessors/N+12"
      },
      "categories": {
        "car": {
          "frame_indices": "#/accessors/N+13",
          "values": "#/accessors/N+14"
        },
        "pedestrian": {
          "frame_indices": "#/accessors/N+15",
          "values": "#/accessors/N+16"
        }
      }
    }
  },
  "metrics": {
    "collision": {
      "values": "#/accessors/N+17",
      "unit": "boolean",
      "dtype": "uint8"
    },
    "detection": {
      "values": "#/accessors/N+18",
      "unit": "score",
      "dtype": "float32"
    },
    "mapping": {
      "values": "#/accessors/N+19",
      "unit": "score",
      "dtype": "float32"
    },
    "planning": {
      "values": "#/accessors/N+20",
      "unit": "score",
      "dtype": "float32"
    }
  }
}
```

| 字段                                                     | 说明                                               |
| -------------------------------------------------------- | -------------------------------------------------- |
| `frame_count`                                            | 场景 message 数量                                  |
| `timeline.values`                                        | 每帧相对参考时间的时间偏移                         |
| `timeline.unit`                                          | 时间偏移单位                                       |
| `timeline.reference`                                     | 时间偏移参考点                                     |
| `ego_state.speed.values`                                 | 每帧自车速度标量                                   |
| `ego_state.speed.unit`                                   | 自车速度单位                                       |
| `ego_state.acceleration.values`                          | 每帧自车加速度标量                                 |
| `ego_state.acceleration.unit`                            | 自车加速度单位                                     |
| `object_counts.<stream>.unit`                            | 指定对象框 stream 的计数单位                       |
| `object_counts.<stream>.total.frame_indices`             | 对象总数非零的帧索引                               |
| `object_counts.<stream>.total.values`                    | 对象总数非零帧对应的对象数量                       |
| `object_counts.<stream>.categories.<name>.frame_indices` | 指定类别对象数非零的帧索引                         |
| `object_counts.<stream>.categories.<name>.values`        | 指定类别对象数非零帧对应的对象数量                 |
| `metrics.<name>.values`                                  | 每帧指标值，数组长度为 `frame_count`               |
| `metrics.<name>.unit`                                    | 指标单位，数值评分为 `score`，碰撞标记为 `boolean` |
| `metrics.<name>.dtype`                                   | 指标 accessor 数据类型                             |

#### statistics accessor 格式

| 字段                                                | accessor type | dtype   | shape  | 说明                               |
| --------------------------------------------------- | ------------- | ------- | ------ | ---------------------------------- |
| `timeline.values`                                   | SCALAR        | float32 | `(F,)` | 相对参考时间的秒数                 |
| `ego_state.speed.values`                            | SCALAR        | float32 | `(F,)` | 速度标量                           |
| `ego_state.acceleration.values`                     | SCALAR        | float32 | `(F,)` | 加速度标量                         |
| `object_counts.<stream>.total.frame_indices`        | SCALAR        | uint32  | `(K,)` | 对象总数非零的帧索引               |
| `object_counts.<stream>.total.values`               | SCALAR        | uint32  | `(K,)` | 对象总数非零帧对应的对象数量       |
| `object_counts.<stream>.categories.*.frame_indices` | SCALAR        | uint32  | `(C,)` | 指定类别非零的帧索引               |
| `object_counts.<stream>.categories.*.values`        | SCALAR        | uint32  | `(C,)` | 指定类别非零帧对应的对象数量       |
| `metrics.collision.values`                          | SCALAR        | uint8   | `(F,)` | 碰撞标记，`0=false`，`1=true`      |
| `metrics.<numeric>.values`                          | SCALAR        | float32 | `(F,)` | 数值型指标，写入前保留两位有效数字 |

`F = frame_count`。`K` 和 `C` 为稀疏序列长度。对象计数中未记录的帧隐含计数为 `0`；某个类别在整个场景中从未出现时，不写入该类别字段。若某个统计项不可用，可以省略对应字段。
若提供 `aggregated_metrics.json`，转换器按场景名称读取 `detection`、`mapping`、`planning`、`collision` 等逐关键帧指标；指标数组长度必须与当前场景 message 数量一致，否则转换失败以避免帧错位。

---

## 7. messages/\*.glb

每个 message 文件包含一条 `nuviz/state_update`：

```json
{
  "type": "nuviz/state_update",
  "data": {
    "update_type": "INCREMENTAL",
    "updates": [
      {
        "timestamp": 1533151709.572,
        "poses": {
          "/ego_pose": {
            "translation": [314.267, 1231.937, 0.753],
            "rotation": [0.9999, 0.0003, 0.0016, -0.01]
          }
        },
        "primitives": {
          "/lidar": {},
          "/camera/CAM_FRONT": {},
          "/gt/objects/bounds": {},
          "/gt/objects/future_trajectories": {},
          "/gt/ego/future_trajectory": {},
          "/pred/sparsedrive/planning": {},
          "/pred/sparsedrive/objects/bounds": {},
          "/pred/sparsedrive/map/divider": {},
          "/pred/sparsedrive/map/boundary": {},
          "/pred/sparsedrive/map/ped_crossing": {}
        }
      }
    ]
  }
}
```

第 0 帧 `update_type` 为 `COMPLETE_STATE`，后续帧为 `INCREMENTAL`。

---

## 8. Primitive Payload

### 8.1 point

用于点云或点集合。

```json
{
  "points": "#/accessors/N",
  "INTENSITY": "#/accessors/N+1"
}
```

| 字段        | accessor type | dtype   | shape    | 说明         |
| ----------- | ------------- | ------- | -------- | ------------ |
| `points`    | VEC3          | float32 | `(P, 3)` | 点坐标       |
| `INTENSITY` | SCALAR        | float32 | `(P,)`   | 点强度，可选 |

### 8.2 polyline

用于轨迹、地图线、对象未来轨迹。

```json
{
  "vertices": "#/accessors/N",
  "offsets": "#/accessors/N+1",
  "count": 42
}
```

| 字段       | accessor type | dtype   | shape      | 说明               |
| ---------- | ------------- | ------- | ---------- | ------------------ |
| `vertices` | VEC3          | float32 | `(V, 3)`   | 所有折线顶点拼接   |
| `offsets`  | SCALAR        | uint32  | `(L + 1,)` | 每条折线的起止偏移 |
| `count`    | JSON int      | -       | -          | 折线数量 `L`       |

第 `i` 条折线的顶点为：

```text
vertices[offsets[i] : offsets[i + 1]]
```

对象未来轨迹可以附带 `TRACK_ID`：

```json
{
  "vertices": "#/accessors/N",
  "offsets": "#/accessors/N+1",
  "TRACK_ID": "#/accessors/N+2",
  "count": 42
}
```

| 字段       | accessor type | dtype  | shape  | 说明                  |
| ---------- | ------------- | ------ | ------ | --------------------- |
| `TRACK_ID` | SCALAR        | uint32 | `(L,)` | 每条轨迹对应的对象 ID |

### 8.3 polygon

用于地图区域或其他面状数据。

```json
{
  "vertices": "#/accessors/N",
  "offsets": "#/accessors/N+1",
  "count": 12
}
```

| 字段       | accessor type | dtype   | shape      | 说明                 |
| ---------- | ------------- | ------- | ---------- | -------------------- |
| `vertices` | VEC3          | float32 | `(V, 3)`   | 所有多边形顶点拼接   |
| `offsets`  | SCALAR        | uint32  | `(M + 1,)` | 每个多边形的起止偏移 |
| `count`    | JSON int      | -       | -          | 多边形数量 `M`       |

第 `i` 个多边形的顶点为：

```text
vertices[offsets[i] : offsets[i + 1]]
```

### 8.4 cuboid

用于 3D 目标框。

```json
{
  "CENTER": "#/accessors/N",
  "SIZE": "#/accessors/N+1",
  "ROTATION": "#/accessors/N+2",
  "CLASS_ID": "#/accessors/N+3",
  "TRACK_ID": "#/accessors/N+4",
  "SCORE": "#/accessors/N+5",
  "count": 64
}
```

| 字段       | accessor type | dtype   | shape    | 说明                             |
| ---------- | ------------- | ------- | -------- | -------------------------------- |
| `CENTER`   | VEC3          | float32 | `(B, 3)` | 框中心                           |
| `SIZE`     | VEC3          | float32 | `(B, 3)` | 框尺寸 `[width, length, height]` |
| `ROTATION` | VEC4          | float32 | `(B, 4)` | 四元数 `[w, x, y, z]`            |
| `CLASS_ID` | SCALAR        | uint32  | `(B,)`   | 类别 ID                          |
| `TRACK_ID` | SCALAR        | uint32  | `(B,)`   | 对象 ID，可选                    |
| `SCORE`    | SCALAR        | float32 | `(B,)`   | 置信度，可选                     |
| `count`    | JSON int      | -       | -        | 框数量 `B`                       |

GT 框可以省略 `SCORE`。预测框可以省略 `TRACK_ID`。

### 8.5 image

用于相机图像和栅格图。

```json
{
  "image": "#/images/N",
  "width": 1600,
  "height": 900
}
```

世界坐标栅格图包含 bounds：

```json
{
  "image": "#/images/N",
  "width": 1742,
  "height": 2263,
  "bounds": {
    "min_x": 321.3,
    "min_y": 1029.6,
    "max_x": 495.5,
    "max_y": 1255.9
  }
}
```

| 字段     | 类型   | 说明                   |
| -------- | ------ | ---------------------- |
| `image`  | string | `#/images/N`           |
| `width`  | int    | 图像宽度               |
| `height` | int    | 图像高度               |
| `bounds` | object | 世界坐标覆盖范围，可选 |

---

## 9. 具体 Stream Payload

### 9.1 `/lidar`

```json
{
  "points": "#/accessors/N",
  "INTENSITY": "#/accessors/N+1"
}
```

### 9.2 `/camera/<CHANNEL>`

```json
{
  "image": "#/images/N",
  "width": 1600,
  "height": 900
}
```

### 9.3 `/gt/objects/bounds`

```json
{
  "CENTER": "#/accessors/N",
  "SIZE": "#/accessors/N+1",
  "ROTATION": "#/accessors/N+2",
  "CLASS_ID": "#/accessors/N+3",
  "TRACK_ID": "#/accessors/N+4",
  "count": 42
}
```

### 9.4 `/gt/objects/future_trajectories`

```json
{
  "vertices": "#/accessors/N",
  "offsets": "#/accessors/N+1",
  "TRACK_ID": "#/accessors/N+2",
  "count": 42
}
```

`count` 与当前帧 `/gt/objects/bounds.count` 一致。第 `i` 条轨迹对应第 `i` 个 GT cuboid。
轨迹顶点的 `x/y` 使用对象中心，`z` 使用对象底面高度，即 `sample_annotation.translation[2] - sample_annotation.size[2] / 2`。

### 9.5 `/gt/ego/future_trajectory`

```json
{
  "vertices": "#/accessors/N",
  "offsets": "#/accessors/N+1",
  "count": 1
}
```

### 9.6 `/pred/sparsedrive/planning`

```json
{
  "vertices": "#/accessors/N",
  "offsets": "#/accessors/N+1",
  "count": 1
}
```

### 9.7 `/pred/sparsedrive/objects/bounds`

```json
{
  "CENTER": "#/accessors/N",
  "SIZE": "#/accessors/N+1",
  "ROTATION": "#/accessors/N+2",
  "CLASS_ID": "#/accessors/N+3",
  "SCORE": "#/accessors/N+4",
  "count": 128
}
```

### 9.8 `/pred/sparsedrive/map/divider`

```json
{
  "vertices": "#/accessors/N",
  "offsets": "#/accessors/N+1",
  "SCORE": "#/accessors/N+2",
  "count": 24
}
```

### 9.9 `/pred/sparsedrive/map/boundary`

```json
{
  "vertices": "#/accessors/N",
  "offsets": "#/accessors/N+1",
  "SCORE": "#/accessors/N+2",
  "count": 18
}
```

### 9.10 `/pred/sparsedrive/map/ped_crossing`

```json
{
  "vertices": "#/accessors/N",
  "offsets": "#/accessors/N+1",
  "SCORE": "#/accessors/N+2",
  "count": 8
}
```

---

## 10. 坐标系

| coordinate | 说明                 |
| ---------- | -------------------- |
| `world`    | 世界坐标系，单位米   |
| `ego`      | 自车坐标系，单位米   |
| `sensor`   | 传感器坐标系，单位米 |

`world` 坐标系采用右手系，`Z` 轴向上。四元数顺序固定为 `[w, x, y, z]`。

---

## 11. 类别 ID

### 11.1 目标类别

| ID  | 名称                 |
| --- | -------------------- |
| 0   | unknown              |
| 1   | barrier              |
| 2   | bicycle              |
| 3   | bus                  |
| 4   | car                  |
| 5   | construction_vehicle |
| 6   | motorcycle           |
| 7   | pedestrian           |
| 8   | traffic_cone         |
| 9   | trailer              |
| 10  | truck                |

### 11.2 地图类别

地图类别由 stream 名称区分：

```text
/gt/map/drivable_area
/gt/map/road_segment
/gt/map/lane
/gt/map/lane_connector
/gt/map/ped_crossing
/gt/map/walkway
/gt/map/stop_line
/gt/map/carpark_area
/pred/sparsedrive/map/divider
/pred/sparsedrive/map/boundary
/pred/sparsedrive/map/ped_crossing
```

---

## 12. 前端渲染约定

前端根据 `metadata.data.streams[streamName].type` 创建图层：

```text
pose     -> pose layer
point    -> point layer
polyline -> path layer
polygon  -> polygon layer
cuboid   -> cuboid layer
image    -> image layer
```

前端根据 stream 名称匹配样式：

```text
/gt/objects/bounds
/gt/objects/future_trajectories
/pred/sparsedrive/planning
/pred/sparsedrive/objects/bounds
/pred/sparsedrive/map/divider
```

协议数据结构中不定义样式字段。
