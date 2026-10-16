#!/usr/bin/env python3
"""ONNX 版 BirdNET 2.4 本地验证 —— 验证浏览器方案(A 路线)的可行性 + 量化精度"""
import json, subprocess, sys
from pathlib import Path
import numpy as np
import onnxruntime as ort

LAB = Path(__file__).resolve().parent
ROOT = LAB.parents[1]
MODEL = LAB / "cache/model/birdnet24_int8_arm.onnx"
LABELS = (LAB / "cache/model/labels_birdnet24.txt").read_text().split("\n")
REPORT = json.loads((LAB / "out/label-match-report.json").read_text())

so = ort.SessionOptions(); so.log_severity_level = 3
sess = ort.InferenceSession(str(MODEL), so, providers=["CPUExecutionProvider"])
IN, OUT = sess.get_inputs()[0].name, sess.get_outputs()[0].name

def decode(p):
    o = subprocess.run(["ffmpeg","-v","error","-i",str(p),"-f","f32le","-ac","1","-ar","48000","-"],
                       capture_output=True, check=True).stdout
    return np.frombuffer(o, dtype=np.float32).copy()

def infer(path):
    sig = decode(path)
    win, hop, cap = 144000, 72000, 12
    n = (len(sig)-win)//hop + 1 if len(sig) > win else 1
    idx = list(range(n)) if n <= cap else [round(i*(n-1)/(cap-1)) for i in range(cap)]
    xs = np.zeros((len(idx), win), dtype=np.float32)
    for j,i in enumerate(idx):
        s = i*hop; a = min(win, max(0, len(sig)-s))
        if a>0: xs[j,:a] = sig[s:s+a]
    out = sess.run([OUT], {IN: xs})[0]      # 一次跑完所有窗口（ONNX 支持 batch）
    return 1/(1+np.exp(-np.median(out, axis=0))), len(sig)/48000, len(idx)

def species_media(sid):
    led = json.loads((ROOT/"data-cache/manifest-global.json").read_text())
    sp = led["species"] if isinstance(led["species"], list) else list(led["species"].values())
    for s in sp:
        if s.get("id") == sid:
            return len(s.get("images") or []), len(s.get("audios") or [])
    return None

tests = sys.argv[1:]
print("="*72); print("  BirdNET 2.4 ONNX(int8_arm) 本地验证"); print("="*72)
for t in tests:
    p = Path(t); sid = p.parent.name
    sc, dur, nw = infer(p)
    order = np.argsort(-sc)[:3]
    print(f"\n  {sid}/{p.name}   {dur:.1f}s · {nw} 窗(批量一次推理)")
    for r,i in enumerate(order,1):
        row = REPORT["rows"][i]
        zh = row.get("nameZh") or ""
        hit = "✓" if row.get("speciesId") == sid else " "
        print(f"   {hit} [{r}] {sc[i]*100:5.1f}%  {LABELS[i][:44]:<46}{zh}")
    r1 = REPORT["rows"][order[0]]
    m = species_media(r1["speciesId"]) if r1.get("speciesId") else None
    if m: print(f"       本项目素材:图 {m[0]} 张 / 音 {m[1]} 段")
