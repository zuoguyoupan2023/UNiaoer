#!/usr/bin/env python3
"""预处理口径扫描：找 SpeciesNet ONNX 的真实输入契约（throwaway）
每种口径 = 一个 ffmpeg 几何滤镜 + 一个数值归一化；跑同一批图，打印 top-3。
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np
import onnxruntime as ort

LAB = Path(__file__).resolve().parent
ROOT = LAB.parents[1]
MODEL = LAB / "cache/model/speciesnet-fp16.onnx"
doc = json.loads((ROOT/"public/data/model-labels-image.json").read_text())
LABELS, ENTRIES = doc["labels"], doc["entries"]
S = 480

so = ort.SessionOptions(); so.log_severity_level = 3
sess = ort.InferenceSession(str(MODEL), so, providers=["CPUExecutionProvider"])
IN, OUT = sess.get_inputs()[0].name, sess.get_outputs()[0].name

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

GEOM = {
    "letterbox": f"scale={S}:{S}:force_original_aspect_ratio=decrease,pad={S}:{S}:(ow-iw)/2:(oh-ih)/2:color=black",
    "squash":    f"scale={S}:{S}",
    "pad-white": f"scale={S}:{S}:force_original_aspect_ratio=decrease,pad={S}:{S}:(ow-iw)/2:(oh-ih)/2:color=white",
}
NUM = {
    "/255":     lambda x: x / 255.0,
    "0-255":    lambda x: x,
    "/127.5-1": lambda x: x / 127.5 - 1.0,
    "imagenet": lambda x: (x / 255.0 - MEAN) / STD,
}

def pixels(path, geom):
    buf = subprocess.run(["ffmpeg","-v","error","-i",str(path),"-vf",GEOM[geom],
                          "-f","rawvideo","-pix_fmt","rgb24","-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(buf, dtype=np.uint8).reshape(S, S, 3)

def top(path, geom, num, k=3):
    x = NUM[num](pixels(path, geom).astype(np.float32))[None]
    sc = 1/(1+np.exp(-sess.run([OUT], {IN: x})[0][0]))
    order = np.argsort(-sc)
    cands = [(sc[i], LABELS[int(i)]) for i in order[:25] if LABELS[int(i)] in ENTRIES][:k]
    return " | ".join(f"{s*100:.0f}% {ENTRIES[l]['z']}({l.split('_')[0]})" for s, l in cands)

files = sys.argv[1:]
for geom in GEOM:
    for num in NUM:
        print(f"\n=== {geom} + {num} ===")
        for f in files:
            p = Path(f)
            print(f"  真值 {p.parent.name:<22}", top(p, geom, num))