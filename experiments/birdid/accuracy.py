#!/usr/bin/env python3
"""
[实验] 批量准确率评估 —— 扩大样本,回答「模型到底准不准」

    venv/bin/python experiments/birdid/accuracy.py --n 60          # 分层抽样 60 个种
    venv/bin/python experiments/birdid/accuracy.py --inat --n 40   # 只测 iNaturalist 源(跨录音池)
    venv/bin/python experiments/birdid/accuracy.py --n 60 --workers 6

样本来自**我们自己的 R2**(公开、带真值、数量大),而不是本地暂存区 ——
后者只到采集的当前进度,且偏字母序前段,会低估/高估模型。

真值 = 该音频在台账里所属的 speciesId。音频从 R2 现取,不落大文件到磁盘
(用完即删),避免和 053 采集抢磁盘。
"""

import argparse
import json
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter

LAB = Path(__file__).resolve().parent
ROOT = LAB.parents[1]
CACHE = LAB / "cache/tmp"
MODEL = LAB / "cache/model/audio-model-fp16.tflite"
REPORT = json.loads((LAB / "out/label-match-report.json").read_text())

# TFLite 解释器不是线程安全的,每个 worker 一个实例
_tls = __import__("threading").local()


def get_interp():
    it = getattr(_tls, "it", None)
    if it is None:
        it = Interpreter(model_path=str(MODEL))
        it.allocate_tensors()
        _tls.it = it
    return it


def decode_48k(path):
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", "48000", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def pick_windows(sig, win=144000, hop=72000, cap=12):
    """50% 重叠滑窗,但最多取 cap 个(长录音均匀采样,避免 69s 的文件跑 45 遍)"""
    n = (len(sig) - win) // hop + 1 if len(sig) > win else 1
    if n <= cap:
        idx = list(range(n))
    else:
        idx = np.linspace(0, n - 1, cap).round().astype(int).tolist()
    return [sig[i * hop:i * hop + win] for i in idx], n


def fetch(url):
    CACHE.mkdir(parents=True, exist_ok=True)
    suffix = ".wav" if url.endswith(".wav") else (".m4a" if url.endswith(".m4a") else ".mp3")
    p = CACHE / f"{abs(hash(url))}{suffix}"
    if not p.exists() or p.stat().st_size == 0:
        r = subprocess.run(["curl", "-sL", "--max-time", "90", "-o", str(p), url], capture_output=True)
        if r.returncode != 0 or not p.exists() or p.stat().st_size < 1024:
            p.unlink(missing_ok=True)
            return None
    return p


def eval_one(item):
    sid, url, zh, en, commonness = item
    p = fetch(url)
    if p is None:
        return None
    try:
        sig = decode_48k(p)
        dur = len(sig) / 48000
        wins, nwin = pick_windows(sig)
        it = get_interp()
        inp = it.get_input_details()[0]
        out = it.get_output_details()[0]
        sc = []
        for w in wins:
            buf = np.zeros(inp["shape"], dtype=np.float32)
            m = min(len(w), buf.shape[1])
            buf[0, :m] = w[:m]
            it.set_tensor(inp["index"], buf)
            it.invoke()
            sc.append(sigmoid(it.get_tensor(out["index"])[0]))
        s = np.median(np.stack(sc), axis=0)
        top = np.argsort(-s)[:5]
        pred = []
        for i in top:
            r = REPORT["rows"][i]
            pred.append({"label": r["label"], "conf": round(float(s[i] * 100), 2),
                         "speciesId": r["speciesId"], "tier": r["tier"]})
        rank = next((i + 1 for i, r in enumerate(pred) if r["speciesId"] == sid), None)
        # 属级也算部分命中:同属不同种,说明方向对
        truth_sci = SPECIES_SCI.get(sid, "")
        truth_genus = truth_sci.split(" ")[0].lower()
        genus_only = None
        if rank is None and truth_genus:
            gi = next((i + 1 for i, t in enumerate(np.argsort(-s)[:50])
                       if truth_genus in str(REPORT["rows"][t]["label"]).lower()), None)
            genus_only = gi
        return {"sid": sid, "zh": zh, "en": en, "commonness": commonness,
                "dur": round(dur, 1), "windows": len(wins), "totalWindows": nwin,
                "rank": rank, "genusRank": genus_only, "top1": pred[0]["label"],
                "top1conf": pred[0]["conf"], "pred": pred[:3]}
    except Exception as e:
        return {"sid": sid, "error": str(e)[:80]}
    finally:
        if p:
            p.unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--inat", action="store_true", help="只测 iNaturalist 源")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()

    led = json.loads((ROOT / "data-cache/manifest-global.json").read_text())
    sp = led["species"] if isinstance(led["species"], list) else list(led["species"].values())
    idx = json.loads((ROOT / "public/data/species-index.json").read_text())["species"]
    meta = {x["nameSci"]: x for x in idx}
    global SPECIES_SCI
    SPECIES_SCI = {s["id"]: s.get("nameSci", "") for s in sp}
    TAXON2SPID = {s["taxonKey"]: s["id"] for s in sp if s.get("taxonKey")}

    items = []
    for s in sp:
        for au in (s.get("audios") or []):
            u, o = au.get("url") or "", au.get("originalUrl") or ""
            if not u.startswith("http"):
                continue
            if a.inat and "inaturalist" not in o:
                continue
            m = meta.get(s.get("nameSci"), {})
            items.append((s["id"], u, s.get("nameZh"), s.get("nameEn"), m.get("commonness", 0)))

    if a.inat:
        # iNat 源只有约 136 条,按种去重后全测
        seen, sub = set(), []
        for it in items:
            if it[0] in seen:
                continue
            seen.add(it[0])
            sub.append(it)
        items = sub
    else:
        # 分层:按 commonness 各档均匀抽,避免偏向采集进度
        by = {}
        for it in items:
            by.setdefault(it[4], []).append(it)
        per = max(1, a.n // max(len(by), 1))
        sub = []
        for c in sorted(by, reverse=True):
            lst = by[c]
            step = max(1, len(lst) // per)
            sub += lst[::step][:per]
        items = sub[: a.n]

    print(f"\n{'='*76}\n  批量准确率评估 · 样本 {len(items)} 条 · 来源:{'iNaturalist 源(跨录音池)' if a.inat else 'R2 自有(分层抽样)'}\n{'='*76}\n", flush=True)
    results = []
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for i, r in enumerate(ex.map(eval_one, items), 1):
            if r:
                results.append(r)
            if i % 10 == 0 or i == len(items):
                h3 = sum(1 for x in results if x.get("rank") and x["rank"] <= 3)
                h1 = sum(1 for x in results if x.get("rank") == 1)
                print(f"  … {i}/{len(items)}  当前 top-1 {h1} · top-3 {h3}", flush=True)

    ok = [r for r in results if not r.get("error")]
    h1 = sum(1 for r in ok if r.get("rank") == 1)
    h3 = sum(1 for r in ok if r.get("rank") and r["rank"] <= 3)
    h5 = sum(1 for r in ok if r.get("rank"))
    gen = sum(1 for r in ok if not r.get("rank") and r.get("genusRank"))

    print(f"\n{'='*76}")
    print(f"  结果:有效 {len(ok)} 条")
    print(f"    top-1 命中   {h1:>3}  ({h1/max(len(ok),1)*100:5.1f}%)")
    print(f"    top-3 命中   {h3:>3}  ({h3/max(len(ok),1)*100:5.1f}%)")
    print(f"    top-5 命中   {h5:>3}  ({h5/max(len(ok),1)*100:5.1f}%)")
    print(f"    仅属级命中   {gen:>3}  ({gen/max(len(ok),1)*100:5.1f}%)  认错种但对到属")
    print(f"{'='*76}\n")

    by_c = {}
    for r in ok:
        c = r.get("commonness", 0)
        d = by_c.setdefault(c, [0, 0, 0])
        d[0] += 1
        if r.get("rank") == 1:
            d[1] += 1
        if r.get("rank") and r["rank"] <= 3:
            d[2] += 1
    print("  按常见度分层(commonness 越高=越常见):")
    print(f"    {'档':<6}{'样本':<7}{'top-1':<10}{'top-3'}")
    for c in sorted(by_c, reverse=True):
        n, t1, t3 = by_c[c]
        print(f"    {c:<6}{n:<7}{t1/max(n,1)*100:>5.0f}%    {t3/max(n,1)*100:>5.0f}%")

    conf_hit = [(r["top1conf"], 1) for r in ok if r.get("rank") == 1]
    conf_miss = [(r["top1conf"], 0) for r in ok if r.get("rank") != 1]
    if conf_hit and conf_miss:
        import statistics
        print(f"\n  top-1 置信度:命中时中位 {statistics.median(c for c,_ in conf_hit):.1f}% /"
              f" 未命中时中位 {statistics.median(c for c,_ in conf_miss):.1f}%")
        for th in (10, 30, 50, 70):
            sel = [r for r in ok if r["top1conf"] >= th]
            if sel:
                acc = sum(1 for r in sel if r.get("rank") and r["rank"] <= 3) / len(sel)
                print(f"    仅保留 top1≥{th:>2}% 的结果:覆盖 {len(sel):>3}/{len(ok)},其中 top-3 准确率 {acc*100:5.1f}%")

    out = LAB / ("out/accuracy-inat.json" if a.inat else "out/accuracy.json")
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(f"\n  明细: {out.relative_to(ROOT)}\n")


if __name__ == "__main__":
    main()