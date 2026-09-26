<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  Activity,
  AudioLines,
  Award,
  BadgeCheck,
  BookOpen,
  Brain,
  Crown,
  Crosshair,
  Ear,
  Egg,
  Feather,
  Flame,
  Footprints,
  Headphones,
  HeartHandshake,
  Lightbulb,
  Lock,
  Medal,
  Moon,
  Repeat,
  RotateCcw,
  Shield,
  Skull,
  Sparkles,
  Sunrise,
  Swords,
  Target,
  Undo2,
} from 'lucide-vue-next'

const props = defineProps<{ name: string; size?: number }>()

const MAP: Record<string, Component> = {
  egg: Egg,
  feather: Feather,
  'badge-check': BadgeCheck,
  target: Target,
  headphones: Headphones,
  brain: Brain,
  'book-open': BookOpen,
  flame: Flame,
  skull: Skull,
  ear: Ear,
  swords: Swords,
  footprints: Footprints,
  shield: Shield,
  crown: Crown,
  medal: Medal,
  activity: Activity,
  'audio-lines': AudioLines,
  'rotate-ccw': RotateCcw,
  repeat: Repeat,
  crosshair: Crosshair,
  lightbulb: Lightbulb,
  moon: Moon,
  sunrise: Sunrise,
  'undo-2': Undo2,
  'heart-handshake': HeartHandshake,
  sparkles: Sparkles,
  lock: Lock,
}

const icon = computed(() => MAP[props.name] ?? Award)
</script>

<template>
  <component :is="icon" :size="size ?? 22" />
</template>
