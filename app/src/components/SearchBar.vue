<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../composables/useApi';
import { buildSlugId } from '../composables/useSlug';

const wrapRef = ref<HTMLElement | null>(null);

function handleClickOutside(event: Event) {
  if (wrapRef.value && !wrapRef.value.contains(event.target as Node)) {
    close();
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside));
onUnmounted(() => document.removeEventListener('click', handleClickOutside));

const router = useRouter();
const query = ref('');
const results = ref<{ outcomes: any[]; motivations: any[]; tags: any[] } | null>(null);
const showResults = ref(false);
const searching = ref(false);
let debounceTimer: ReturnType<typeof setTimeout>;

watch(query, (q) => {
  clearTimeout(debounceTimer);
  if (!q.trim()) { results.value = null; showResults.value = false; return; }
  debounceTimer = setTimeout(async () => {
    searching.value = true;
    try {
      results.value = await api.search(q.trim());
      showResults.value = true;
    } finally {
      searching.value = false;
    }
  }, 250);
});

function navigateOutcome(o: { id: string; title: string }) {
  router.push(`/outcomes/${buildSlugId(o.title, o.id)}`);
  close();
}

function navigateMotivation(m: { id: string; title: string }) {
  router.push(`/motivations/${buildSlugId(m.title, m.id)}`);
  close();
}

function close() {
  showResults.value = false;
  query.value = '';
  results.value = null;
}

const totalResults = () => {
  if (!results.value) return 0;
  return results.value.outcomes.length + results.value.motivations.length + results.value.tags.length;
};

function pillClass(typeName: string): string {
  const map: Record<string, string> = {
    'Customer Demand': 'pill-customer', 'Compliance': 'pill-compliance',
    'Tech Debt': 'pill-techdebt', 'Internal Mandate': 'pill-mandate',
    'Competitive Gap': 'pill-competitive',
  };
  return map[typeName] || '';
}
</script>

<template>
  <div class="search-wrap" ref="wrapRef">
    <div class="search-input-wrap">
      <span class="search-icon">⌕</span>
      <input
        v-model="query"
        class="search-input"
        placeholder="Search outcomes, motivations, tags..."
        @focus="results && (showResults = true)"
        @keyup.escape="close"
      />
      <span v-if="searching" class="search-spinner">...</span>
    </div>

    <div v-if="showResults && results" class="search-results">
      <div v-if="totalResults() === 0" class="search-empty">No results for "{{ query }}"</div>

      <div v-if="results.outcomes.length" class="result-group">
        <div class="result-group-title">Outcomes</div>
        <div
          v-for="o in results.outcomes" :key="o.id"
          class="result-item"
          @click="navigateOutcome(o)"
        >
          <span class="result-title">{{ o.title }}</span>
          <span class="result-meta font-mono">{{ Number(o.priorityScore).toFixed(0) }}</span>
          <span :class="['status-badge', `status-${o.status}`]">{{ o.status }}</span>
        </div>
      </div>

      <div v-if="results.motivations.length" class="result-group">
        <div class="result-group-title">Motivations</div>
        <div
          v-for="m in results.motivations" :key="m.id"
          class="result-item"
          @click="navigateMotivation(m)"
        >
          <span :class="['motivation-pill', pillClass(m.typeName)]" style="font-size:9px">{{ m.typeName }}</span>
          <span class="result-title">{{ m.title }}</span>
          <span class="result-meta font-mono">{{ Number(m.score).toFixed(0) }}</span>
        </div>
      </div>

      <div v-if="results.tags.length" class="result-group">
        <div class="result-group-title">Tags</div>
        <div v-for="t in results.tags" :key="t.id" class="result-item result-tag">
          <span class="tag" :style="{ background: (t.colour || '#888') + '15', color: t.colour || '#888' }">
            {{ t.emoji }} {{ t.name }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>


<style scoped>
.search-wrap { position: relative; }
.search-input-wrap {
  display: flex;
  align-items: center;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0 10px;
  gap: 6px;
  transition: border-color var(--transition);
}
.search-input-wrap:focus-within { border-color: var(--accent); }
.search-icon { color: var(--text-3); font-size: 14px; }
.search-spinner { color: var(--text-3); font-size: 11px; }
.search-input {
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  border: none;
  background: none;
  color: var(--text-0);
  outline: none;
  width: 220px;
  padding: 6px 0;
}
.search-input::placeholder { color: var(--text-3); }

.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,0.1);
  z-index: 200;
  max-height: 400px;
  overflow-y: auto;
  min-width: 360px;
}

.search-empty { padding: 16px; text-align: center; color: var(--text-3); font-size: 13px; }

.result-group { padding: 4px 0; }
.result-group + .result-group { border-top: 1px solid var(--border-subtle); }
.result-group-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 6px 12px 4px;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background var(--transition);
}
.result-item:hover { background: var(--bg-hover); }
.result-title { font-size: 13px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.result-meta { font-size: 11px; font-weight: 600; color: var(--accent); }
.result-tag { padding: 6px 12px; }
</style>
