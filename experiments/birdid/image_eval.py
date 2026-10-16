#!/usr/bin/env python3
"""SpeciesNet 图像识别本地验证（带真值核对）"""
import json, subprocess, sys, urllib.request
from pathlib import Path
import numpy as np
import onnxruntime as ort

LAB = Path(__file__).resolve().parent
ROOT = LAB.parents[1]
MODEL = LAB / "cache/model/speciesnet-fp16.onnx"
RAW = (LAB / "cache/model/speciesnet-labels.txt").read_text().split("\n")
SIZE = 480

# 解析 `uuid;class;order;family;genus;species;common`
LABELS = []
for L in RAW:
    p = L.split(";")
    if len(p) < 7:
        LABELS.append({"sci": "", "en": "", "cls": "", "fam": ""})
    else:
        LABELS.append({"sci": f"{p[4]} {p[5]}".strip(), "en": p[6].strip(),
                       "cls": p[1], "fam": p[3], "genus": p[4]})

so = ort.SessionOptions(); so.log_severity_level = 3
sess = ort.InferenceSession(str(MODEL), so, providers=["CPUExecutionProvider"])
IN, OUT = sess.get_inputs()[0].name, sess.get_outputs()[0].name

def prep(path):
    """等比缩放 + 居中留边 → 480x480x3, /255 归一化(SpeciesNet 用 0~1)"""
    p = subprocess.run(["ffmpeg","-v","error","-i",str(path),"-vf",
        f"scale={SIZE}:{SIZE}:force_original_aspect_ratio=decrease,pad={SIZE}:{SIZE}:(ow-iw)/2:(oh-ih)/2:color=black",
        "-f","rawvideo","-pix_fmt","rgb24","-"],capture_output=True,check=True).stdout
    a = np.frombuffer(p,dtype=np.uint8).reshape(1,SIZE,SIZE,3).astype(np.float32)/255.0
    return a

def infer(path):
    x = prep(path)
    out = sess.run([OUT],{IN:x})[0][0]
    return 1/(1+np.exp(-out)), float(x.max())

def main():
    # 真值：manifest-meta 是权威名录产物（台账只含已采到素材的种，会误报"跳过"）
    meta = json.loads((ROOT/"public/data/manifest-meta.json").read_text())["species"]
    byId = {s["id"]: s for s in meta if s.get("id")}
    # 对表：与线上运行时同一条路径 —— labels[i] 取标签 → entries 映射 → 剔掉无映射
    doc = json.loads((ROOT/"public/data/model-labels-image.json").read_text())
    LABELS, ENTRIES = doc["labels"], doc["entries"]

    hits1 = hits3 = tot = 0
    args = []
    for a in sys.argv[1:]:
        args += open(a).read().split() if a.endswith('.txt') else [a]
    for arg in args:
        p = Path(arg); sid = p.parent.name
        truth = byId.get(sid)
        if not truth:
            print(f"  (跳过 {sid}:不在 manifest-meta 名录里)")
            continue
        try:
            sc,_ = infer(p)
        except Exception as e:
            print(f"  (跳过 {sid}:无法解码 {type(e).__name__})")
            continue
        order = np.argsort(-sc)
        # 运行时：下标 → 标签 → 有映射才保留（'bird' 这类无映射标签恒占 top-1，必须剔）
        cands = [(i, sc[i], LABELS[int(i)]) for i in order[:12]
                 if LABELS[int(i)] in ENTRIES][:3]
        print(f"\n  {sid}/{p.name}   真值: {truth.get('nameZh')} ({truth.get('nameSci')})")
        rank = None
        for r,(i,s,lab) in enumerate(cands,1):
            e = ENTRIES[lab]; mapped = e.get("s")
            ok = mapped == sid
            if ok: rank = r
            print(f"   {'✓命中' if ok else ('·已对上' if mapped else '✗无素材')} [{r}] {s*100:5.1f}%  "
                  f"{(e.get('z') or '—'):<12}{lab[:44]}" + (f"  → {mapped}" if mapped else ""))
        if not cands:
            print("   （种级候选为空：top-12 全是「bird」这类无映射标签）")
        tot += 1
        hits1 += 1 if rank == 1 else 0
        hits3 += 1 if rank and rank <= 3 else 0
        m = truth.get("playableImage"), truth.get("playableAudio")
        print(f"       本项目素材:图 {'有' if m[0] else '无'} / 音 {'有' if m[1] else '无'}")
    if tot: print(f"\n  样本 {tot} · top-1 命中 {hits1} ({hits1/tot*100:.0f}%) · top-3 命中 {hits3} ({hits3/tot*100:.0f}%)")

main()
