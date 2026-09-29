<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { User } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const route = useRoute()
const settings = useSettingsStore()

/** 标签导航（原 sticky 锚点，现指向 /profile 二级路由，013 §5.5） */
const TABS = [
  { id: 'data', labelKey: 'profile.tabData' },
  { id: 'titles', labelKey: 'profile.tabTitles' },
  { id: 'badges', labelKey: 'profile.tabBadges' },
  { id: 'wrong', labelKey: 'profile.tabWrong' },
  { id: 'history', labelKey: 'profile.tabHistory' },
] as const
const tab = computed(() => route.path.split('/')[2] ?? 'data')

// ---- 用户昵称（R33）：2–12 字符，存本地，用于「我的」页与海报 ----
const editingNickname = ref(false)
const nicknameDraft = ref('')
const nicknameMsg = ref('')

function startNickname() {
  nicknameDraft.value = settings.nickname
  nicknameMsg.value = ''
  editingNickname.value = true
}

function saveNickname() {
  const v = nicknameDraft.value.trim()
  if (!v) {
    nicknameMsg.value = t('profile.nicknameEmpty')
    return
  }
  if (v.length < 2) {
    nicknameMsg.value = t('profile.nicknameShort')
    return
  }
  settings.nickname = v
  editingNickname.value = false
}
</script>

<template>
  <div class="profile-page">
    <!-- 身份卡：标题 + 昵称（所有子页共用） -->
    <section class="card head-card">
      <h2 class="sec"><User class="ic" :size="20" /> {{ t('nav.profile') }}</h2>
      <div class="nickname-row">
        <template v-if="editingNickname">
          <input
            v-model="nicknameDraft"
            class="nickname-input"
            maxlength="12"
            :placeholder="t('profile.nicknamePlaceholder')"
            @keyup.enter="saveNickname"
          />
          <button class="btn btn-primary btn-sm" @click="saveNickname">{{ t('common.save') }}</button>
          <button class="btn btn-secondary btn-sm" @click="editingNickname = false">
            {{ t('common.cancel') }}
          </button>
        </template>
        <template v-else>
          <span class="nickname-chip">
            <User class="ic" :size="13" />
            {{ settings.nickname || t('profile.noNickname') }}
          </span>
          <button class="btn btn-secondary btn-sm" @click="startNickname">
            {{ settings.nickname ? t('common.edit') : t('profile.setNickname') }}
          </button>
        </template>
        <span v-if="nicknameMsg" class="nickname-msg">{{ nicknameMsg }}</span>
      </div>
    </section>

    <!-- 标签导航：/profile/<id> 二级路由切换 -->
    <nav class="section-tabs" :aria-label="t('nav.profile')">
      <RouterLink v-for="s in TABS" :key="s.id" :to="`/profile/${s.id}`" :class="{ on: tab === s.id }">
        {{ t(s.labelKey) }}
      </RouterLink>
    </nav>

    <RouterView />
  </div>
</template>

<style scoped>
.head-card {
  padding: 18px 26px;
}
.sec {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 1.15rem;
  margin-bottom: 12px;
}
.sec .ic {
  color: var(--primary);
}
/* ---- 标签导航：sticky 固定在吸顶导航栏下方，点击切换二级路由 ---- */
.profile-page {
  display: flex;
  flex-direction: column;
}
.section-tabs {
  position: sticky;
  /* 顶栏已全局吸顶（top 8px + 高≈48px，移动端两行≈84px），标签停靠其下 */
  top: 60px;
  z-index: 6;
  display: flex;
  gap: 8px;
  padding: 10px 4px;
  margin-bottom: 10px;
  overflow-x: auto;
  background: rgba(244, 251, 247, 0.95);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 0 0 14px 14px;
}
.section-tabs a {
  flex-shrink: 0;
  padding: 7px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  color: var(--text-light);
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.18s ease;
}
.section-tabs a.on {
  background: var(--grad);
  color: #fff;
  border-color: transparent;
}
@media (max-width: 640px) {
  .section-tabs {
    top: 92px;
  }
}
/* ---- 昵称（R33） ---- */
.nickname-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.nickname-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border: 2px solid var(--primary-light);
  border-radius: 16px;
  background: #f3fbf7;
  color: var(--primary-dark);
  font-size: 0.9rem;
  font-weight: 700;
}
.nickname-chip .ic {
  color: var(--primary);
}
.nickname-input {
  width: 200px;
  padding: 8px 12px;
  border: 2px solid var(--primary-light);
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.9rem;
}
.nickname-msg {
  font-size: 0.78rem;
  color: var(--wrong);
}
</style>
