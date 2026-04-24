<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi';
import EmojiPicker from './EmojiPicker.vue';

const props = defineProps<{
  modelValue: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [ids: string[]];
}>();

const tags = ref<any[]>([]);
const showCreate = ref(false);
const newTag = ref({ name: '', emoji: '', colour: '#2a7ac8' });
const creating = ref(false);

onMounted(async () => {
  tags.value = await api.getTags();
});

function toggle(tagId: string) {
  const ids = [...props.modelValue];
  const i = ids.indexOf(tagId);
  if (i >= 0) ids.splice(i, 1);
  else ids.push(tagId);
  emit('update:modelValue', ids);
}

async function createTag() {
  if (!newTag.value.name.trim()) return;
  creating.value = true;
  try {
    const tag = await api.createTag(newTag.value);
    tags.value.push(tag);
    emit('update:modelValue', [...props.modelValue, tag.id]);
    newTag.value = { name: '', emoji: '', colour: '#2a7ac8' };
    showCreate.value = false;
  } catch { /* error surfaced via toast by useApi */ } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="tag-picker">
    <span
      v-for="tag in tags" :key="tag.id"
      :class="['tag', { selected: modelValue.includes(tag.id) }]"
      :style="{ background: (tag.colour || '#888') + (modelValue.includes(tag.id) ? '30' : '15'), color: tag.colour || '#888' }"
      @click="toggle(tag.id)"
    >{{ tag.emoji }} {{ tag.name }}</span>

    <button v-if="!showCreate" class="tag create-tag" @click="showCreate = true">+ new</button>

    <div v-if="showCreate" class="create-form">
      <EmojiPicker v-model="newTag.emoji" />
      <input v-model="newTag.name" class="input name-input" placeholder="Tag name" @keyup.enter="createTag" />
      <input v-model="newTag.colour" type="color" class="colour-input" />
      <button class="btn btn-sm btn-primary" @click="createTag" :disabled="creating">Add</button>
      <button class="btn btn-sm" @click="showCreate = false">×</button>
    </div>
  </div>
</template>

<style scoped>
.tag-picker { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tag { cursor: pointer; transition: all var(--transition); }
.tag.selected { border: 1px solid currentColor; font-weight: 600; }
.create-tag { background: var(--bg-3); color: var(--text-2); border: 1px dashed var(--border); }
.create-tag:hover { border-color: var(--text-2); }

.create-form { display: flex; gap: 4px; align-items: center; width: 100%; margin-top: 6px; }
.input {
  font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 4px 8px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-1); color: var(--text-0); outline: none;
}
.input:focus { border-color: var(--accent); }
.name-input { flex: 1; }
.colour-input { width: 28px; height: 28px; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; padding: 0; }
</style>
