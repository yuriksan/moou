<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { api } from '../composables/useApi';
import { usePersistedRef } from '../composables/usePersistedRef';
import { useSSE } from '../composables/useSSE';
import { useRoute, useRouter } from 'vue-router';
import { extractId, buildSlugId } from '../composables/useSlug';
import MotivationDetail from '../components/MotivationDetail.vue';
import MotivationForm from '../components/MotivationForm.vue';
import { checkMismatch, type DateMismatch } from '../composables/useDateMismatch';

const route = useRoute();
const router = useRouter();
const { on } = useSSE();

const motivations = ref<any[]>([]);
const total = ref(0);
const tags = ref<any[]>([]);
const selectedMotivationId = ref<string | null>(extractId(route.params.slugId as string));
const showNewMotivation = ref(false);

// Filters — persisted to localStorage, URL query params take precedence on load
const typeFilter = usePersistedRef<string>('motivations.typeFilter', '', (route.query.type as string) || null);
const statusFilter = usePersistedRef<string>('motivations.statusFilter', '');
const tagFilter = usePersistedRef<string[]>('motivations.tagFilter', [], route.query.tags ? (route.query.tags as string).split(',') : null);
const sortBy = usePersistedRef<string>('motivations.sortBy', 'score');

// Tags actually applied to motivations — hides tags only used on outcomes
// so the filter bar never offers a "click here for zero results" option.
const motivationTags = computed(() =>
  tags.value.filter((t: any) => (t.usageMotivations ?? 0) > 0)
);

function toggleTag(name: string) {
  // Reassign rather than mutate so the watcher fires (Vue 3 ref watchers
  // are shallow by default — push/splice would be invisible).
  if (tagFilter.value.includes(name)) {
    tagFilter.value = tagFilter.value.filter(n => n !== name);
  } else {
    tagFilter.value = [...tagFilter.value, name];
  }
}

async function loadMotivations() {
  const params: Record<string, string> = { limit: '100' };
  if (typeFilter.value) params.type = typeFilter.value;
  if (statusFilter.value) params.status = statusFilter.value;
  if (tagFilter.value.length) params.tags = tagFilter.value.join(',');
  const res = await api.getMotivations(params);
  motivations.value = res.data;
  total.value = res.total;
}

async function loadTags() {
  tags.value = await api.getTags();
}

onMounted(() => { loadMotivations(); loadTags(); });
for (const evt of ['motivation_created', 'motivation_updated', 'motivation_deleted', 'motivation_resolved', 'motivation_reopened', 'link_created', 'link_deleted']) {
  on(evt, () => loadMotivations());
}
// Sync filters and selection to URL. Filters → query, selection → path.
watch([typeFilter, statusFilter, tagFilter, selectedMotivationId], () => {
  const query: Record<string, string> = {};
  if (typeFilter.value) query.type = typeFilter.value;
  if (statusFilter.value) query.status = statusFilter.value;
  if (tagFilter.value.length) query.tags = tagFilter.value.join(',');

  let path = '/motivations';
  if (selectedMotivationId.value) {
    const m = motivations.value.find((x: any) => x.id === selectedMotivationId.value);
    path = `/motivations/${buildSlugId(m?.title, selectedMotivationId.value)}`;
  }
  router.replace({ path, query });
}, { immediate: true });

// Filters change → reload data. Selection alone doesn't need a refetch.
watch([typeFilter, statusFilter, tagFilter], () => { loadMotivations(); });

// External URL changes → update local state. Used by tag-link navigation
// from detail panels (router.push to /motivations?tags=foo).
watch(() => route.query.tags, (val) => {
  const next = val ? (val as string).split(',') : [];
  if (JSON.stringify(next) !== JSON.stringify(tagFilter.value)) {
    tagFilter.value = next;
  }
});

// External URL changes (SearchBar, browser back/forward) → update local state.
watch(() => route.params.slugId, (slugId) => {
  selectedMotivationId.value = extractId(slugId as string);
});

// Once motivations finish loading, fill in the slug for an ID-only deep link.
watch(motivations, () => {
  if (selectedMotivationId.value) {
    const m = motivations.value.find((x: any) => x.id === selectedMotivationId.value);
    if (m) {
      const desired = `/motivations/${buildSlugId(m.title, selectedMotivationId.value)}`;
      if (route.path !== desired) router.replace({ path: desired, query: route.query });
    }
  }
});

const sortedMotivations = computed(() => {
  const data = [...motivations.value];
  if (sortBy.value === 'score') data.sort((a, b) => Number(b.score) - Number(a.score));
  else if (sortBy.value === 'outcomes') data.sort((a, b) => b.linkedOutcomeCount - a.linkedOutcomeCount);
  else if (sortBy.value === 'date') data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return data;
});

const typeOptions = ['', 'Customer Demand', 'Compliance', 'Tech Debt', 'Internal Mandate', 'Competitive Gap'];

function getRowMismatch(m: any): DateMismatch | null {
  if (!m.earliestMilestoneDate || !m.attributes) return null;
  return checkMismatch({ title: m.title, attributes: m.attributes }, m.earliestMilestoneDate);
}

function pillClass(typeName: string): string {
  const map: Record<string, string> = {
    'Customer Demand': 'pill-customer',
    'Compliance': 'pill-compliance',
    'Tech Debt': 'pill-techdebt',
    'Internal Mandate': 'pill-mandate',
    'Competitive Gap': 'pill-competitive',
  };
  return map[typeName] || '';
}
</script>

<template>
  <div class="motivations-view" :class="{ 'has-detail': selectedMotivationId || showNewMotivation }">
    <div class="list-area">
      <!-- Filters -->
      <div class="filter-bar">
        <span class="filter-label">Type</span>
        <button
          v-for="opt in typeOptions" :key="opt"
          :class="['filter-btn', { active: typeFilter === opt }]"
          @click="typeFilter = opt"
        >{{ opt || 'All' }}</button>

        <span class="filter-sep"></span>
        <span class="filter-label">Status</span>
        <button :class="['filter-btn', { active: statusFilter === '' }]" @click="statusFilter = ''">All</button>
        <button :class="['filter-btn', { active: statusFilter === 'active' }]" @click="statusFilter = 'active'">Active</button>
        <button :class="['filter-btn', { active: statusFilter === 'resolved' }]" @click="statusFilter = 'resolved'">Resolved</button>

        <span class="filter-sep"></span>
        <span class="filter-label">Sort</span>
        <button :class="['filter-btn', { active: sortBy === 'score' }]" @click="sortBy = 'score'">Score</button>
        <button :class="['filter-btn', { active: sortBy === 'outcomes' }]" @click="sortBy = 'outcomes'">Outcomes</button>
        <button :class="['filter-btn', { active: sortBy === 'date' }]" @click="sortBy = 'date'">Date</button>
        <button class="btn btn-sm btn-primary" style="margin-left:auto" @click="showNewMotivation = true; selectedMotivationId = null">+ Motivation</button>
      </div>

      <!-- Tag filter (only tags actually applied to motivations) -->
      <div v-if="motivationTags.length" class="filter-bar tag-filter-bar">
        <span class="filter-label">Tags</span>
        <span
          v-for="tag in motivationTags" :key="tag.id"
          :class="['tag', { 'filter-active': tagFilter.includes(tag.name) }]"
          :style="{ background: (tag.colour || '#888') + '15', color: tag.colour || '#888' }"
          @click="toggleTag(tag.name)"
        >{{ tag.emoji }} {{ tag.name }}</span>
        <button v-if="tagFilter.length" class="btn btn-sm" @click="tagFilter = []">Clear</button>
      </div>

      <!-- Header -->
      <div class="list-header">
        <span class="col-flag"></span>
        <span class="col-title">Motivation</span>
        <span class="col-type">Type</span>
        <span class="col-score">Score</span>
        <span class="col-outcomes">Outcomes</span>
        <span class="col-creator">Creator</span>
      </div>

      <!-- Rows -->
      <div class="list-body">
        <div
          v-for="m in sortedMotivations" :key="m.id"
          :class="['motivation-row', { selected: m.id === selectedMotivationId }]"
          @click="selectedMotivationId = selectedMotivationId === m.id ? null : m.id"
        >
          <span class="col-flag">
            <span v-if="getRowMismatch(m)?.level === 'critical'" class="mismatch-dot mismatch-dot-critical" :title="getRowMismatch(m)!.message"></span>
            <span v-else-if="getRowMismatch(m)?.level === 'warning'" class="mismatch-dot mismatch-dot-warning" :title="getRowMismatch(m)!.message"></span>
          </span>
          <div class="col-title">
            <div class="row-title">{{ m.title }}</div>
            <div class="row-subtitle" v-if="m.notes">{{ m.notes }}</div>
          </div>
          <span :class="['col-type motivation-pill', pillClass(m.typeName)]">{{ m.typeName }}</span>
          <span class="col-score font-mono" :class="Number(m.score) > 1000 ? 'score-high' : Number(m.score) > 100 ? 'score-mid' : 'score-low'">
            {{ Number(m.score).toLocaleString('en', { maximumFractionDigits: 0 }) }}
          </span>
          <span class="col-outcomes font-mono">{{ m.linkedOutcomeCount }}</span>
          <span class="col-creator">{{ m.createdBy }}</span>
        </div>
        <div v-if="sortedMotivations.length === 0" class="empty">No motivations match filters</div>
      </div>
    </div>

    <aside v-if="showNewMotivation" class="side-panel">
      <MotivationForm
        @saved="() => { showNewMotivation = false; loadMotivations(); }"
        @cancel="showNewMotivation = false"
      />
    </aside>
    <MotivationDetail
      v-else-if="selectedMotivationId"
      :motivation-id="selectedMotivationId"
      @close="selectedMotivationId = null"
      @updated="loadMotivations"
      @navigate-outcome="(o: { id: string; title: string }) => { router.push(`/outcomes/${buildSlugId(o.title, o.id)}`); }"
    />
  </div>
</template>

<style scoped>
.motivations-view {
  display: grid;
  grid-template-columns: 1fr;
  height: 100%;
  overflow: hidden;
}
.motivations-view.has-detail {
  grid-template-columns: 1fr 480px;
}
.side-panel {
  border-left: 1px solid var(--border);
  background: var(--bg-1);
  overflow-y: auto;
  animation: slideIn 250ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes slideIn {
  from { transform: translateX(30px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.list-area {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Filters */
.filter-bar {
  display: flex;
  align-items: center;
  padding: 10px 24px;
  gap: 6px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-1);
  flex-wrap: wrap;
}
.filter-label { font-size: 10px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.8px; margin-right: 2px; }
.filter-btn {
  font-family: 'DM Sans', sans-serif;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 12px;
  background: var(--bg-3);
  color: var(--text-2);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all var(--transition);
}
.filter-btn:hover { color: var(--text-1); }
.filter-btn.active { color: var(--text-0); border-color: var(--text-0); background: var(--bg-hover); }
.filter-sep { width: 1px; height: 18px; background: var(--border); margin: 0 4px; }

/* List */
.list-header {
  display: grid;
  grid-template-columns: 20px 1fr 120px 100px 80px 100px;
  gap: 12px;
  padding: 8px 24px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 1px;
  border-bottom: 1px solid var(--border-subtle);
}
.list-body { flex: 1; overflow-y: auto; }
.motivation-row {
  display: grid;
  grid-template-columns: 20px 1fr 120px 100px 80px 100px;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background var(--transition);
  align-items: center;
}
.motivation-row:hover { background: var(--bg-hover); }
.motivation-row.selected { background: var(--accent-dim); border-left: 2px solid var(--teal); padding-left: 22px; }

.row-title { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-subtitle { font-size: 11px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.col-score { text-align: right; font-weight: 600; }
.score-high { color: var(--accent); }
.score-mid { color: var(--teal); }
.score-low { color: var(--text-2); }
.col-outcomes { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-2); }

.col-creator { font-size: 11px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.col-flag { display: flex; align-items: center; justify-content: center; }
.mismatch-dot { width: 8px; height: 8px; border-radius: 50%; }
.mismatch-dot-critical { background: var(--red); }
.mismatch-dot-warning { background: var(--accent); }
.empty { padding: 40px; text-align: center; color: var(--text-3); font-size: 14px; }
</style>
