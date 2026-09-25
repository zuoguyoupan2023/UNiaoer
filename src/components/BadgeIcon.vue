<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Award, BadgeCheck, BookOpen, Brain, Egg, Flame, Headphones, Target } from 'lucide-vue-next'

const props = defineProps<{ name: string; size?: number }>()

const MAP: Record<string, Component> = {
  egg: Egg,
  'badge-check': BadgeCheck,
  target: Target,
  headphones: Headphones,
  brain: Brain,
  'book-open': BookOpen,
  flame: Flame,
}

const icon = computed(() => MAP[props.name] ?? Award)
</script>

<template>
  <component :is="icon" :size="size ?? 22" />
</template>
