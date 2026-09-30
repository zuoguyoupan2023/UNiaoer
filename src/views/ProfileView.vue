<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Archive, Plus, User } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import {
  activateArchive,
  createArchive,
  deleteArchive,
  getActiveArchive,
  getActiveProfile,
  getStats,
  listArchives,
  renameArchive,
  setProfileNickname,
  type ArchiveRow,
  type ProfileRow,
} from '@/core/historyDb'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
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

// ---- 档案（013 A3-lite）：切换 / 新建；数据（统计/错题/徽章/历史）按活动档隔离 ----
const profile = ref<ProfileRow | null>(null)
const activeArchive = ref<ArchiveRow | null>(null)
const archives = ref<ArchiveRow[]>([])
const roundsCount = ref(0)
const wrongCount = ref(0)

/** 无数据的历史/错题本标签置灰不可点（不存在的入口不出现） */
function tabEnabled(id: string) {
  if (id === 'history') return roundsCount.value > 0
  if (id === 'wrong') return wrongCount.value > 0
  return true
}

async function loadArchive() {
  try {
    const [p, a, list, st] = await Promise.all([
      getActiveProfile(),
      getActiveArchive(),
      listArchives(),
      getStats().catch(() => null),
    ])
    profile.value = p
    activeArchive.value = a
    archives.value = list
    roundsCount.value = st?.rounds ?? 0
    wrongCount.value = st?.wrongCount ?? 0
    if (p?.nickname) settings.nickname = p.nickname // 身份级昵称，与档案快照解耦
    // 当前标签若已不可用，回落到数据页
    if (!tabEnabled(tab.value)) router.replace('/profile/data')
  } catch {
    /* IndexedDB 不可用（隐私模式）：档案功能静默降级 */
  }
}
onMounted(loadArchive)

async function switchArchive(id: string) {
  if (id === activeArchive.value?.id) return
  await activateArchive(id)
  await loadArchive()
}

/** 新开一局 = 新建档案从零计数（旧档保留，可切回） */
async function newGame() {
  if (!confirm(t('archive.newGameConfirm'))) return
  await createArchive()
  await loadArchive()
}

// ---- 档案重命名 / 删除（013 A3；删除仅针对当前活动档） ----
const renamingArchive = ref(false)
const archiveNameDraft = ref('')

function startRename() {
  archiveNameDraft.value = activeArchive.value?.name || ''
  renamingArchive.value = true
}

async function saveRename() {
  const v = archiveNameDraft.value.trim()
  if (!v || !activeArchive.value) {
    renamingArchive.value = false
    return
  }
  await renameArchive(activeArchive.value.id, v)
  renamingArchive.value = false
  await loadArchive()
}

async function removeArchive() {
  const a = activeArchive.value
  if (!a) return
  if (!confirm(t('archive.deleteConfirm', { name: a.name }))) return
  try {
    await deleteArchive(a.id)
    await loadArchive()
  } catch {
    alert(t('archive.lastOne')) // 至少保留一个档案
  }
}

// ---- 用户昵称（R33）：2–12 字符；改「身份」昵称，不改已有档案快照（旧档海报不变） ----
const editingNickname = ref(false)
const nicknameDraft = ref('')
const nicknameMsg = ref('')

function startNickname() {
  nicknameDraft.value = profile.value?.nickname || settings.nickname
  nicknameMsg.value = ''
  editingNickname.value = true
}

async function saveNickname() {
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
  try {
    await setProfileNickname(v) // 仅身份级；新开局建档时才快照进新档案
  } catch {
    /* 降级：仅设备级 */
  }
  if (profile.value) profile.value = { ...profile.value, nickname: v }
  editingNickname.value = false
}
</script>

<template>
  <div class="profile-page">
    <!-- 身份卡：昵称 + 当前档案 + 档案切换/新开一局（所有子页共用） -->
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
            {{ profile?.nickname || settings.nickname || t('profile.noNickname') }}
          </span>
          <button class="btn btn-secondary btn-sm" @click="startNickname">
            {{ profile?.nickname ? t('common.edit') : t('profile.setNickname') }}
          </button>
        </template>
        <span v-if="nicknameMsg" class="nickname-msg">{{ nicknameMsg }}</span>
      </div>

      <div class="archive-row">
        <span class="archive-cap">
          <Archive class="ic" :size="13" /> {{ t('archive.count', { n: archives.length }) }}
        </span>
        <div class="archive-list">
          <button
            v-for="a in archives"
            :key="a.id"
            class="archive-chip"
            :class="{ on: a.id === activeArchive?.id }"
            :title="t('archive.createdAt', { date: a.name })"
            @click="switchArchive(a.id)"
          >
            {{ a.name }}
          </button>
        </div>
        <template v-if="!renamingArchive">
          <button class="btn btn-secondary btn-sm archive-new" @click="newGame">
            <Plus class="ic" :size="14" /> {{ t('archive.newGame') }}
          </button>
          <button class="btn btn-secondary btn-sm" @click="startRename">
            {{ t('archive.rename') }}
          </button>
          <button class="btn btn-danger btn-sm" @click="removeArchive">
            {{ t('archive.delete') }}
          </button>
        </template>
        <template v-else>
          <input
            v-model="archiveNameDraft"
            class="archive-input"
            maxlength="40"
            :placeholder="t('archive.renamePlaceholder')"
            @keyup.enter="saveRename"
          />
          <button class="btn btn-primary btn-sm" @click="saveRename">{{ t('common.save') }}</button>
          <button class="btn btn-secondary btn-sm" @click="renamingArchive = false">
            {{ t('common.cancel') }}
          </button>
        </template>
      </div>
    </section>

    <!-- 标签导航：/profile/<id> 二级路由切换 -->
    <nav class="section-tabs" :aria-label="t('nav.profile')">
      <template v-for="s in TABS" :key="s.id">
        <RouterLink
          v-if="tabEnabled(s.id)"
          :to="`/profile/${s.id}`"
          :class="{ on: tab === s.id }"
        >
          {{ t(s.labelKey) }}
        </RouterLink>
        <span v-else class="tab-off" aria-disabled="true">{{ t(s.labelKey) }}</span>
      </template>
    </nav>

    <!-- 切档后按档案 id 重挂载子页，统计/错题/历史即时刷新 -->
    <RouterView :key="activeArchive?.id || 'none'" />
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
  border-radius: 8px;
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
/* 无数据标签：置灰不可点 */
.section-tabs .tab-off {
  flex-shrink: 0;
  padding: 7px 18px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: #f3f5f4;
  color: #b8c4bd;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: not-allowed;
  user-select: none;
}
@media (max-width: 640px) {
  .section-tabs {
    top: 92px;
  }
  /* 窄屏 3+2 折行：数据/称号/徽章在上，错题/历史（记录类）在下；每格等宽居中 */
  .section-tabs {
    flex-wrap: wrap;
  }
  .section-tabs a,
  .section-tabs .tab-off {
    flex: 1 0 calc((100% - 16px) / 3);
    text-align: center;
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
  border-radius: 8px;
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
/* ---- 档案（013 A3-lite） ---- */
.archive-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}
.archive-cap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--text-light);
  font-weight: 700;
}
.archive-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.archive-chip {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text-light);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}
.archive-chip:hover {
  border-color: var(--primary-light);
  color: var(--primary);
}
.archive-chip.on {
  background: var(--grad);
  color: #fff;
  border-color: transparent;
}
.archive-new .ic {
  margin-right: 2px;
}
.archive-input {
  width: 200px;
  padding: 7px 12px;
  border: 2px solid var(--primary-light);
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.82rem;
}
.btn-danger {
  color: var(--wrong);
  border-color: var(--wrong);
  background: #fff;
}
.btn-danger:hover {
  background: #fdecee;
  color: var(--wrong);
}
</style>
