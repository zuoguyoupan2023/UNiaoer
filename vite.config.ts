import { cpSync, mkdirSync, readdirSync } from 'node:fs'
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    copyPublicExceptMedia(),
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
