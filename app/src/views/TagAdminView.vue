<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi';

const tags = ref<any[]>([]);
const editingId = ref<string | null>(null);
const editForm = ref({ name: '', emoji: '', colour: '', description: '' });

async function loadTags() {
  tags.value = await api.getTags();
}

onMounted(loadTags);

function startEdit(tag: any) {
  editingId.value = tag.id;
  editForm.value = { name: tag.name, emoji: tag.emoji || '', colour: tag.colour || '#888888', description: tag.description || '' };
}

async function saveEdit() {
  if (!editingId.value || !editForm.value.name.trim()) return;
  await api.updateTag(editingId.value, editForm.value);
  editingId.value = null;
  await loadTags();
}

async function deleteTag(tag: any) {
  if (!confirm(`Delete tag "${tag.name}"? It will be removed from all outcomes, motivations, and milestones.`)) return;
  await api.deleteTag(tag.id);
  await loadTags();
}
</script>

<template>
  <div class="tag-admin">
    <div class="admin-header">
      <h2 class="font-display">Tag Admin</h2>
      <span class="tag-count font-mono">{{ tags.length }} tags</span>
    </div>

    <div class="tag-list">
      <div v-for="tag in tags" :key="tag.id" class="tag-row">
        <template v-if="editingId === tag.id">
          <input v-model="editForm.emoji" class="input emoji-input" maxlength="2" />
          <input v-model="editForm.name" class="input name-input" @keyup.enter="saveEdit" />
          <input v-model="editForm.colour" type="color" class="colour-input" />
          <input v-model="editForm.description" class="input desc-input" placeholder="Description" />
          <button class="btn btn-sm btn-primary" @click="saveEdit">Save</button>
          <button class="btn btn-sm" @click="editingId = null">Cancel</button>
        </template>
        <template v-else>
          <span class="tag-preview tag" :style="{ background: (tag.colour || '#888') + '15', color: tag.colour || '#888' }">
            {{ tag.emoji }} {{ tag.name }}
          </span>
          <span class="tag-desc">{{ tag.description || '—' }}</span>
          <span class="tag-usage font-mono" :title="'Used by outcomes, motivations, and milestones'">{{ tag.usageCount }} uses</span>
          <div class="tag-actions">
            <button class="btn btn-sm" @click="startEdit(tag)">Edit</button>
            <button class="btn btn-sm btn-danger" @click="deleteTag(tag)">Delete</button>
          </div>
        </template>
      </div>
      <div v-if="tags.length === 0" class="empty">No tags yet. Create tags when adding outcomes or motivations.</div>
    </div>
  </div>
</template>

<style scoped>
.tag-admin {
  padding: 24px;
  max-width: 800px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
}
.admin-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.admin-header h2 { font-size: 18px; font-weight: 700; }
.tag-count { font-size: 11px; color: var(--text-3); background: var(--bg-3); padding: 2px 8px; border-radius: 8px; }

.tag-list { display: flex; flex-direction: column; gap: 2px; }
.tag-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  transition: background var(--transition);
}
.tag-row:hover { background: var(--bg-hover); }

.tag-preview { flex-shrink: 0; }
.tag-desc { font-size: 12px; color: var(--text-2); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tag-usage { font-size: 11px; color: var(--text-3); flex-shrink: 0; }
.tag-actions { display: flex; gap: 4px; flex-shrink: 0; opacity: 0; transition: opacity var(--transition); }
.tag-row:hover .tag-actions { opacity: 1; }

.input {
  font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 4px 8px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-1); color: var(--text-0); outline: none;
}
.input:focus { border-color: var(--accent); }
.emoji-input { width: 36px; text-align: center; }
.name-input { width: 140px; }
.desc-input { flex: 1; }
.colour-input { width: 28px; height: 28px; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; padding: 0; }

.btn-danger { border-color: var(--red); color: var(--red); background: var(--red-dim); }
.btn-danger:hover { background: #c43c3c20; }

.empty { padding: 40px; text-align: center; color: var(--text-3); font-size: 14px; }
</style>
