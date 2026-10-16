/**
 * `@tensorflow/tfjs-tflite` 只为包根 index 提供了类型声明；
 * 我们用的预打包 ESM 入口 `dist/tf-tflite.es2017.js` 没有 .d.ts，
 * 故在此补最小声明（alpha 版的打包 bug：包根 index 会 import 一个
 * 只有 .d.ts、没有 .js 的 tflite_web_api_client，rolldown 直接解析失败）。
 */
declare module '@tensorflow/tfjs-tflite/dist/tf-tflite.es2017.js' {
  export interface TFLiteTensor {
    data: Float32Array | Int32Array | Uint8Array
    dims: number[]
  }
  export interface TFLiteModelRunner {
    predict(input: Float32Array): TFLiteTensor
    dispose?(): void
  }
  export function setWasmPath(path: string): void
  export function loadTFLiteModel(model: ArrayBuffer | string): Promise<TFLiteModelRunner>
}
