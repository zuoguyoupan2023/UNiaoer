import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
  let buildId = ''
  return {
    name: 'emit-build-id',
    apply: 'build',
    configResolved(config) {
      dest = path.resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      mkdirSync(path.join(dest, 'data'), { recursive: true })
      buildId = new Date().toISOString()
      const payload = { buildId, version: process.env.npm_package_version ?? '' }
      writeFileSync(path.join(dest, 'data/build.json'), JSON.stringify(payload) + '\n')
    },
    /**
     * 062 D0：给 dist/sw.js 末尾注入 buildId。
     *
     * 原因：sw.js 是 public 静态文件，不在 Vite 的 hash 产物里；如果每次部署内容不变，
     * 浏览器不会安装新 SW → 不触发 activate → refreshBuildTag() 不跑 → cache-first 的
     * data/assets/* 永远不刷新。注入 buildId 让 sw.js 字节每次都变，但**不改 VERSION**，
     * 所以只清 runtime 缓存，不动媒体缓存。
     */
    closeBundle() {
      if (!buildId) return
      const sw = path.join(dest, 'sw.js')
      try {
        const text = readFileSync(sw, 'utf8')
        if (!text.includes('// build:')) {
          writeFileSync(sw, `${text.replace(/\s*$/, '')}\n// build:${buildId}\n`)
        }
      } catch {
        /* 没有 sw.js（非标准构建）时忽略；check:dist-size 仍会跑 */
      }
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
