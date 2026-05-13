"""
从原始数据生成两个轻量级 JSON 供浏览器加载：

  public/data/projection-map/glyph_ranges.json
    { "scene-XXXX": { "range_center": [cx, cy], "range_size": [w, h] }, ... }
    来源：public/data/vector-maps/{train,val}/*.json

  public/data/projection-map/ego_trajectories_slim.json
    { "scene-XXXX": { "yaw0": float, "trajectory": [[x, y], ...] }, ... }
    来源：public/data/projection-map/ego_trajectories_trainval.json

坐标精度：range_center/range_size 保留 4 位小数，轨迹坐标保留 3 位小数。
"""

import json
import math
import os
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VECTOR_MAPS_ROOT = os.path.join(REPO_ROOT, 'public', 'data', 'vector-maps')
EGO_TRAJ_PATH = os.path.join(REPO_ROOT, 'public', 'data', 'projection-map', 'ego_trajectories_trainval.json')
OUT_DIR = os.path.join(REPO_ROOT, 'public', 'data', 'projection-map')


def build_glyph_ranges() -> dict:
    ranges: dict = {}
    for split in ('train', 'val'):
        split_dir = os.path.join(VECTOR_MAPS_ROOT, split)
        for fname in sorted(os.listdir(split_dir)):
            if not fname.endswith('.json'):
                continue
            with open(os.path.join(split_dir, fname), encoding='utf-8') as f:
                raw = json.load(f)
            scene_name = fname[:-5]
            rc = raw['range_center']
            rs = raw['range_size']
            ranges[scene_name] = {
                'range_center': [round(rc[0], 4), round(rc[1], 4)],
                'range_size':   [round(rs[0], 4), round(rs[1], 4)],
            }
    return ranges


def build_slim_trajectories() -> dict:
    with open(EGO_TRAJ_PATH, encoding='utf-8') as f:
        raw = json.load(f)

    slim: dict = {}
    for scene in raw['scenes']:
        name = scene['scene_name']
        yaw0 = scene['poses'][0]['yaw']

        # Keep only x,y; drop z
        trajectory = [[round(pt[0], 3), round(pt[1], 3)] for pt in scene['trajectory']]

        slim[name] = {
            'yaw0': round(yaw0, 6),
            'trajectory': trajectory,
        }
    return slim


def write_json(path: str, data: dict) -> None:
    content = json.dumps(data, separators=(',', ':'), ensure_ascii=False)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    kb = len(content) // 1024
    print(f'  {os.path.relpath(path, REPO_ROOT)}  ({len(data)} scenes, {kb} KB)')


def main() -> None:
    t0 = time.time()

    print('Building glyph_ranges.json...')
    ranges = build_glyph_ranges()
    write_json(os.path.join(OUT_DIR, 'glyph_ranges.json'), ranges)

    print('Building ego_trajectories_slim.json...')
    slim = build_slim_trajectories()
    write_json(os.path.join(OUT_DIR, 'ego_trajectories_slim.json'), slim)

    print(f'\nDone in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
