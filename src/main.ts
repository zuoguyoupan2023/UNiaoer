import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { isDiag } from './core/diag'

// 072-a 观测：`?diag=1` 在**任意页面**都生效并记住（手机上不必每次都给答题页带参数）；
// 默认关闭时这里什么都不做，不改变任何行为。
isDiag()

const app = createApp(App)

app.use(createPinia())
app.use(i18n)
app.use(router)

app.mount('#app')

// 注册 Service Worker：媒体持久化缓存 + 离线可用
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err) => console.warn('service worker registration failed:', err))
  })
}
