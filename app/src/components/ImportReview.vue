<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../composables/useApi';

const props = defineProps<{
  diffs: any[];
  summary: any;
}>();

const emit = defineEmits<{
  applied: [];
  cancel: [];
}>();

const selected = ref<Set<number>>(new Set(props.diffs.map((_: any, i: number) => i)));
const archiveDeleted = ref(true);
const applying = ref(false);

function toggleAll(checked: boolean) {
  if (checked) selected.value = new Set(props.diffs.map((_: any, i: number) => i));
  else selected.value = new Set();
}

function toggle(index: number) {
  if (selected.value.has(index)) selected.value.delete(index);
  else selected.value.add(index);
  // Force reactivity
  selected.value = new Set(selected.value);
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    outcome_modified: 'Modified',
    motivation_modified: 'Motivation Changed',
    outcome_created: 'New',
    outcome_deleted: 'Deleted',
    outcome_moved: 'Moved',
  };
  return map[type] || type;
}

function typeClass(type: string): string {
  if (type.includes('created')) return 'badge-new';
  if (type.includes('deleted')) return 'badge-deleted';
  if (type.includes('moved')) return 'badge-moved';
  if (type.includes('motivation')) return 'badge-motivation';
  return 'badge-modified';
}

async function apply() {
  applying.value = true;
  try {
    const selectedDiffs = props.diffs.filter((_: any, i: number) => selected.value.has(i));
    await api.importTimelineApply(selectedDiffs, archiveDeleted.value);
    emit('applied');
  } catch { /* error surfaced via toast by useApi */ } finally {
    applying.value = false;
  }
}
</script>

<template>
  <div class="import-review">
    <div class="review-header">
      <h3 class="font-display review-title">Import Review</h3>
      <div class="review-summary">
        <span class="summary-item">{{ summary.total }} changes detected</span>
        <span v-if="summary.modified" class="summary-item badge-modified">{{ summary.modified }} modified</span>
        <span v-if="summary.created" class="summary-item badge-new">{{ summary.created }} new</span>
        <span v-if="summary.deleted" class="summary-item badge-deleted">{{ summary.deleted }} deleted</span>
        <span v-if="summary.moved" class="summary-item badge-moved">{{ summary.moved }} moved</span>
      </div>
    </div>

    <div v-if="diffs.length === 0" class="no-changes">
      No changes detected. The spreadsheet matches the current state.
    </div>

    <div v-else class="diff-list">
      <div class="select-all">
        <label>
          <input type="checkbox" :checked="selected.size === diffs.length" @change="toggleAll(($event.target as HTMLInputElement).checked)" />
          Select all ({{ selected.size }}/{{ diffs.length }})
        </label>
      </div>

      <div v-for="(diff, i) in diffs" :key="i" :class="['diff-item', { selected: selected.has(i) }]" @click="toggle(i)">
        <input type="checkbox" :checked="selected.has(i)" @click.stop="toggle(i)" />
        <span :class="['diff-type', typeClass(diff.type)]">{{ typeLabel(diff.type) }}</span>
        <span class="diff-entity">{{ diff.entityType }}</span>
        <span class="diff-title">{{ diff.title }}</span>
        <div class="diff-changes">
          <div v-for="(change, key) in diff.changes" :key="key" class="change-row">
            <span class="change-key">{{ key }}</span>
            <span class="change-old">{{ change.old ?? '—' }}</span>
            <span class="change-arrow">→</span>
            <span class="change-new">{{ change.new ?? '—' }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="summary.deleted > 0" class="archive-option">
      <label>
        <input type="checkbox" v-model="archiveDeleted" />
        Archive deleted outcomes (instead of permanently deleting)
      </label>
    </div>

    <div class="review-actions">
      <button class="btn" @click="emit('cancel')">Cancel</button>
      <button class="btn btn-primary" @click="apply" :disabled="applying || selected.size === 0">
        {{ applying ? 'Applying...' : `Apply ${selected.size} changes` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.import-review { padding: 20px 24px; max-height: 100%; overflow-y: auto; }
.review-header { margin-bottom: 16px; }
.review-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.review-summary { display: flex; gap: 8px; flex-wrap: wrap; }
.summary-item { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--bg-3); color: var(--text-1); }

.badge-modified { background: var(--accent-dim); color: var(--accent); }
.badge-new { background: var(--green-dim); color: var(--green); }
.badge-deleted { background: var(--red-dim); color: var(--red); }
.badge-moved { background: var(--blue-dim); color: var(--blue); }
.badge-motivation { background: var(--purple-dim); color: var(--purple); }

.no-changes { padding: 20px; text-align: center; color: var(--text-3); }

.select-all { margin-bottom: 8px; font-size: 12px; color: var(--text-2); }
.select-all label { display: flex; align-items: center; gap: 6px; cursor: pointer; }

.diff-list { display: flex; flex-direction: column; gap: 4px; }
.diff-item {
  display: grid; grid-template-columns: 20px auto auto 1fr; gap: 8px;
  padding: 10px 12px; border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm); cursor: pointer; align-items: start;
  transition: all var(--transition);
}
.diff-item:hover { background: var(--bg-hover); }
.diff-item.selected { border-color: var(--accent); background: var(--accent-dim); }

.diff-type { font-size: 10px; padding: 2px 6px; border-radius: 8px; font-weight: 600; white-space: nowrap; }
.diff-entity { font-size: 10px; color: var(--text-3); text-transform: uppercase; }
.diff-title { font-size: 13px; font-weight: 500; }
.diff-changes { grid-column: 2 / -1; margin-top: 4px; }
.change-row { display: flex; gap: 6px; font-size: 11px; align-items: center; padding: 2px 0; }
.change-key { color: var(--text-2); min-width: 80px; }
.change-old { color: var(--red); text-decoration: line-through; }
.change-arrow { color: var(--text-3); }
.change-new { color: var(--green); font-weight: 500; }

.archive-option { margin-top: 12px; font-size: 12px; color: var(--text-1); }
.archive-option label { display: flex; align-items: center; gap: 6px; cursor: pointer; }

.review-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-subtle); }
</style>
