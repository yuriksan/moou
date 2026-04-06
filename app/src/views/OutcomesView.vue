<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../composables/useApi';
import { useSSE } from '../composables/useSSE';
import { extractId, buildSlugId } from '../composables/useSlug';
import OutcomeDetail from '../components/OutcomeDetail.vue';
import OutcomeForm from '../components/OutcomeForm.vue';
import type { MismatchLevel } from '../composables/useDateMismatch';

const route = useRoute();
const router = useRouter();
const { on } = useSSE();
const showNewOutcome = ref(false);

const outcomes = ref<any[]>([]);
const tags = ref<any[]>([]);
const total = ref(0);
// Selection lives in the path segment (e.g. /outcomes/upgrade-postgres-{uuid}).
// We always store the bare UUID locally; the slug is just decoration in the URL.
const selectedOutcomeId = ref<string | null>(extractId(route.params.slugId as string));

// Filters — read from URL query params (filters stay in query, selection moves to path)
const statusFilter = ref<string>((route.query.status as string) || 'active,approved');
const tagFilter = ref<string[]>(route.query.tags ? (route.query.tags as string).split(',') : []);
const search = ref((route.query.q as string) || '');

async function loadOutcomes() {
  const params: Record<string, string> = { limit: '100' };
  if (statusFilter.value) params.status = statusFilter.value;
  if (tagFilter.value.length) params.tags = tagFilter.value.join(',');
  const res = await api.getOutcomes(params);
  outcomes.value = res.data;
  total.value = res.total;
}

async function loadTags() {
  tags.value = await api.getTags();
}

onMounted(() => { loadOutcomes(); loadTags(); });
for (const evt of ['outcome_created', 'outcome_updated', 'outcome_deleted', 'link_created', 'link_deleted', 'motivation_resolved']) {
  on(evt, () => loadOutcomes());
}

// Sync filters and selection to URL so refresh restores the same view.
// Filters live in the query string; selection lives in the path as `/outcomes/{slug}-{uuid}`.
watch([statusFilter, tagFilter, search, selectedOutcomeId], () => {
  const query: Record<string, string> = {};
  if (statusFilter.value && statusFilter.value !== 'active,approved') query.status = statusFilter.value;
  if (tagFilter.value.length) query.tags = tagFilter.value.join(',');
  if (search.value) query.q = search.value;

  let path = '/outcomes';
  if (selectedOutcomeId.value) {
    const o = outcomes.value.find((x: any) => x.id === selectedOutcomeId.value);
    path = `/outcomes/${buildSlugId(o?.title, selectedOutcomeId.value)}`;
  }
  router.replace({ path, query });
});

// Filters change → reload data. Selection alone doesn't need a refetch.
watch([statusFilter, tagFilter], () => { loadOutcomes(); });

// External URL changes (SearchBar, browser back/forward) → update local state.
// Vue refs dedupe identical values so this doesn't loop with the watcher above.
watch(() => route.params.slugId, (slugId) => {
  selectedOutcomeId.value = extractId(slugId as string);
});

// When outcomes finish loading, the URL slug for the currently-selected one
// may have started life ID-only (e.g. arrived from SearchBar). Re-fire the
// state→URL watcher by nudging the ref so the slug fills in.
watch(outcomes, () => {
  if (selectedOutcomeId.value) {
    const o = outcomes.value.find((x: any) => x.id === selectedOutcomeId.value);
    if (o) {
      const desired = `/outcomes/${buildSlugId(o.title, selectedOutcomeId.value)}`;
      if (route.path !== desired) router.replace({ path: desired, query: route.query });
    }
  }
});

const filteredOutcomes = computed(() => {
  if (!search.value.trim()) return outcomes.value;
  const q = search.value.toLowerCase();
  return outcomes.value.filter(o =>
    o.title.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q)
  );
});

// Tags actually applied to outcomes — hides EMEA/compliance/etc. that exist
// in the system but only on motivations, so the filter bar never offers a
// "click here for zero results" option.
const outcomeTags = computed(() =>
  tags.value.filter((t: any) => (t.usageOutcomes ?? 0) > 0)
);

// Summary stats
const summaryStats = computed(() => {
  const data = filteredOutcomes.value;
  const effortCounts: Record<string, number> = {};
  for (const o of data) {
    if (o.effort) effortCounts[o.effort] = (effortCounts[o.effort] || 0) + 1;
  }
  return {
    total: data.length,
    motivations: data.reduce((sum: number, o: any) => sum + (o.motivationCount || 0), 0),
    effort: effortCounts,
  };
});

const statusOptions = [
  { value: 'active,approved', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'completed', label: 'Completed' },
  { value: '', label: 'All' },
];

function toggleTag(name: string) {
  // Reassign rather than mutate so the array-of-sources watcher fires.
  // Vue 3 watchers on a ref are shallow by default — push/splice would not
  // trigger them, leaving the URL stale and no list reload.
  if (tagFilter.value.includes(name)) {
    tagFilter.value = tagFilter.value.filter(n => n !== name);
  } else {
    tagFilter.value = [...tagFilter.value, name];
  }
}

function effortClass(effort: string | null) {
  return effort ? `effort-${effort.toLowerCase()}` : '';
}

function outcomeMismatchLevel(o: any): MismatchLevel | null {
  if (!o.milestoneDate || !o.earliestMotivationDate) return null;
  const motTime = new Date(o.earliestMotivationDate).getTime();
  const msTime = new Date(o.milestoneDate).getTime();
  const diffDays = Math.floor((msTime - motTime) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return null;
  return diffDays > 90 ? 'critical' : 'warning';
}
</script>

<template>
  <div class="outcomes-view" :class="{ 'has-detail': selectedOutcomeId || showNewOutcome }">
    <div class="list-area">
      <!-- Summary Strip -->
      <div class="summary-strip">
        <div class="stat">
          <span class="stat-label">Outcomes</span>
          <span class="stat-value font-display">{{ summaryStats.total }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Motivations</span>
          <span class="stat-value font-display">{{ summaryStats.motivations }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Effort</span>
          <div class="stat-effort">
            <span v-for="(count, size) in summaryStats.effort" :key="size" :class="['effort-badge', effortClass(size as string)]">
              {{ size }}×{{ count }}
            </span>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="filter-bar">
        <span class="filter-label">Status</span>
        <button
          v-for="opt in statusOptions" :key="opt.value"
          :class="['filter-btn', { active: statusFilter === opt.value }]"
          @click="statusFilter = opt.value"
        >{{ opt.label }}</button>

        <span class="filter-sep"></span>
        <span class="filter-label">Tags</span>
        <!-- Only show tags that are actually applied to at least one outcome,
             so clicking a tag never returns an empty list. -->
        <span
          v-for="tag in outcomeTags" :key="tag.id"
          :class="['tag', { 'filter-active': tagFilter.includes(tag.name) }]"
          :style="{ background: (tag.colour || '#888') + '15', color: tag.colour || '#888' }"
          @click="toggleTag(tag.name)"
        >{{ tag.emoji }} {{ tag.name }}</span>

        <input v-model="search" placeholder="Search..." class="search-input" />
        <button class="btn btn-sm btn-primary" @click="showNewOutcome = true; selectedOutcomeId = null">+ Outcome</button>
      </div>

      <!-- Header -->
      <div class="list-header">
        <span class="col-flag"></span>
        <span class="col-rank">#</span>
        <span class="col-title">Outcome</span>
        <span class="col-score">Score</span>
        <span class="col-effort">Effort</span>
        <span class="col-motivations">Motivations</span>
        <span class="col-status">Status</span>
      </div>

      <!-- Rows -->
      <div class="list-body">
        <div
          v-for="(o, i) in filteredOutcomes" :key="o.id"
          :class="['outcome-row', { selected: o.id === selectedOutcomeId }]"
          @click="selectedOutcomeId = selectedOutcomeId === o.id ? null : o.id"
        >
          <span class="col-flag">
            <span v-if="outcomeMismatchLevel(o) === 'critical'" class="mismatch-dot mismatch-dot-critical" title="Motivation date >90 days before milestone"></span>
            <span v-else-if="outcomeMismatchLevel(o) === 'warning'" class="mismatch-dot mismatch-dot-warning" title="Motivation date before milestone"></span>
          </span>
          <span :class="['col-rank font-mono', i < 3 ? `rank-${i+1}` : '']">{{ o.pinned ? '📌' : `#${i+1}` }}</span>
          <div class="col-title">
            <div class="row-title">{{ o.title }}</div>
          </div>
          <span class="col-score font-mono" :class="Number(o.priorityScore) > 1000 ? 'score-high' : Number(o.priorityScore) > 100 ? 'score-mid' : 'score-low'">
            {{ Number(o.priorityScore).toLocaleString('en', { maximumFractionDigits: 0 }) }}
          </span>
          <span class="col-effort">
            <span v-if="o.effort" :class="['effort-badge', effortClass(o.effort)]">{{ o.effort }}</span>
          </span>
          <span class="col-motivations font-mono">{{ o.motivationCount || 0 }}</span>
          <span :class="['col-status status-badge', `status-${o.status}`]">{{ o.status }}</span>
        </div>
        <div v-if="filteredOutcomes.length === 0" class="empty">No outcomes match filters</div>
      </div>
    </div>

    <aside v-if="showNewOutcome" class="side-panel">
      <OutcomeForm
        @saved="(o: any) => { showNewOutcome = false; selectedOutcomeId = o.id; loadOutcomes(); }"
        @cancel="showNewOutcome = false"
      />
    </aside>
    <OutcomeDetail
      v-else-if="selectedOutcomeId"
      :outcome-id="selectedOutcomeId"
      @close="selectedOutcomeId = null"
      @updated="loadOutcomes"
    />
  </div>
</template>

<style scoped>
.outcomes-view {
  display: grid;
  grid-template-columns: 1fr;
  height: 100%;
  overflow: hidden;
}
.outcomes-view.has-detail {
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

/* Summary */
.summary-strip {
  display: flex;
  gap: 1px;
  background: var(--border-subtle);
  border-bottom: 1px solid var(--border);
}
.stat {
  flex: 1;
  padding: 10px 16px;
  background: var(--bg-1);
}
.stat:first-child { padding-left: 24px; }
.stat-label { font-size: 10px; font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.5px; display: block; }
.stat-value { font-size: 20px; font-weight: 800; line-height: 1.2; }
.stat-effort { display: flex; gap: 4px; margin-top: 4px; }

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
.filter-active { border-color: var(--text-0) !important; box-shadow: 0 0 0 1px var(--text-0); }
.search-input {
  margin-left: auto;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-1);
  color: var(--text-0);
  width: 180px;
  outline: none;
}
.search-input:focus { border-color: var(--accent); }

/* List */
.list-header {
  display: grid;
  grid-template-columns: 20px 40px 1fr 100px 60px 90px 80px;
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
.outcome-row {
  display: grid;
  grid-template-columns: 20px 40px 1fr 100px 60px 90px 80px;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background var(--transition);
  align-items: center;
}
.outcome-row:hover { background: var(--bg-hover); }
.outcome-row.selected { background: var(--accent-dim); border-left: 2px solid var(--accent); padding-left: 22px; }

.col-rank { font-size: 13px; font-weight: 600; color: var(--text-3); }
.rank-1 { color: var(--accent); }
.rank-2 { color: var(--text-1); }
.rank-3 { color: var(--text-2); }
.row-title { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.col-score { text-align: right; font-weight: 600; }
.score-high { color: var(--accent); }
.score-mid { color: var(--teal); }
.score-low { color: var(--text-2); }
.col-effort { text-align: center; }
.col-motivations { text-align: center; font-size: 12px; color: var(--text-2); }
.col-status { text-align: center; }
.col-flag { display: flex; align-items: center; justify-content: center; }
.mismatch-dot { width: 8px; height: 8px; border-radius: 50%; }
.mismatch-dot-critical { background: var(--red); }
.mismatch-dot-warning { background: var(--accent); }
.empty { padding: 40px; text-align: center; color: var(--text-3); font-size: 14px; }
</style>
