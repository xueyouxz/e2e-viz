# E2E Viz

[English](README.md) | [简体中文](README.zh-CN.md)

E2E Viz 是一个面向自动驾驶数据集和端到端模型输出的浏览器可视化工具。它将场景投影地图与同步的 3D 场景查看器结合，帮助研究人员和开发者查找代表性场景，并逐帧检查感知、预测和规划结果。

## 主要功能

- 在二维投影地图中浏览 nuScenes 训练集和验证集场景。
- 按条件筛选、搜索和定位场景，并通过套索批量选择。
- 在 3D 视图中检查点云、矢量地图、目标、轨迹和自车运动。
- 对比 SparseDrive 预测结果与 nuScenes 真值。
- 查看六路相机画面、播放状态、场景统计和模型指标。

## 快速开始

需要 Node.js 20.19 或更高版本，以及 pnpm 9 或更高版本。

```bash
git clone https://github.com/xueyouxz/e2e-viz.git
cd e2e-viz
pnpm install
pnpm dev
```

将运行数据准备到 `public/data/` 后，访问 <http://localhost:3001>。

场景查看器使用 [`docs/NUSVIZ.md`](docs/NUSVIZ.md) 中定义的 NUSVIZ 流式数据格式。仓库不包含 nuScenes 数据、SparseDrive 模型权重或生成的预测结果，这些资源需要单独获取，并遵循各自的使用条款。

## 开发

提交修改前请运行完整检查：

```bash
pnpm check
```

## 参考项目

- [SparseDrive 仓库](https://github.com/swc-17/SparseDrive)
- [nuScenes 官网](https://www.nuscenes.org/)

E2E Viz 是独立项目，与 SparseDrive 和 nuScenes 的维护方不存在隶属或官方认可关系。

## 开源协议

本仓库源代码遵循 [MIT License](LICENSE)。第三方数据集、模型和生成内容仍遵循各自的许可证及使用条款。
