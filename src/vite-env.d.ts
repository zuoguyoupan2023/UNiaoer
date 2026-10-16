/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 端上识鸟模型桶基址（docs/056 §4）。留空 = 同源 /models/，用于本地联调 */
  readonly VITE_BIRDID_MODEL_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
