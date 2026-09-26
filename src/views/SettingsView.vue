<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Settings } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { ambiencePlayer, loadBirdTracks, type AmbienceTrack } from '@/core/ambience'
import type { AutoNextMode } from '@/types'

const settings = useSettingsStore()
const cacheMsg = ref('')

// 环境鸟鸣音轨目录（懒加载，默认全部勾选）
const tracks = ref<AmbienceTrack[] | null>(null)
const tracksError = ref('')

onMounted(async () => {
  try {
    tracks.value = await loadBirdTracks()
  } catch {
    tracksError.value = '鸟鸣目录加载失败（需要网络），稍后重试'
  }
})

function isTrackChecked(id: string): boolean {
  return !settings.ambienceExcluded.includes(id)
}

function toggleTrack(id: string, checked: boolean) {
  settings.ambienceExcluded = checked
    ? settings.ambienceExcluded.filter((x) => x !== id)
    : [...settings.ambienceExcluded, id]
  ambiencePlayer.syncExclusions() // 正在播放的音轨被取消勾选时自动切下一首
}

async function clearMediaCache() {
  if (!('caches' in window)) {
    cacheMsg.value = '当前浏览器不支持缓存管理'
    return
  }
  const keys = await caches.keys()
  const targets = keys.filter((k) => k.startsWith('uniaoer-'))
  await Promise.all(targets.map((k) => caches.delete(k)))
  cacheMsg.value = targets.length ? `已清除 ${targets.length} 个缓存` : '没有可清除的缓存'
}

const autoNextOptions: { value: AutoNextMode; label: string; hint: string }[] = [
  { value: 'correct', label: '答对自动', hint: '答对后等 2s 自动进入下一题（默认）' },
  { value: 'all', label: '都自动', hint: '答对、答错、超时后都等 2s 自动进入下一题' },
  { value: 'manual', label: '都手动', hint: '始终手动点击「下一题」' },
]
</script>

<template>
  <section class="card">
    <h2 class="sec"><Settings class="ic" :size="20" /> 设置</h2>

    <div class="setting">
      <h3>音频自动播放</h3>
      <label class="switch">
        <input v-model="settings.autoplayAudio" type="checkbox" />
        <span>开启后，从第 2 题起、切题后自动播放；关闭则每题都需手动点击</span>
      </label>

      <label class="delay">
        延迟
        <input
          v-model.number="settings.autoplayDelayMs"
          type="number"
          min="1000"
          max="3000"
          step="500"
        />
        ms
      </label>
    </div>

    <p class="muted" style="margin-top: 8px">
      默认开启。第 1 题始终需手动播放一次以解锁浏览器策略，之后各题才会自动播放。
    </p>

    <div class="setting">
      <h3>自动进入下一题</h3>
      <p class="muted">作答后是否自动跳到下一题，以及触发的时机。</p>
      <div class="choices">
        <button
          v-for="o in autoNextOptions"
          :key="o.value"
          class="choice"
          :class="{ on: settings.autoNext === o.value }"
          @click="settings.autoNext = o.value"
        >
          <strong>{{ o.label }}</strong>
          <span>{{ o.hint }}</span>
        </button>
      </div>
    </div>

    <div class="setting">
      <h3>环境鸟鸣</h3>
      <p class="muted">
        顶栏的喇叭按钮可一键播放/停止：在你勾选的音轨中乱序轮流播放。默认全部勾选；取消勾选的音轨不会播放。勾选只保存在本地。
      </p>
      <p v-if="tracksError" class="muted">{{ tracksError }}</p>
      <p v-else-if="!tracks" class="muted">音轨目录加载中…</p>
      <div v-else class="track-list">
        <label v-for="t in tracks" :key="t.id" class="track">
          <input
            type="checkbox"
            :checked="isTrackChecked(t.id)"
            @change="toggleTrack(t.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="zh">{{ t.labelZh }}</span>
          <span class="en">{{ t.labelEn }}</span>
        </label>
      </div>
    </div>

    <div class="setting">
      <h3>媒体缓存</h3>
      <p class="muted">
        图片与音频会缓存在本地（Service Worker），二次访问与离线可秒开。如占用过大可清除。
      </p>
      <button class="btn btn-secondary" style="margin-top: 10px" @click="clearMediaCache">
        清除媒体缓存
      </button>
      <p v-if="cacheMsg" class="muted" style="margin-top: 8px">{{ cacheMsg }}</p>
    </div>
  </section>
</template>

<style scoped>
h2.sec {
  font-size: 1.1rem;
  margin-bottom: 16px;
}
.setting {
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
.setting:last-of-type {
  border-bottom: none;
}
.setting h3 {
  font-size: 0.95rem;
  margin-bottom: 6px;
}
.choices {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}
.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  text-align: left;
  padding: 12px 16px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: pointer;
  transition: all 0.18s ease;
}
.choice:hover {
  border-color: var(--primary-light);
}
.choice.on {
  border-color: var(--primary);
  background: #f3fbf7;
}
.choice strong {
  font-size: 0.9rem;
}
.choice span {
  font-size: 0.76rem;
  color: var(--text-light);
}
.switch {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  font-size: 0.85rem;
  cursor: pointer;
}
.delay {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 0.85rem;
}
.delay input {
  width: 90px;
  padding: 7px 10px;
  border: 2px solid var(--border);
  border-radius: 10px;
  font-family: inherit;
}
.track-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.track {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: pointer;
  font-size: 0.88rem;
  transition: all 0.18s ease;
}
.track:hover {
  border-color: var(--primary-light);
}
.track input {
  width: 16px;
  height: 16px;
  accent-color: var(--primary);
}
.track .zh {
  font-weight: 600;
}
.track .en {
  margin-left: auto;
  font-size: 0.74rem;
  color: var(--text-light);
}
</style>
