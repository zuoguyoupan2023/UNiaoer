#!/usr/bin/env python3
"""
[实验/P0] BirdNET 2.4 端上(本机)推理 + 对表 + 展示本项目已有素材

用法:
    venv/bin/python experiments/birdid/infer.py <音频文件> [更多文件...]
    venv/bin/python experiments/birdid/infer.py --dir public/media/某物种   # 该物种全部音频

模型契约(实测,非猜测):
    输入 INPUT   : (1, 144000) float32  = 48kHz × 3 秒
    输出 Identity: (1, 6522)    float32  = 6,522 类

流程:ffmpeg 解码并重采样到 48kHz → 逐 3 秒窗口滑过 → 对每个窗口推理
     → 全局取 top-5 → 查对表拿本项目 speciesId → 输出该种已有素材。
做多窗口是因为单条 XC 录音可能超过 3 秒,而 3 秒内不一定有完整鸣唱。
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter

ROOT = Path(__file__).resolve().parents[2]
LAB = Path(__file__).resolve().parent
MODEL = LAB / "cache/model/audio-model-fp16.tflite"
LABELS = (LAB / "cache/model/labels/en_us.txt").read_text().split("\n")
REPORT = json.loads((LAB / "out/label-match-report.json").read_text())
IDX = json.loads((ROOT / "public/data/species-index.json").read_text())["species"]
LEDGER = json.loads((ROOT / "data-cache/manifest-global.json").read_text())
LEDGER_SP = {s["id"]: s for s in (LEDGER["species"] if isinstance(LEDGER["species"], list) else LEDGER["species"].values())}
BY_TAXON = {x["taxonKey"]: x for x in IDX}
BY_TAXON_SP = {v["id"]: v for v in LEDGER_SP.values() if v.get("taxonKey")}

# BirdNET 2.4 输出是 logits(非概率),需自己过 sigmoid
def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


_interp = None


def get_interp():
    global _interp
    if _interp is None:
        _interp = Interpreter(model_path=str(MODEL))
        _interp.allocate_tensors()
    return _interp


def decode_48k(path: Path) -> np.ndarray:
    """ffmpeg 解码任意音频 → 48kHz 单声道 float32"""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", "48000", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def windows(sig: np.ndarray, win=144000, hop=72000):
    """滑窗:50% 重叠"""
    if len(sig) <= win:
        return [sig]
    return [sig[i:i + win] for i in range(0, len(sig) - win + 1, hop)] or [sig[:win]]


def infer(path: Path):
    sig = decode_48k(path)
    it = get_interp()
    inp = it.get_input_details()[0]
    out = it.get_output_details()[0]
    wins = windows(sig)
    scores = []
    for w in wins:
        buf = np.zeros(inp["shape"], dtype=np.float32)
        n = min(len(w), buf.shape[1])
        buf[0, :n] = w[:n]
        it.set_tensor(inp["index"], buf)
        it.invoke()
        s = sigmoid(it.get_tensor(out["index"])[0])
        scores.append(s)
    # 多窗口取每个类别的中位数,比取均值更抗单窗噪声
    return np.median(np.stack(scores), axis=0), len(sig) / 48000.0, len(wins)


def species_media(species_id):
    sp = LEDGER_SP.get(species_id)
    if not sp:
        return None
    imgs = sp.get("images") or []
    auds = sp.get("audios") or []
    return {
        "nameZh": sp.get("nameZh"), "nameEn": sp.get("nameEn"), "nameSci": sp.get("nameSci"),
        "images": len(imgs), "audios": len(auds),
        "imgUrl": (imgs[0].get("thumbUrl") or imgs[0].get("url")) if imgs else None,
        "audUrl": auds[0].get("url") if auds else None,
        "imgLicense": (imgs[0].get("license"), imgs[0].get("author")) if imgs else None,
    }


OUT_LINES = []


def _p(msg=""):
    OUT_LINES.append(msg)


def flush():
    sys.stdout.write("\n".join(OUT_LINES) + "\n")
    sys.stdout.flush()


def report_for(path: Path, truth: str | None = None):
    """truth = 该音频在项目里的真实 speciesId(用来诚实评估准不准)"""
    scores, dur, nw = infer(path)
    top = np.argsort(-scores)[:5]
    L = OUT_LINES
    L.append("")
    L.append("=" * 74)
    L.append(f"  音频: {path.parent.name}/{path.name}   时长 {dur:.1f}s   滑窗 {nw} 个")
    L.append("=" * 74)
    L.append("")
    L.append("  BirdNET 2.4 识别结果 top-5")
    L.append("")
    L.append(f"  {'排名':<5}{'置信度':<10}{'模型认出的鸟':<42}{'→ 本项目里的对应种'}")
    L.append("  " + "-" * 70)
    rows = []
    for rank, i in enumerate(top, 1):
        row = REPORT["rows"][i]
        label = row["label"]
        spid = row["speciesId"] if row["tier"] in (1, 2, 3) else None
        meta = BY_TAXON.get(row["taxonKey"], {})
        zh = meta.get("nameZh")
        if spid:
            mapping = f"✓ {zh or meta.get('nameEn') or '(无中文名)'}"
        elif row["tier"] in (1, 2, 3):
            # 标签对得上物种索引,但该种还没进入可播放台账(053 尚未采到素材)
            mapping = f"○ 已对上 {zh or meta.get('nameEn') or '(无中文名)'},但本项目暂无可展示素材"
        elif row["tier"] == 4:
            mapping = f"~ 只能确定到属:{row['genus']}"
        else:
            mapping = "✗ 不在项目物种名录内(实测多为蛙/虫/猴等非鸟)"
        pctv = scores[i] * 100
        L.append(f"  {rank:<5}{pctv:>6.1f}%   {label[:40]:<42}{mapping}")
        rows.append({"rank": rank, "label": label, "conf": round(float(pctv), 2),
                     "tier": row["tier"], "speciesId": spid, "taxonKey": row["taxonKey"],
                     "nameZh": (BY_TAXON.get(row["taxonKey"], {}) or {}).get("nameZh")})

    # 诚实评估:模型是否把「项目里这条音频真正所属的种」排进了 top-3
    hit_rank = None
    if truth:
        for r in rows:
            if r["speciesId"] == truth:
                hit_rank = r["rank"]
                break
        t = BY_TAXON_SP.get(truth, {})
        L.append("")
        L.append(f"  ── 准确性核对 ──")
        L.append(f"      这条音频在项目里属于:{t.get('nameZh')}({truth})")
        L.append(f"      模型把它排到第 {hit_rank if hit_rank else 'top-5 之外'}位" +
                 ("  ✓ 命中" if hit_rank and hit_rank <= 3 else "  ✗ 未进前三"))

    L.append("")
    L.append("  ── 本项目里这些物种的已有素材 ──")
    shown = 0
    for r in rows[:3]:
        if not r["speciesId"]:
            continue
        m = species_media(r["speciesId"])
        if not m:
            continue
        shown += 1
        L.append("")
        L.append(f"    [{r['rank']}] {m['nameZh'] or '(无中文名)'}  {m['nameEn']}")
        L.append(f"        学名 {m['nameSci']}")
        L.append(f"        项目素材:图 {m['images']} 张 / 音 {m['audios']} 段")
        if m["imgUrl"]:
            L.append(f"        首图 {m['imgUrl']}")
        if m["imgLicense"]:
            L.append(f"        署名 {m['imgLicense'][1]} / {m['imgLicense'][0]}")
    if not shown:
        L.append("    (top-3 命中的物种在本项目暂无可展示素材)")
    return {"file": path.name, "dir": path.parent.name, "durationSec": round(dur, 1),
            "windows": nw, "truth": truth, "hitRank": hit_rank, "top5": rows}


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    files = []
    for a in args:
        p = Path(a)
        if p.is_dir():
            files += sorted(q for q in p.iterdir() if q.name.startswith("audio-"))
        elif p.is_file():
            files.append(p)
    # truth 要按文件各自所属的物种取 —— 每个文件来自不同物种目录
    results = [report_for(f, LEDGER_SP.get(f.parent.name, {}).get("id")) for f in files]
    out = LAB / "out/infer-results.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    _p(f"\n  结果已存: {out.relative_to(ROOT)}\n")
    flush()
    (LAB / "out/report.txt").write_text("\n".join(OUT_LINES))


if __name__ == "__main__":
    main()