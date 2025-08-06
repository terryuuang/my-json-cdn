#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
from pathlib import Path

def list_layers(path: str | Path) -> list[str]:
    """讀取 GeoJSON，回傳去重後的 layer 名稱清單（排序過）。"""
    path = Path(path)
    with path.open("r", encoding="utf-8") as f:
        geo = json.load(f)

    # 取出每個 feature 的 properties["layer"]，若缺省就跳過
    layers = {
        feature.get("properties", {}).get("layer")
        for feature in geo.get("features", [])
        if feature.get("properties", {}).get("layer") is not None
    }

    return sorted(layers)

if __name__ == "__main__":
    filename = "joseph_w-20250806.geojson"        # ← 這裡換成你的檔名
    for layer in list_layers(filename):
        print(layer)
