"""
将 public/data/vector-maps/{val,train}/*.json 合并、去冗余、降精度，
输出 public/data/vector-maps_val.json 和 public/data/vector-maps_train.json。

优化内容：
  1. 删除未被组件消费的字段（map_range、scene_token、coordinate_frame、
     reference_pose、range_center、range_size、split）
  2. 对 drivable_area 的重复 ring 去重
  3. 坐标截断至 1 位小数（44px glyph 的像素精度约 9m/px，0.1m 远超需要）
  4. 合并为单文件，format: { "scene-XXXX": { map_location, layers }, ... }
"""

import json
import os
import gzip
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_ROOT = os.path.join(REPO_ROOT, 'public', 'data', 'vector-maps')
OUTPUT_DIR = os.path.join(REPO_ROOT, 'public', 'data', 'vector-maps')

KEEP_FIELDS = {'map_location', 'layers'}
COORD_DECIMALS = 1


def round_coords(obj: object) -> object:
    if isinstance(obj, float):
        return round(obj, COORD_DECIMALS)
    if isinstance(obj, list):
        return [round_coords(item) for item in obj]
    if isinstance(obj, dict):
        return {k: round_coords(v) for k, v in obj.items()}
    return obj


def dedup_rings(polygons: list) -> list:
    """删除 drivable_area 内坐标完全相同的重复 polygon。"""
    seen: set[str] = set()
    result = []
    for poly in polygons:
        # 用各 ring 前3点拼接作为签名，避免全量序列化开销
        key = '|'.join(str(ring[:3]) for ring in poly['coordinates'])
        if key not in seen:
            seen.add(key)
            result.append(poly)
    return result


def slim_scene(raw: dict) -> dict:
    layers = raw['layers']
    return {
        'map_location': raw['map_location'],
        'layers': {
            'drivable_area': dedup_rings(layers['drivable_area']),
            'ped_crossing': layers['ped_crossing'],
            'divider': layers['divider'],
        },
    }


def process_split(split: str) -> dict:
    split_dir = os.path.join(INPUT_ROOT, split)
    scenes: dict[str, dict] = {}

    files = sorted(f for f in os.listdir(split_dir) if f.endswith('.json'))
    for fname in files:
        with open(os.path.join(split_dir, fname), encoding='utf-8') as f:
            raw = json.load(f)
        scene_name = fname[:-5]  # strip .json
        scenes[scene_name] = slim_scene(raw)

    return scenes


def write_output(split: str, scenes: dict) -> None:
    out_path = os.path.join(OUTPUT_DIR, f'vector_maps_{split}.json')
    payload = round_coords(scenes)
    content = json.dumps(payload, separators=(',', ':'), ensure_ascii=False)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(content)

    raw_kb = len(content) // 1024
    gz_kb = len(gzip.compress(content.encode())) // 1024
    print(f'  {out_path}')
    print(f'    {len(scenes)} scenes  |  raw {raw_kb}KB  |  gzip ~{gz_kb}KB')


def main() -> None:
    t0 = time.time()
    for split in ('val', 'train'):
        print(f'Processing {split}...')
        scenes = process_split(split)
        write_output(split, scenes)

    elapsed = time.time() - t0
    print(f'\nDone in {elapsed:.1f}s')


if __name__ == '__main__':
    main()
