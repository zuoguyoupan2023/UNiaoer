<script setup lang="ts">
/**
 * G1 报错浮窗（三个答题组件共用）。
 *
 * 昵称可选：填写后随报错一起上传，用于更正日志里的致谢；留空即匿名。
 * 这里填的昵称与「我的」页等效，会写回本地身份昵称。
 */
import { onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Flag } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { getActiveProfile, setProfileNickname } from '@/core/historyDb'
import { addReport, markReportSynced, type ReportReason } from '@/core/reportStore'
import { submitReport } from '@/core/reportsApi'
import { getClientId } from '@/core/anonymousId'
import { useDialogA11y } from '@/composables/useDialogA11y'
import { track } from '@/core/metrics'
import type { MediaType } from '@/types'

const props = defineProps<{
  open: boolean
  speciesId: string
  speciesName: string
  sci: string
  questionType: MediaType
  mediaUrl: string
}>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { t } = useI18n()
const settings = useSettingsStore()

const REPORT_REASONS: { id: ReportReason; labelKey: string }[] = [
  { id: 'image', labelKey: 'report.reasons.image' },
  { id: 'audio', labelKey: 'report.reasons.audio' },
  { id: 'answer', labelKey: 'report.reasons.answer' },
  { id: 'quality', labelKey: 'report.reasons.quality' },
  { id: 'other', labelKey: 'report.reasons.other' },
]

const reason = ref<ReportReason>('image')
const answer = ref('')
const note = ref('')
const nicknameDraft = ref('')
const nicknameMsg = ref('')
const state = ref<'idle' | 'done' | 'error'>('idle')
let closeTimer: ReturnType<typeof setTimeout> | null = null

function close() {
  emit('update:open', false)
}
const { panelRef } = useDialogA11y(() => props.open, { onClose: close })

/** 本机已有昵称时直接带出，省得重复填 */
async function prefillNickname() {
  nicknameDraft.value = settings.nickname
  if (nicknameDraft.value) return
  try {
    const p = await getActiveProfile()
    if (!props.open || nicknameDraft.value) return
    if (p?.nickname) nicknameDraft.value = p.nickname
  } catch {
    /* IndexedDB 不可用：保持空，等同匿名 */
  }
}

watch(
  () => props.open,
  (on) => {
    if (!on) return
    reason.value = props.questionType === 'audio' ? 'audio' : 'image'
    answer.value = ''
    note.value = ''
    nicknameMsg.value = ''
    state.value = 'idle'
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
    void prefillNickname()
  },
  { immediate: true },
)

watch(nicknameDraft, () => {
  if (nicknameMsg.value) nicknameMsg.value = ''
})

async function submit() {
  const nickname = nicknameDraft.value.trim()
  if (nickname.length === 1) {
    nicknameMsg.value = t('profile.nicknameShort')
    return
  }
  // 与「我的」页等效：填了就存成身份昵称（档案未写过时也补上）
  if (nickname) {
    settings.nickname = nickname
    try {
      await setProfileNickname(nickname)
    } catch {
      /* 仅设备级也够用 */
    }
  }
  try {
    const row = await addReport({
      speciesId: props.speciesId,
      speciesName: props.speciesName,
      sci: props.sci,
      questionType: props.questionType,
      mediaUrl: props.mediaUrl,
      reason: reason.value,
      suggestedAnswer: answer.value.trim() || undefined,
      note: note.value.trim() || undefined,
      nickname: nickname || undefined,
    })
    try {
      await submitReport(row, getClientId())
      await markReportSynced(row.id)
      track('report_submit')
    } catch {
      /* 离线：保留 pending，设置页可补传 */
    }
    state.value = 'done'
    closeTimer = setTimeout(close, 1200)
  } catch {
    state.value = 'error'
  }
}

onUnmounted(() => {
  if (closeTimer) clearTimeout(closeTimer)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="wizard-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="t('report.title')"
      @click.self="close"
    >
      <div ref="panelRef" class="wizard-panel report-panel">
        <h3 class="wizard-title">
          <Flag class="ic" :size="18" /> {{ t('report.title') }}
        </h3>

        <template v-if="state !== 'done'">
          <p class="wizard-sub">{{ t('report.sub') }}</p>

          <p class="report-label">{{ t('report.reasonLabel') }}</p>
          <div class="report-reasons" role="group" :aria-label="t('report.reasonLabel')">
            <button
              v-for="r in REPORT_REASONS"
              :key="r.id"
              type="button"
              class="reason"
              :class="{ on: reason === r.id }"
              :aria-pressed="reason === r.id"
              @click="reason = r.id"
            >
              {{ t(r.labelKey) }}
            </button>
          </div>

          <label class="report-field">
            <span>{{ t('report.answerLabel') }}</span>
            <input v-model="answer" type="text" :placeholder="t('report.answerPlaceholder')" />
          </label>
          <label class="report-field">
            <span>{{ t('report.noteLabel') }}</span>
            <textarea v-model="note" rows="2" :placeholder="t('report.notePlaceholder')"></textarea>
          </label>
          <label class="report-field">
            <span>{{ t('report.nicknameLabel') }}</span>
            <input
              v-model="nicknameDraft"
              type="text"
              maxlength="12"
              :placeholder="t('report.nicknamePlaceholder')"
            />
          </label>
          <p v-if="!nicknameDraft.trim()" class="report-hint">{{ t('report.nicknameHint') }}</p>
          <p v-if="nicknameMsg" class="report-err" role="alert">{{ nicknameMsg }}</p>

          <p v-if="state === 'error'" class="report-err" role="alert">{{ t('report.error') }}</p>

          <div class="wizard-actions">
            <button class="btn btn-primary" type="button" @click="submit">
              {{ t('report.submit') }}
            </button>
            <button class="btn btn-secondary" type="button" @click="close">
              {{ t('common.cancel') }}
            </button>
          </div>
        </template>

        <p v-else class="report-done">{{ t('report.done') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wizard-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(10, 30, 22, 0.55);
  backdrop-filter: blur(6px);
}
.wizard-panel {
  width: min(480px, 100%);
  max-height: 100%;
  overflow-y: auto;
  background: #fff;
  border-radius: var(--radius);
  padding: 24px;
  box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.6);
}
.wizard-title {
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--primary-dark);
  text-align: center;
  margin-bottom: 6px;
}
.wizard-sub {
  font-size: 0.82rem;
  color: var(--text-light);
  text-align: center;
  margin-bottom: 14px;
}
.wizard-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 16px;
}
.wizard-actions .btn {
  flex: 1;
}
.report-panel {
  text-align: left;
  max-width: 400px;
}
.report-panel .wizard-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.report-panel .wizard-title .ic {
  color: var(--primary);
}
.report-label {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-light);
  margin: 12px 0 6px;
}
.report-reasons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.report-reasons .reason {
  padding: 8px 10px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  font-size: 0.82rem;
  font-family: inherit;
  cursor: pointer;
}
.report-reasons .reason.on {
  border-color: var(--primary);
  background: #eaf4ef;
  font-weight: 700;
}
.report-field {
  display: block;
  margin-top: 12px;
}
.report-field span {
  display: block;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-light);
  margin-bottom: 4px;
}
.report-field input,
.report-field textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.85rem;
  color: var(--text);
  resize: vertical;
}
.report-hint {
  margin: 5px 0 0;
  font-size: 0.74rem;
  line-height: 1.4;
  color: var(--text-light);
}
.report-err {
  margin-top: 10px;
  color: var(--wrong);
  font-size: 0.8rem;
}
.report-done {
  margin: 12px 0;
  text-align: center;
  color: var(--primary);
  font-weight: 700;
}
</style>
