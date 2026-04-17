<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../composables/useApi';
import MotivationForm from './MotivationForm.vue';
import { checkMismatch, type DateMismatch } from '../composables/useDateMismatch';
import { formatHistory } from '../composables/useHistoryFormatter';

const router = useRouter();

/**
 * Tag chip click → navigate to the Motivations list filtered by that tag.
 * Mirrors the OutcomeDetail behaviour but lands on /motivations since
 * we're inside a motivation context.
 */
function navigateToTag(name: string) {
  router.push({ path: '/motivations', query: { tags: name } });
}

const props = defineProps<{
  motivationId: string;
}>();

const emit = defineEmits<{
  close: [];
  updated: [];
  navigateOutcome: [outcome: { id: string; title: string }];
}>();

const motivation = ref<any>(null);
const history = ref<any[]>([]);
const showAllHistory = ref(false);
const loading = ref(true);
const editing = ref(false);
const showScoreInfo = ref(false);
const motivationFormRef = ref<any>(null);
const outcomeMismatches = ref<Map<string, DateMismatch | null>>(new Map());

// Formatted history — drops noise-only entries (e.g. updatedAt + score
// auto-changes) and turns each remaining entry into a short verb phrase.
const displayHistory = computed(() => formatHistory(history.value));

async function load() {
  loading.value = true;
  try {
    const [m, h] = await Promise.all([
      api.getMotivation(props.motivationId),
      api.getMotivationHistory(props.motivationId, { limit: '10' }),
    ]);
    motivation.value = m;
    history.value = h.data;

    // Check date mismatches for each linked outcome's milestone
    const mm = new Map<string, DateMismatch | null>();
    if (m.outcomes && m.attributes) {
      for (const o of m.outcomes) {
        if (o.milestoneDate) {
          mm.set(o.id, checkMismatch({ title: m.title, attributes: m.attributes }, o.milestoneDate));
        } else {
          mm.set(o.id, null);
        }
      }
    }
    outcomeMismatches.value = mm;
  } finally {
    loading.value = false;
  }
}

watch(() => props.motivationId, () => { editing.value = false; load(); });

async function deleteMotivation() {
  const linked = motivation.value?.outcomes?.length || 0;
  const msg = linked > 0
    ? `This motivation is linked to ${linked} outcome(s). Deleting will remove all links and affect their scores. Continue?`
    : 'Delete this motivation? This cannot be undone.';
  if (!confirm(msg)) return;
  // Unlink from all outcomes first
  if (linked > 0) {
    for (const o of motivation.value.outcomes) {
      await api.unlinkMotivation(props.motivationId, o.id);
    }
  }
  // Hard delete via API — need to add this endpoint
  try {
    await api.deleteMotivation(props.motivationId);
  } catch {
    // If hard delete not supported, resolve instead
    await api.resolveMotivation(props.motivationId);
  }
  emit('updated');
  emit('close');
}
onMounted(load);

async function onEditSaved() {
  editing.value = false;
  emit('updated');
  await load();
}

async function resolve() {
  await api.resolveMotivation(props.motivationId);
  emit('updated');
  await load();
}

async function reopen() {
  await api.reopenMotivation(props.motivationId);
  emit('updated');
  await load();
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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAttrKey(key: string): string {
  return key.replace(/_/g, ' ');
}

function formatAttrValue(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (typeof value === 'number') {
    if (value >= 1000) return value.toLocaleString('en');
    return String(value);
  }
  return String(value ?? '—');
}
</script>

<template>
  <aside class="detail-panel">
    <div v-if="loading" class="loading">Loading...</div>
    <template v-else-if="motivation">
      <!-- Header -->
      <div class="detail-header">
        <div class="header-top">
          <button class="close-btn" @click="emit('close')">×</button>
          <div class="header-info">
            <h2 class="detail-title font-display editable-field" title="Click to edit" @click="editing = true">{{ motivation.title }}</h2>
            <div class="header-meta">
              <span :class="['motivation-pill', pillClass(motivation.typeName)]">{{ motivation.typeName }}</span>
              <span v-if="motivation.status === 'resolved'" class="status-badge status-completed">Resolved</span>
              <span
                v-for="tag in motivation.tags" :key="tag.id"
                class="tag clickable-tag"
                :style="{ background: (tag.colour || '#888') + '15', color: tag.colour || '#888' }"
                :title="`Show motivations tagged ${tag.name}`"
                @click="navigateToTag(tag.name)"
              >{{ tag.emoji }} {{ tag.name }}</span>
            </div>
          </div>
        </div>
        <div class="header-actions">
          <template v-if="editing">
            <button class="btn btn-sm" @click="editing = false">Cancel</button>
            <button class="btn btn-sm btn-primary" @click="motivationFormRef?.save()">Save Changes</button>
          </template>
          <template v-else>
            <button class="btn btn-sm" @click="editing = true">Edit</button>
            <button v-if="motivation.status === 'active'" class="btn btn-sm" @click="resolve">Resolve</button>
            <button v-if="motivation.status === 'resolved'" class="btn btn-sm" @click="reopen">Reopen</button>
            <button class="btn btn-sm btn-danger" @click="deleteMotivation">Delete</button>
          </template>
        </div>
      </div>

      <!-- Edit Form -->
      <MotivationForm
        v-if="editing"
        ref="motivationFormRef"
        :motivation="motivation"
        :hide-actions="true"
        @saved="onEditSaved"
        @cancel="editing = false"
      />

      <!-- Score (read mode) -->
      <section v-if="!editing" class="section">
        <h3 class="section-title">Score</h3>
        <div class="score-display">
          <span class="score-value font-display">{{ Number(motivation.score).toLocaleString('en', { maximumFractionDigits: 0 }) }}</span>
          <button type="button" class="score-label score-info-toggle" :aria-expanded="showScoreInfo" aria-controls="score-info-panel" @click="showScoreInfo = !showScoreInfo">
            {{ showScoreInfo ? 'hide breakdown' : 'how is this calculated?' }}
          </button>
        </div>
        <div v-if="showScoreInfo" id="score-info-panel" class="score-info">
          <p v-if="motivation.scoringDescription" class="score-info-desc">{{ motivation.scoringDescription }}</p>
          <code v-if="motivation.scoringFormula" class="score-info-formula">{{ motivation.scoringFormula }}</code>
        </div>
      </section>

      <!-- Attributes -->
      <section v-if="!editing" class="section editable-section" @click="editing = true" title="Click to edit">
        <h3 class="section-title">Attributes</h3>
        <div class="attrs">
          <div v-for="(value, key) in (motivation.attributes || {})" :key="key" class="attr-row">
            <span class="attr-key">{{ formatAttrKey(key as string) }}</span>
            <span class="attr-value font-mono">{{ formatAttrValue(value) }}</span>
          </div>
        </div>
      </section>

      <!-- Notes -->
      <section v-if="!editing && motivation.notes" class="section editable-section" @click="editing = true" title="Click to edit">
        <h3 class="section-title">Notes</h3>
        <div class="notes-text">{{ motivation.notes }}</div>
      </section>

      <!-- Linked Outcomes -->
      <section class="section">
        <h3 class="section-title">Linked Outcomes ({{ motivation.outcomes?.length || 0 }})</h3>
        <div
          v-for="o in motivation.outcomes" :key="o.id"
          :class="['outcome-card', outcomeMismatches.get(o.id)?.level === 'critical' ? 'card-mismatch-critical' : outcomeMismatches.get(o.id)?.level === 'warning' ? 'card-mismatch-warning' : '']"
          @click="emit('navigateOutcome', { id: o.id, title: o.title })"
        >
          <div class="outcome-card-head">
            <span v-if="outcomeMismatches.get(o.id)" :class="['mismatch-dot', `mismatch-dot-${outcomeMismatches.get(o.id)!.level}`]" :title="outcomeMismatches.get(o.id)!.message"></span>
            <span class="outcome-card-title">{{ o.title }}</span>
            <span v-if="o.milestoneName" class="outcome-card-milestone">{{ o.milestoneName }}</span>
            <span class="outcome-card-score font-mono">{{ Number(o.priorityScore).toFixed(0) }}</span>
          </div>
          <div class="outcome-card-row2">
            <span :class="['status-badge', `status-${o.status}`]">{{ o.status }}</span>
            <span v-if="outcomeMismatches.get(o.id)" class="mismatch-info-sm">
              {{ outcomeMismatches.get(o.id)!.message }}
            </span>
          </div>
        </div>
        <div v-if="!motivation.outcomes?.length" class="empty">Not linked to any outcomes</div>
      </section>

      <!-- History -->
      <section class="section">
        <h3 class="section-title">History ({{ displayHistory.length }})</h3>
        <div
          v-for="row in (showAllHistory ? displayHistory : displayHistory.slice(0, 3))"
          :key="row.entry.id"
          class="history-item"
        >
          <span class="history-dot"></span>
          <span class="history-text"><strong>{{ row.entry.changedBy }}</strong> {{ row.text }}</span>
          <span class="history-time font-mono">{{ timeAgo(row.entry.changedAt) }}</span>
        </div>
        <div v-if="displayHistory.length === 0" class="empty">No changes yet</div>
        <button
          v-if="displayHistory.length > 3 && !showAllHistory"
          class="btn btn-sm show-more"
          @click="showAllHistory = true"
        >Show {{ displayHistory.length - 3 }} more</button>
      </section>
    </template>
  </aside>
</template>

<style scoped>
.detail-panel {
  border-left: 1px solid var(--border);
  background: var(--bg-1);
  overflow-y: auto;
  animation: slideIn 250ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes slideIn {
  from { transform: translateX(30px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

.loading { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--text-3); }

.detail-header {
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg-1);
  z-index: 10;
}
.header-top { display: flex; gap: 12px; }
.close-btn {
  width: 28px; height: 28px; border-radius: var(--radius-sm);
  background: var(--bg-3); border: none; color: var(--text-2);
  cursor: pointer; font-size: 16px; flex-shrink: 0;
}
.close-btn:hover { background: var(--bg-hover); color: var(--text-0); }
.header-info { flex: 1; min-width: 0; }
.detail-title { font-size: 18px; font-weight: 700; line-height: 1.3; }
.editable-field { cursor: pointer; }
.editable-field:hover { opacity: 0.75; }
.editable-section { cursor: pointer; }
.editable-section:hover { background: var(--bg-hover); }
.header-meta { display: flex; gap: 6px; margin-top: 6px; align-items: center; flex-wrap: wrap; }
.header-actions { display: flex; gap: 6px; margin-top: 10px; }
.btn-danger { border-color: var(--red); color: var(--red); background: var(--red-dim); }
.btn-danger:hover { background: #c43c3c20; }

.section { padding: 16px 24px; border-bottom: 1px solid var(--border-subtle); }
.section-title { font-size: 10px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }

/* Score */
.score-display { display: flex; align-items: baseline; gap: 8px; }
.score-value { font-size: 24px; font-weight: 800; color: var(--accent); }
.score-label { font-size: 12px; color: var(--text-3); }
.score-info-toggle { cursor: pointer; text-decoration: underline; text-decoration-style: dotted; background: none; border: none; padding: 0; font: inherit; }
.score-info-toggle:hover { color: var(--accent); }
.score-info { margin-top: 8px; padding: 10px 12px; background: var(--bg-2); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); }
.score-info-desc { font-size: 12px; color: var(--text-1); margin: 0 0 6px; line-height: 1.5; }
.score-info-formula { font-size: 11px; color: var(--text-3); display: block; word-break: break-all; }

/* Attributes */
.attr-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-subtle); }
.attr-key { font-size: 12px; color: var(--text-2); text-transform: capitalize; }
.attr-value { font-size: 12px; color: var(--text-0); }

/* Notes */
.notes-text { font-size: 13px; color: var(--text-1); line-height: 1.65; white-space: pre-wrap; }

/* Outcome cards */
.outcome-card {
  background: var(--bg-2); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 10px 12px;
  margin-bottom: 6px; cursor: pointer; transition: all var(--transition);
}
.outcome-card:hover { border-color: var(--text-3); background: var(--bg-3); }
.outcome-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.outcome-card-title { font-size: 13px; font-weight: 500; }
.outcome-card-score { font-size: 12px; font-weight: 600; color: var(--accent); }

/* History */
.history-item { display: flex; gap: 10px; padding: 6px 0; font-size: 12px; align-items: flex-start; }
.history-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--border); margin-top: 5px; flex-shrink: 0; }
.history-text { color: var(--text-2); flex: 1; }
.history-text strong { color: var(--text-1); font-weight: 500; }
.history-time { font-size: 10px; color: var(--text-3); flex-shrink: 0; }
.show-more { width: 100%; margin-top: 8px; text-align: center; }

/* Mismatch indicators */
.card-mismatch-critical { border-left: 3px solid var(--red); }
.card-mismatch-warning { border-left: 3px solid var(--accent); }
.mismatch-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.mismatch-dot-critical { background: var(--red); }
.mismatch-dot-warning { background: var(--accent); }
.mismatch-info-sm { font-size: 10px; color: var(--red); margin-left: 8px; }
.card-mismatch-warning .mismatch-info-sm { color: var(--accent); }
.outcome-card-milestone { font-size: 10px; color: var(--text-3); background: var(--bg-3); padding: 1px 6px; border-radius: 8px; }
.outcome-card-row2 { display: flex; align-items: center; margin-top: 4px; }

.empty { font-size: 12px; color: var(--text-3); padding: 8px 0; }
</style>
