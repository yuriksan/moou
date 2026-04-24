<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [emoji: string] }>();

const show = ref(false);
const pos = ref({ top: 0, left: 0 });

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Security',    emojis: ['🔒', '🔐', '🔑', '🪪', '🛡️'] },
  { label: 'Data',        emojis: ['🫥', '🙈', '📦', '🗄️', '🗂️'] },
  { label: 'Compliance',  emojis: ['📋', '📜', '⚖️', '🏛️'] },
  { label: 'Engineering', emojis: ['🏗️', '⚙️', '🔧', '🛠️', '🪛'] },
  { label: 'Quality',     emojis: ['🧪', '✅', '🐛', '🔬', '🔍'] },
  { label: 'Integration', emojis: ['🔌', '🧩', '🔗', '📡'] },
  { label: 'Performance', emojis: ['⚡', '📈', '🏎️', '📊'] },
  { label: 'Customer',    emojis: ['👥', '🤝', '🎯', '💰', '💹'] },
  { label: 'Risk',        emojis: ['🔥', '⚠️', '🚨'] },
  { label: 'Releases',    emojis: ['🚀', '🏷️', '📌', '✨', '🆕'] },
];

function open(e: MouseEvent) {
  const btn = (e.currentTarget as HTMLElement).getBoundingClientRect();
  pos.value = { top: btn.bottom + 4, left: btn.left };
  show.value = !show.value;
}

function pick(emoji: string) {
  emit('update:modelValue', emoji);
  show.value = false;
}

const ALL_CURATED = new Set(EMOJI_GROUPS.flatMap(g => g.emojis));

function customValue() {
  return ALL_CURATED.has(props.modelValue) ? '' : props.modelValue;
}

function trimToOne(e: Event) {
  const input = e.target as HTMLInputElement;
  const segments = [...new Intl.Segmenter().segment(input.value)];
  if (segments.length > 1) emit('update:modelValue', segments[0].segment);
  else if (input.value) emit('update:modelValue', input.value);
}
</script>

<template>
  <div class="ep-wrap">
    <button class="ep-trigger" type="button" @click="open">{{ modelValue || '🏷️' }}</button>
    <Teleport to="body">
      <div v-if="show" class="ep-panel" :style="{ top: pos.top + 'px', left: pos.left + 'px' }">
        <div v-for="group in EMOJI_GROUPS" :key="group.label" class="ep-group">
          <div class="ep-group-label">{{ group.label }}</div>
          <div class="ep-group-emojis">
            <button
              v-for="e in group.emojis" :key="e"
              class="ep-btn" :class="{ active: modelValue === e }"
              type="button"
              @click="pick(e)"
            >{{ e }}</button>
          </div>
        </div>
        <div class="ep-custom">
          <span class="ep-group-label">Custom</span>
          <input
            :value="customValue()"
            class="ep-custom-input"
            placeholder="…"
            @input="trimToOne"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ep-wrap { position: relative; flex-shrink: 0; }
.ep-trigger {
  width: 32px; height: 32px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-1); cursor: pointer; font-size: 16px; display: flex;
  align-items: center; justify-content: center; transition: border-color var(--transition);
}
.ep-trigger:hover { border-color: var(--accent); }
</style>

<style>
.ep-panel {
  position: fixed;
  z-index: 1000;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px;
  width: 280px;
  max-height: min(420px, 60vh);
  overflow-y: auto;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ep-group-label { font-size: 10px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.ep-group-emojis { display: flex; flex-wrap: wrap; gap: 2px; }
.ep-btn {
  font-size: 18px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm); cursor: pointer; background: none; border: 1px solid transparent;
  transition: background var(--transition);
}
.ep-btn:hover { background: var(--bg-hover); }
.ep-btn.active { border-color: var(--accent); background: var(--accent-dim); }
.ep-custom { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--border-subtle); padding-top: 8px; }
.ep-custom-input {
  font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 4px 8px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-1); color: var(--text-0); outline: none;
  width: 36px; text-align: center;
}
.ep-custom-input:focus { border-color: var(--accent); }
</style>
