import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

/**
 * public/media 只走 R2（manifest 里是绝对地址），构建产物不需要它；
 * vite 默认整份复制进 dist（数 GB，曾撑爆磁盘），这里排除。
 */
function copyPublicExceptMedia(): Plugin {
  const publicDir = fileURLToPath(new URL('./public', import.meta.url))
  let dest = ''
  return {
    name: 'copy-public-except-media',
    apply: 'build',
    configResolved(config) {
      dest = path.resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      mkdirSync(dest, { recursive: true })
      for (const entry of readdirSync(publicDir)) {
        if (entry === 'media') continue
        cpSync(path.join(publicDir, entry), path.join(dest, entry), { recursive: true })
      }
    },
  }
}

/**
 * 构建标记：**每次构建都写一个 `data/build.json`**（几百字节）。
 *
 * 为什么需要它：SW 的缓存失效原来只看 `manifest-meta.generatedAt`（060-10-10 起一直没变），
 * 于是「只改前端/只重建对表产物」的部署**不会触发清缓存** ——
 * `/data/model-labels-*.json` 与 `data/assets/*` 都是 cache-first，用户永远拿旧数据。
 * 2026-10-17 实测症状：识别出白头鹎却说「暂无素材」（浏览器里是旧对表产物 s:null）。
 * 现在 SW 先读这个文件的 buildId，任何一次部署都会让旧缓存作废。
 */
function emitBuildId(): Plugin {
  let dest = ''
  return {
    name: 'emit-build-id',
    apply: 'build',
    configResolved(config) {
      dest = path.resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      mkdirSync(path.join(dest, 'data'), { recursive: true })
      const payload = { buildId: new Date().toISOString(), version: process.env.npm_package_version ?? '' }
      writeFileSync(path.join(dest, 'data/build.json'), JSON.stringify(payload) + '\n')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({

  plugins: [
    vue(),
    vueDevTools(),
    copyPublicExceptMedia(),
    emitBuildId(),
  ],
  build: {
    // public/ 的复制由上面的插件接管（排除 media/）
    copyPublicDir: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 本地联调 Worker（npm run worker:dev，默认 8787）：前端 /api/* 走这里
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
