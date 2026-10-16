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
    idx = json.loads((ROOT/"public/data/species-index.json").read_text())["species"]
    led = json.loads((ROOT/"data-cache/manifest-global.json").read_text())
    sp = led["species"] if isinstance(led["species"], list) else list(led["species"].values())
    bySci = {s["nameSci"].lower().replace(" ",""): s for s in idx if s.get("nameSci")}
    byEn  = {s["nameEn"].lower(): s for s in idx if s.get("nameEn")}
    sid2sp = {s["id"]: s for s in sp}
    sid2sci = {}
    for s2 in sp:
        if s2.get("nameSci"):
            t = next((x for x in idx if x.get("taxonKey")==s2.get("taxonKey")), None)
            if t: sid2sci[t["nameSci"].lower().replace(" ","")] = dict(t, images=s2.get("images"), audios=s2.get("audios"))

    hits=0; tot=0
    args=[]
    for a in sys.argv[1:]:
        args += open(a).read().split() if a.endswith('.txt') else [a]
    for arg in args:
        p = Path(arg); sid = p.parent.name
        truth = sid2sp.get(sid) or sid2sci.get(sid) or {}
        if not truth:
            print(f"  (跳过 {sid}:台账里还没有该种,053 未采到)")
            continue
        try:
            sc,_ = infer(p)
        except Exception as e:
            print(f"  (跳过 {sid}:无法解码 {type(e).__name__})")
            continue
        order = np.argsort(-sc)[:3]
        print(f"\n  {sid}/{p.name}   真值: {truth.get('nameZh') or '?'} ({truth.get('nameSci')})")
        rank=None
        for r,i in enumerate(order,1):
            lab=LABELS[int(i)]
            m=bySci.get(lab["sci"].lower().replace(" ","")) or byEn.get(lab["en"].lower())
            tag = "✓命中" if (m and m.get("taxonKey")==truth.get("taxonKey")) else ("✓" if m else "✗对不上")
            print(f"   {tag} [{r}] {sc[i]*100:5.1f}%  {lab['cls']:<12}{lab['sci'][:34]:<36}{lab['en'][:30]}")
            if m and m.get("taxonKey")==truth.get("taxonKey"): rank=r
        tot+=1
        if rank and rank<=3: hits+=1

        if truth.get("images"):
            print(f"       该种本项目素材:图 {len(truth['images'])} 张 / 音 {len(truth['audios'] or [])} 段")
    if tot: print(f"\n  样本 {tot} · top-3 命中真值 {hits} ({hits/tot*100:.0f}%)")

main()
