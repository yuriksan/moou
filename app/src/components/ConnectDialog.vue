<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../composables/useApi';

const props = defineProps<{
  outcomeId: string;
}>();

const emit = defineEmits<{
  connected: [link: any, asPrimary: boolean];
  cancel: [];
}>();

const query = ref('');
const results = ref<any[]>([]);
const entityTypes = ref<any[]>([]);
const providerLabel = ref('');
const selectedType = ref('');
const searching = ref(false);
const connecting = ref<string | null>(null);
const error = ref('');
const wantPrimary = ref(false);
let debounceTimer: ReturnType<typeof setTimeout>;

// Load entity types on mount
(async () => {
  try {
    const data = await api.getBackendEntityTypes();
    entityTypes.value = data.entityTypes;
    providerLabel.value = data.label;
    const defaultType = data.entityTypes.find((t: any) => t.default);
    if (defaultType) selectedType.value = defaultType.name;
  } catch { /* no adapter */ }
})();

watch(query, (q) => {
  clearTimeout(debounceTimer);
  if (!q.trim()) { results.value = []; return; }
  debounceTimer = setTimeout(async () => {
    searching.value = true;
    error.value = '';
    try {
      const data = await api.searchBackend(q.trim(), selectedType.value || undefined);
      results.value = data.items;
    } catch (err: any) {
      error.value = err.message || 'Search failed';
      results.value = [];
    } finally {
      searching.value = false;
    }
  }, 300);
});

async function connect(item: any) {
  connecting.value = item.entityId;
  error.value = '';
  try {
    const link = await api.connectOutcome(props.outcomeId, item.entityType, item.entityId);
    emit('connected', link, wantPrimary.value);
  } catch (err: any) {
    error.value = err.message || 'Failed to connect';
    connecting.value = null;
  }
}

function stateClass(state: string): string {
  const map: Record<string, string> = {
    open: 'state-open', closed: 'state-closed', merged: 'state-merged', draft: 'state-draft',
  };
  return map[state] || '';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
</script>

<template>
  <div class="connect-dialog">
    <h3 class="font-display dialog-title">Connect to {{ providerLabel || 'Backend' }}</h3>

    <div v-if="error" class="dialog-error">{{ error }}</div>

    <div class="search-row">
      <select v-if="entityTypes.length > 1" v-model="selectedType" class="input type-select">
        <option value="">All types</option>
        <option v-for="t in entityTypes" :key="t.name" :value="t.name">{{ t.label }}</option>
      </select>
      <input v-model="query" class="input search-input" :placeholder="`Search ${providerLabel} items...`" autofocus />
    </div>

    <div v-if="searching" class="searching">Searching...</div>

    <div class="results">
      <div
        v-for="item in results" :key="item.entityId"
        class="result-item"
        @click="connect(item)"
        :class="{ connecting: connecting === item.entityId }"
      >
        <div class="result-head">
          <span class="result-number font-mono">#{{ item.entityId }}</span>
          <span :class="['state-badge', stateClass(item.state)]">{{ item.state }}</span>
          <span class="result-title">{{ item.title }}</span>
          <a v-if="item.htmlUrl" :href="item.htmlUrl" target="_blank" rel="noopener noreferrer"
            class="result-ext-link" title="Open in provider" @click.stop>↗</a>
        </div>
        <div v-if="item.description" class="result-description">{{ stripHtml(item.description).slice(0, 140) }}</div>
        <div class="result-meta">
          <span v-for="label in item.labels?.slice(0, 3)" :key="label.name"
            class="result-label"
            :style="label.color ? { background: `#${label.color}20`, color: `#${label.color}` } : {}"
          >{{ label.name }}</span>
          <span v-if="item.assignee" class="result-assignee">
            <img v-if="item.assignee.avatarUrl" :src="item.assignee.avatarUrl" class="result-avatar" />
            {{ item.assignee.login }}
          </span>
          <span v-if="item.milestone" class="result-milestone font-mono">{{ item.milestone.title }}</span>
        </div>
      </div>

      <div v-if="!searching && query && results.length === 0" class="no-results">
        No matching items found
      </div>
    </div>

    <div class="dialog-actions">
      <label class="primary-checkbox">
        <input type="checkbox" v-model="wantPrimary" />
        Set as primary item
      </label>
      <button class="btn btn-sm" @click="emit('cancel')">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.connect-dialog { padding: 20px 24px; }
.dialog-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
.dialog-error { background: var(--red-dim); color: var(--red); padding: 8px 12px; border-radius: var(--radius-sm); margin-bottom: 10px; font-size: 12px; }

.search-row { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.input {
  font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-1); color: var(--text-0); outline: none; width: 100%;
}
.input:focus { border-color: var(--accent); }
/* Compact, left-aligned dropdown above the full-width search input. */
.search-row .type-select { width: auto; align-self: flex-start; min-width: 160px; }

.searching { font-size: 12px; color: var(--text-3); padding: 12px 0; text-align: center; }

.results { max-height: 400px; overflow-y: auto; }
.result-item {
  padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  margin-bottom: 4px; cursor: pointer; transition: all var(--transition);
}
.result-item:hover { border-color: var(--teal); background: var(--teal-dim); }
.result-item.connecting { opacity: 0.5; pointer-events: none; }

.result-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.result-number { font-size: 12px; color: var(--text-2); font-weight: 600; }
.result-title { font-size: 13px; font-weight: 500; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.result-ext-link { font-size: 11px; color: var(--text-3); text-decoration: none; flex-shrink: 0; }
.result-ext-link:hover { color: var(--teal); }
.result-description { font-size: 12px; color: var(--text-2); margin: 2px 0 4px; line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

.state-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600; text-transform: uppercase; }
.state-open { background: var(--green-dim); color: var(--green); }
.state-closed { background: var(--red-dim); color: var(--red); }
.state-merged { background: var(--purple-dim); color: var(--purple); }
.state-draft { background: var(--bg-3); color: var(--text-2); }

.result-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.result-label { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--bg-3); color: var(--text-2); }
.result-assignee { font-size: 11px; color: var(--text-2); display: flex; align-items: center; gap: 4px; }
.result-avatar { width: 16px; height: 16px; border-radius: 50%; }
.result-milestone { font-size: 10px; color: var(--text-3); background: var(--bg-3); padding: 1px 6px; border-radius: 8px; }

.no-results { padding: 20px; text-align: center; color: var(--text-3); font-size: 13px; }
.dialog-actions { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }
.primary-checkbox { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); cursor: pointer; margin-right: auto; }
</style>
