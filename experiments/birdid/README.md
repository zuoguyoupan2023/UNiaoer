# BirdNET 端上识鸟 · 实验区（隔离）

> **这是实验区，不是产品代码。** 目的：在接入前端之前先验证可行性。
> 对应方案 `docs/055-方案-浏览器端识鸟与物种对表.md`，本目录是其 **P0 阶段**的落地。
> 验证结论见 **`out/DEMO.md`**（先看这个，不用看代码）。

## 目录

```
experiments/birdid/
├── label-match.mjs      # P0 核心：标签 → 项目物种 的对表命中率测量
├── infer.py             # 端上(本机)推理 + 对表 + 展示本项目素材
├── vendor/              # 第三方文件(eBird 分类代码表)
├── cache/               # 权重与标签(不入库,见下)
├── out/                 # 结果(报告入库,中间产物不入库)
└── venv/                # 隔离的 Python 环境(不入库)
```

## 结果文件

| 文件 | 内容 |
|---|---|
| **`out/DEMO.md`** | ⭐ **人读报告**：对表命中率、两个音频实测、准确率评估。**先看这个** |
| `out/report.txt` | 最近一次推理的文本输出 |
| `out/label-match-report.json` | 6,522 个标签的完整匹配明细 |
| `out/infer-results.json` | 最近一次推理的 top-5 + 准确性核对 |

## 怎么跑

### 1. 对表命中率（P0 的核心，不需要模型）

```bash
node experiments/birdid/label-match.mjs
```

输出分级命中率（T1 学名 / T2 英文名 / T4 仅属名 / T5 未命中），
并生成 `out/label-match-report.json`。

### 2. 音频推理实测

```bash
# 准备（仅需一次）
python3 -m venv --system-site-packages experiments/birdid/venv
experiments/birdid/venv/bin/pip install ai-edge-litert

# 跑单个文件，或整个物种目录
experiments/birdid/venv/bin/python experiments/birdid/infer.py \
  public/media/cettia-cetti/audio-2.mp3
```

推理会自动拿该音频在项目里所属的物种作真值，核对模型把它排到第几位。

## 权重从哪来

BirdNET+ 2.4 FP16，来自 **Zenodo 记录 15050749**（CC BY-NC 4.0）：

```
https://zenodo.org/api/records/15050749/files/BirdNET_v2.4_tflite_fp16.zip/content
```

> ⚠️ **中国网络下不要用单流下载**：实测只有 12–22 KB/s 且会断线（50MB 要 70 分钟）。
> Zenodo 支持 Range，**必须 16 线程分块并发**，实测 ≈185 KB/s、313 秒完成。
> 解压后需要 `audio-model-fp16.tflite`（25MB）与 `labels/en_us.txt`（6,522 行）。

## 两条踩过的坑

1. **`tflite2onnx` 转不了这个模型** —— 图里有 `REDUCE_MIN` 算子（频谱前端），
   转换直接报 `NotImplementedError`。别在 ONNX 路线上浪费时间，
   用 `ai-edge-litert` 直接跑 TFLite 即可。
2. **打印会被吞** —— `ai_edge_litert` 初始化时的 `INFO:` 日志会抢 stdout，
   导致 `print` 的内容丢失。`infer.py` 用 `OUT_LINES` 累积 + `flush()` 统一输出，
   同时落盘到 `out/report.txt`。

## 不入库的东西

`.gitignore` 已排除 `cache/`、`venv/`、`out/*.json`（约 150MB 的权重与环境）。
`out/DEMO.md` 是结论，**入库**。