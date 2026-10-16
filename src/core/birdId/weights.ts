/**
 * 模型权重与标签的下载地址
 *
 * ## 为什么放**独立桶**（M2 决策）
 *
 * 与媒体桶分开，避免混淆：媒体桶只有 `media/` 与 `data/`，是「用户要看的图与音」；
 * 模型桶只有 `models/`，是「用户设备要跑的代码」。两者的生命周期、体量、
 * 更新节奏完全不同 —— 模型是几十 MB 的二进制且随算法版本变，媒体是百万级小文件。
 * 分开也便于将来给模型桶单独设生命周期规则而不误伤媒体。
 *
 * ## 为什么必须走并行分块下载（M3 决策）
 *
 * 中国网络实测（docs/056 §4）：从本项目的 R2 单流约 3.86 MB/s，
 * 44MB 约 12 秒；8 连接合计可达 28.45 MB/s，分块后约 4~6 秒。
 * 源站（Zenodo）只有 86 KB/s —— 比我们自己的 R2 慢 45 倍，所以**必须自托管**。
 */

/** 独立模型桶基址；VITE_BIRDID_MODEL_BASE 可覆盖(本地/staging)，留空=同源 /models/ */
const MODEL_BASE = import.meta.env.VITE_BIRDID_MODEL_BASE ?? 'https://models.bird.wewalk.world'

export interface ModelRef {
  key: TaskName
  /** 权重文件名（桶内 models/ 之下） */
  file: string
  /** 标签文件名 */
  labels: string
  /** UI 展示的体积（MB），用于首次下载前的提示 */
  sizeMB: number
  label: string
}

export type TaskName = 'audio' | 'image'

/**
 * 模型清单。改版本时只改这里 + 重新上传 + 重建对表产物。
 * `cacheName` 带版本号：换模型必须换缓存名，否则老用户会拿旧权重。
 */
export const MODELS: Record<TaskName, ModelRef> = {
  audio: {
    key: 'audio',
    file: 'birdnet-v2.4-int8-arm.onnx',
    labels: 'birdnet-v2.4-labels.txt',
    sizeMB: 44,
    label: '鸟声识别模型（BirdNET v2.4）',
  },
  image: {
    key: 'image',
    file: 'speciesnet-whole.onnx',
    labels: 'speciesnet-labels.txt',
    sizeMB: 0, // 待实测后回填
    label: '鸟图识别模型',
  },
}

export const weightsUrl = (m: ModelRef) => `${MODEL_BASE}/models/${m.file}`
export const labelsUrl = (m: ModelRef) => `${MODEL_BASE}/models/${m.labels}`
