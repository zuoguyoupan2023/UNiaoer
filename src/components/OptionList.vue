<script setup lang="ts">
const props = defineProps<{
  options: string[]
  answer: string
  chosen: string | null
}>()

const emit = defineEmits<{ select: [value: string] }>()

const letters = ['A', 'B', 'C', 'D', 'E', 'F']

function state(opt: string): string {
  if (!props.chosen) return ''
  if (opt === props.answer) return 'correct'
  if (opt === props.chosen) return 'wrong'
  return 'dim'
}
</script>

<template>
  <div class="options">
    <button
      v-for="(opt, i) in options"
      :key="opt"
      class="option"
      :class="state(opt)"
      :disabled="!!chosen"
      @click="emit('select', opt)"
    >
      <span class="key">{{ letters[i] }}</span>
      <span>{{ opt }}</span>
    </button>
  </div>
</template>

<style scoped>
.options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 11px;
}
@media (max-width: 480px) {
  .options {
    grid-template-columns: 1fr;
  }
}
.option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border: 2px solid var(--border);
  border-radius: 14px;
  background: #fff;
  color: var(--text);
  font-size: 0.92rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: all 0.18s ease;
  box-shadow: var(--shadow-sm);
}
.option:not(:disabled):hover {
  transform: translateY(-2px);
  border-color: var(--primary-light);
  background: #f3fbf7;
}
.option:disabled {
  cursor: default;
}
.option.correct {
  border-color: var(--correct);
  background: linear-gradient(135deg, #eafaf1, #d8f3dc);
}
.option.wrong {
  border-color: var(--wrong);
  background: #fdecee;
}
.option.dim {
  opacity: 0.6;
}
.key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.74rem;
  font-weight: 800;
  flex-shrink: 0;
}
.option.correct .key {
  background: var(--correct);
  color: #fff;
}
.option.wrong .key {
  background: var(--wrong);
  color: #fff;
}
</style>
