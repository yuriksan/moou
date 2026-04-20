<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../composables/useApi';
import { usePersistedRef } from '../composables/usePersistedRef';
import { useSSE } from '../composables/useSSE';
import { extractId, buildSlugId } from '../composables/useSlug';
import OutcomeDetail from '../components/OutcomeDetail.vue';
import OutcomeForm from '../components/OutcomeForm.vue';
import ImportReview from '../components/ImportReview.vue';
import type { MismatchLevel } from '../composables/useDateMismatch';

const route = useRoute();
const router = useRouter();

const milestones = ref<any[]>([]);
const outcomes = ref<any[]>([]);
const tags = ref<any[]>([]);
const importDiffs = ref<any[] | null>(null);
const importSummary = ref<any>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const selectedOutcomeId = ref<string | null>(extractId(route.params.slugId as string));
const tagFilter = usePersistedRef<string[]>('timeline.tagFilter', [], route.query.tags ? (route.query.tags as string).split(',') : null);
const showNewMilestone = ref(false);
const showNewOutcome = ref(false);
const newOutcomeMilestoneId = ref<string | null>(null);
const newMilestone = ref({ name: '', targetDate: '', type: 'release' });

// Tags actually applied to outcomes — hides tags only used on motivations
// so the filter bar never offers a "click here for zero results" option.
const outcomeTags = computed(() =>
  tags.value.filter((t: any) => (t.usageOutcomes ?? 0) > 0)
);

function toggleTag(name: string) {
  // Reassign rather than mutate so the watcher fires (Vue 3 ref watchers are
  // shallow by default — push/splice would be invisible to the watcher).
  if (tagFilter.value.includes(name)) {
    tagFilter.value = tagFilter.value.filter(n => n !== name);
  } else {
    tagFilter.value = [...tagFilter.value, name];
  }
}

// Sync selection to URL so refresh keeps the detail panel open.
// Selection lives in the path as `/timeline/{slug}-{uuid}`.
watch(selectedOutcomeId, (id) => {
  let path = '/timeline';
  if (id) {
    const o = outcomes.value.find((x: any) => x.id === id);
    path = `/timeline/${buildSlugId(o?.title, id)}`;
  }
  router.replace({ path, query: route.query });
});

// External URL changes (SearchBar, browser back/forward) → update local state.
// Vue refs dedupe identical values so this doesn't loop with the watcher above.
watch(() => route.params.slugId, (slugId) => {
  selectedOutcomeId.value = extractId(slugId as string);
});

// Once outcomes finish loading, fill in the slug for an ID-only deep link.
watch(outcomes, () => {
  if (selectedOutcomeId.value) {
    const o = outcomes.value.find((x: any) => x.id === selectedOutcomeId.value);
    if (o) {
      const desired = `/timeline/${buildSlugId(o.title, selectedOutcomeId.value)}`;
      if (route.path !== desired) router.replace({ path: desired, query: route.query });
    }
  }
});

const { on } = useSSE();

async function loadData() {
  const params: Record<string, string> = { limit: '200' };
  if (tagFilter.value.length) params.tags = tagFilter.value.join(',');
  const [ms, os] = await Promise.all([
    api.getMilestones(),
    api.getOutcomes(params),
  ]);
  milestones.value = ms.data;
  outcomes.value = os.data;
}

async function loadTags() {
  tags.value = await api.getTags();
}

onMounted(() => { loadData(); loadTags(); });

// Tag filter changes → reload outcomes + sync to URL.
watch(tagFilter, () => {
  const query: Record<string, string> = { ...route.query } as Record<string, string>;
  if (tagFilter.value.length) query.tags = tagFilter.value.join(',');
  else delete query.tags;
  router.replace({ path: route.path, query });
  loadData();
});

// Refresh on relevant SSE events only
for (const evt of ['outcome_created', 'outcome_updated', 'outcome_deleted', 'milestone_updated', 'link_created', 'link_deleted', 'motivation_updated']) {
  on(evt, () => loadData());
}

// Group outcomes by milestone
const backlog = computed(() =>
  outcomes.value.filter(o => !o.milestoneId).sort((a, b) => Number(b.priorityScore) - Number(a.priorityScore))
);

const sortedMilestones = computed(() =>
  [...milestones.value].sort((a, b) => new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime())
);

function outcomesForMilestone(msId: string) {
  return outcomes.value
    .filter(o => o.milestoneId === msId)
    .sort((a, b) => Number(b.priorityScore) - Number(a.priorityScore));
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function dateClass(dateStr: string): string {
  const days = daysUntil(dateStr);
  if (days < 0) return 'overdue';
  if (days < 7) return 'urgent';
  if (days < 30) return 'soon';
  return '';
}

function effortClass(effort: string | null): string {
  if (!effort) return '';
  return `effort-${effort.toLowerCase()}`;
}

async function createMilestone() {
  if (!newMilestone.value.name || !newMilestone.value.targetDate) return;
  await api.createMilestone(newMilestone.value);
  newMilestone.value = { name: '', targetDate: '', type: 'release' };
  showNewMilestone.value = false;
  await loadData();
}

async function deleteMilestone(id: string) {
  if (!confirm('Delete this milestone? Outcomes will be moved to backlog.')) return;
  await api.deleteMilestone(id);
  await loadData();
}

// ─── Milestone editing ───
const editingMilestoneId = ref<string | null>(null);
const editForm = ref({ name: '', targetDate: '', type: '' });

function startEditMilestone(ms: any) {
  editingMilestoneId.value = ms.id;
  editForm.value = { name: ms.name, targetDate: ms.targetDate, type: ms.type || 'release' };
}

function cancelEdit() {
  editingMilestoneId.value = null;
}

async function saveEditMilestone() {
  if (!editingMilestoneId.value || !editForm.value.name || !editForm.value.targetDate) return;
  await api.updateMilestone(editingMilestoneId.value, editForm.value);
  editingMilestoneId.value = null;
  await loadData();
}


function outcomeMismatchLevel(o: any): MismatchLevel | null {
  if (!o.milestoneDate || !o.earliestMotivationDate) return null;
  const motTime = new Date(o.earliestMotivationDate).getTime();
  const msTime = new Date(o.milestoneDate).getTime();
  const diffDays = Math.floor((msTime - motTime) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return null;
  return diffDays > 90 ? 'critical' : 'warning';
}

function selectOutcome(id: string) {
  selectedOutcomeId.value = selectedOutcomeId.value === id ? null : id;
}

// ─── Drag and drop ───
// Move an outcome between milestone columns (or to/from the backlog) by
// dragging its card. Within-column order stays driven by priority score.
//
// We use native HTML5 drag-and-drop (no extra dependency). Click vs. drag is
// disambiguated by the browser: a click that doesn't move past the system
// threshold fires @click (selection); anything more becomes a drag.
const draggingOutcomeId = ref<string | null>(null);
// 'backlog' for the backlog column, the milestone id for any milestone column,
// or null when nothing is being hovered.
const dragOverTargetId = ref<string | null>(null);

function onDragStart(e: DragEvent, outcomeId: string) {
  draggingOutcomeId.value = outcomeId;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers refuse to start the drag without payload data.
    e.dataTransfer.setData('text/plain', outcomeId);
  }
}

function onDragOver(e: DragEvent, targetId: string) {
  // preventDefault is required to make a container a valid drop target.
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  if (dragOverTargetId.value !== targetId) dragOverTargetId.value = targetId;
}

function onDrop(e: DragEvent, toMilestoneId: string | null) {
  e.preventDefault();
  const id = draggingOutcomeId.value;
  draggingOutcomeId.value = null;
  dragOverTargetId.value = null;
  if (id) moveOutcome(id, toMilestoneId);
}

function onDragEnd() {
  draggingOutcomeId.value = null;
  dragOverTargetId.value = null;
}

async function moveOutcome(outcomeId: string, toMilestoneId: string | null) {
  const outcome = outcomes.value.find((o: any) => o.id === outcomeId);
  if (!outcome) return;
  // No-op when dropped on the source's own column.
  if ((outcome.milestoneId ?? null) === toMilestoneId) return;

  const original = outcome.milestoneId ?? null;
  // Optimistic update — the card visually moves immediately.
  outcome.milestoneId = toMilestoneId;

  try {
    await api.updateOutcome(outcomeId, { milestoneId: toMilestoneId });
    // SSE outcome_updated will reach other clients automatically; for this
    // client the optimistic mutation already shows the new column.
  } catch {
    // useApi already raised a toast. Revert by reloading from the server.
    outcome.milestoneId = original;
    await loadData();
  }
}

// ─── Export/Import ───
function exportExcel() {
  window.open(api.exportTimelineUrl(), '_blank');
}

function exportMarkdown() {
  window.open(api.exportMarkdownUrl(), '_blank');
}

function triggerImport() {
  fileInput.value?.click();
}

async function handleImportFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const result = await api.importTimelineDiff(file);
    importDiffs.value = result.diffs;
    importSummary.value = result.summary;
    selectedOutcomeId.value = null;
    showNewOutcome.value = false;
  } catch { /* error surfaced via toast by useApi */ }
  // Reset file input
  if (fileInput.value) fileInput.value.value = '';
}

async function onImportApplied() {
  importDiffs.value = null;
  importSummary.value = null;
  await loadData();
}

function startCreateOutcome(milestoneId?: string) {
  newOutcomeMilestoneId.value = milestoneId || null;
  showNewOutcome.value = true;
  selectedOutcomeId.value = null;
}

async function onOutcomeSaved(outcome: any) {
  showNewOutcome.value = false;
  await loadData();
  selectedOutcomeId.value = outcome.id;
}
</script>

<template>
  <div class="timeline" :class="{ 'has-detail': selectedOutcomeId || showNewOutcome || importDiffs }">
    <!-- Left: Backlog -->
    <aside class="backlog">
      <div class="backlog-header">
        <span class="backlog-title">Backlog</span>
        <span class="count font-mono">{{ backlog.length }}</span>
      </div>
      <div
        class="backlog-cards"
        :class="{ 'drop-target-active': dragOverTargetId === 'backlog' }"
        @dragover="onDragOver($event, 'backlog')"
        @drop="onDrop($event, null)"
      >
        <div
          v-for="o in backlog"
          :key="o.id"
          class="backlog-card"
          :class="{ selected: o.id === selectedOutcomeId, dragging: draggingOutcomeId === o.id }"
          draggable="true"
          @click="selectOutcome(o.id)"
          @dragstart="onDragStart($event, o.id)"
          @dragend="onDragEnd"
        >
          <div class="card-title-row">
            <span class="card-title">{{ o.title }}</span>
            <template v-if="o.tags && o.tags.length">
              <span
                v-for="tag in o.tags" :key="tag.id"
                :class="['tag', 'card-tag', { 'tag-inherited': tag.inherited }]"
                :style="{ background: (tag.colour || '#888888') + '15', color: tag.colour || '#888888' }"
                :title="tag.inherited ? `Inherited from a linked motivation` : tag.name"
                @click.stop="toggleTag(tag.name)"
              >{{ tag.emoji }} {{ tag.name }}<span v-if="tag.inherited" class="tag-inherited-icon" aria-label="inherited">↑</span></span>
            </template>
            <a v-if="o.primaryLinkUrl" :href="o.primaryLinkUrl" target="_blank" rel="noopener noreferrer" class="card-primary-link" title="Open primary issue" @click.stop>↗</a>
          </div>
          <div class="card-meta">
            <span class="card-score font-mono">{{ Number(o.priorityScore).toFixed(0) }}</span>
            <span v-if="o.effort" :class="['effort-badge', effortClass(o.effort)]">{{ o.effort }}</span>
            <span :class="['status-badge', `status-${o.status}`]">{{ o.status }}</span>
          </div>
        </div>
        <div v-if="backlog.length === 0" class="empty">No unplanned outcomes</div>
      </div>
    </aside>

    <!-- Center: Milestones -->
    <div class="milestones">
      <div class="milestones-header">
        <h2 class="font-display milestones-title">Timeline</h2>
        <div class="header-buttons">
          <button class="btn btn-sm" @click="exportExcel" title="Download Excel">Export Excel</button>
          <button class="btn btn-sm" @click="exportMarkdown" title="Download Markdown">Export MD</button>
          <button class="btn btn-sm" @click="triggerImport" title="Import modified spreadsheet">Import</button>
          <input ref="fileInput" type="file" accept=".xlsx" style="display:none" @change="handleImportFile" />
          <span class="header-sep"></span>
          <button class="btn btn-sm" @click="showNewMilestone = !showNewMilestone">+ Milestone</button>
          <button class="btn btn-sm btn-primary" @click="startCreateOutcome()">+ Outcome</button>
        </div>
      </div>

      <!-- Tag filter bar -->
      <div v-if="outcomeTags.length" class="filter-bar">
        <span class="filter-label">Tags</span>
        <span
          v-for="tag in outcomeTags" :key="tag.id"
          :class="['tag', { 'filter-active': tagFilter.includes(tag.name) }]"
          :style="{ background: (tag.colour || '#888888') + '15', color: tag.colour || '#888888' }"
          @click="toggleTag(tag.name)"
        >{{ tag.emoji }} {{ tag.name }}</span>
        <button v-if="tagFilter.length" class="btn btn-sm clear-filter" @click="tagFilter = []">Clear</button>
      </div>

      <!-- New milestone form -->
      <div v-if="showNewMilestone" class="new-milestone-form">
        <input v-model="newMilestone.name" placeholder="Milestone name" class="input" />
        <input v-model="newMilestone.targetDate" type="date" class="input" />
        <select v-model="newMilestone.type" class="input">
          <option value="release">Release</option>
          <option value="deadline">Deadline</option>
          <option value="review">Review</option>
        </select>
        <button class="btn btn-primary btn-sm" @click="createMilestone">Create</button>
        <button class="btn btn-sm" @click="showNewMilestone = false">Cancel</button>
      </div>

      <!-- Milestone sections -->
      <div class="milestone-list">
        <section v-for="ms in sortedMilestones" :key="ms.id" class="milestone-section">
          <!-- Edit mode -->
          <div v-if="editingMilestoneId === ms.id" class="milestone-edit-form">
            <input v-model="editForm.name" class="input" placeholder="Name" />
            <input v-model="editForm.targetDate" type="date" class="input" />
            <select v-model="editForm.type" class="input">
              <option value="release">Release</option>
              <option value="deadline">Deadline</option>
              <option value="review">Review</option>
            </select>
            <button class="btn btn-sm btn-primary" @click="saveEditMilestone">Save</button>
            <button class="btn btn-sm" @click="cancelEdit">Cancel</button>
          </div>
          <!-- Display mode -->
          <div v-else class="milestone-header">
            <span class="ms-icon">{{ ms.type === 'release' ? '🚀' : ms.type === 'deadline' ? '⏰' : '📋' }}</span>
            <span class="ms-name">{{ ms.name }}</span>
            <span class="ms-type">{{ ms.type }}</span>
            <span :class="['ms-date font-mono', dateClass(ms.targetDate)]">
              {{ ms.targetDate }} · {{ daysUntil(ms.targetDate) < 0 ? 'overdue' : daysUntil(ms.targetDate) + 'd' }}
            </span>
            <span class="ms-count font-mono">{{ outcomesForMilestone(ms.id).length }}</span>
            <div class="ms-actions">
              <button class="btn-icon" @click.stop="startEditMilestone(ms)" title="Edit milestone">✎</button>
              <button class="btn-icon" @click.stop="deleteMilestone(ms.id)" title="Delete milestone">×</button>
            </div>
          </div>

          <div
            class="milestone-cards"
            :class="{ 'drop-target-active': dragOverTargetId === ms.id }"
            @dragover="onDragOver($event, ms.id)"
            @drop="onDrop($event, ms.id)"
          >
            <div
              v-for="o in outcomesForMilestone(ms.id)"
              :key="o.id"
              class="outcome-card"
              :class="{ selected: o.id === selectedOutcomeId, dragging: draggingOutcomeId === o.id }"
              draggable="true"
              @click="selectOutcome(o.id)"
              @dragstart="onDragStart($event, o.id)"
              @dragend="onDragEnd"
            >
              <div class="card-title-row">
                <span v-if="outcomeMismatchLevel(o) === 'critical'" class="mismatch-dot mismatch-dot-critical" title="Motivation date >90 days before milestone"></span>
                <span v-else-if="outcomeMismatchLevel(o) === 'warning'" class="mismatch-dot mismatch-dot-warning" title="Motivation date before milestone"></span>
                <span class="card-title">{{ o.title }}</span>
                <template v-if="o.tags && o.tags.length">
                  <span
                    v-for="tag in o.tags" :key="tag.id"
                    :class="['tag', 'card-tag', { 'tag-inherited': tag.inherited }]"
                    :style="{ background: (tag.colour || '#888888') + '15', color: tag.colour || '#888888' }"
                    :title="tag.inherited ? `Inherited from a linked motivation` : tag.name"
                    @click.stop="toggleTag(tag.name)"
                  >{{ tag.emoji }} {{ tag.name }}<span v-if="tag.inherited" class="tag-inherited-icon" aria-label="inherited">↑</span></span>
                </template>
                <a v-if="o.primaryLinkUrl" :href="o.primaryLinkUrl" target="_blank" rel="noopener noreferrer" class="card-primary-link" title="Open primary issue" @click.stop>↗</a>
              </div>
              <div class="card-meta">
                <span class="card-score font-mono">{{ Number(o.priorityScore).toFixed(0) }}</span>
                <span v-if="o.effort" :class="['effort-badge', effortClass(o.effort)]">{{ o.effort }}</span>
                <span :class="['status-badge', `status-${o.status}`]">{{ o.status }}</span>
              </div>
            </div>
            <div v-if="outcomesForMilestone(ms.id).length === 0" class="empty">No outcomes assigned</div>
          </div>
        </section>

        <div v-if="sortedMilestones.length === 0" class="empty-milestones">
          No milestones yet. Create one to start planning.
        </div>
      </div>
    </div>

    <!-- Right: Detail/Form/Import Panel -->
    <aside v-if="importDiffs" class="side-panel" style="width:560px">
      <ImportReview
        :diffs="importDiffs"
        :summary="importSummary"
        @applied="onImportApplied"
        @cancel="importDiffs = null; importSummary = null"
      />
    </aside>
    <aside v-else-if="showNewOutcome" class="side-panel">
      <OutcomeForm
        :default-milestone-id="newOutcomeMilestoneId"
        @saved="onOutcomeSaved"
        @cancel="showNewOutcome = false"
      />
    </aside>
    <OutcomeDetail
      v-else-if="selectedOutcomeId"
      :outcome-id="selectedOutcomeId"
      @close="selectedOutcomeId = null"
      @updated="loadData"
    />
  </div>
</template>

<style scoped>
.timeline {
  display: grid;
  grid-template-columns: 240px 1fr;
  height: 100%;
  overflow: hidden;
}
.timeline.has-detail {
  grid-template-columns: 240px 1fr 480px;
}

.header-buttons { display: flex; gap: 6px; align-items: center; }
.header-sep { width: 1px; height: 18px; background: var(--border); }

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

/* ─── Backlog ─── */
.backlog {
  border-right: 1px solid var(--border);
  background: var(--bg-0);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.backlog-header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.backlog-title { font-size: 12px; font-weight: 600; color: var(--text-2); }
.count {
  font-size: 10px;
  color: var(--text-3);
  background: var(--bg-3);
  padding: 1px 6px;
  border-radius: 8px;
}
.backlog-cards {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1;
}
.backlog-card {
  background: var(--bg-1);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  cursor: pointer;
  transition: all var(--transition);
}
.backlog-card:hover { border-color: var(--text-3); border-style: solid; }
.backlog-card.selected { border-color: var(--accent); border-style: solid; background: var(--accent-dim); }

/* ─── Milestones ─── */
.milestones {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.milestones-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-1);
}
.milestones-title { font-size: 14px; font-weight: 700; }

/* Tag filter bar */
.filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 24px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-1);
}
.filter-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-right: 2px;
}
.filter-active { border-color: var(--text-0) !important; box-shadow: 0 0 0 1px var(--text-0); }
.clear-filter { margin-left: auto; }

.new-milestone-form {
  display: flex;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-2);
  align-items: center;
}
.input {
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-1);
  color: var(--text-0);
  outline: none;
}
.input:focus { border-color: var(--accent); }

.milestone-list {
  overflow-y: auto;
  flex: 1;
}
.milestone-section {
  border-bottom: 1px solid var(--border);
}
.milestone-header {
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  z-index: 5;
}
.milestone-header:hover .ms-actions { opacity: 1; }

.ms-icon { font-size: 16px; flex-shrink: 0; }
.ms-name { font-size: 14px; font-weight: 600; }
.ms-type { font-size: 10px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.5px; }
.ms-date { font-size: 11px; color: var(--text-2); }
.ms-date.urgent { color: var(--red); font-weight: 600; }
.ms-date.soon { color: var(--accent); font-weight: 600; }
.ms-date.overdue { color: var(--red); font-weight: 600; }
.ms-count { font-size: 10px; color: var(--text-3); background: var(--bg-3); padding: 1px 6px; border-radius: 8px; margin-left: auto; }
.ms-actions { opacity: 0; transition: opacity var(--transition); }
.btn-icon {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  cursor: pointer;
  padding: 2px 8px;
  font-size: 14px;
  transition: all var(--transition);
}
.btn-icon:hover { border-color: var(--text-2); color: var(--text-0); }
.btn-icon:last-child:hover { border-color: var(--red); color: var(--red); }

.milestone-edit-form {
  display: flex;
  gap: 8px;
  padding: 10px 24px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--border-subtle);
  align-items: center;
}
.milestone-edit-form .input:first-child {
  flex: 1;
  min-width: 240px;
}

.milestone-cards {
  padding: 4px 24px 12px 46px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ─── Outcome cards (used in both backlog and milestones) ─── */
.outcome-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 10px 14px;
  cursor: pointer;
  transition: all var(--transition);
}
.outcome-card:hover { border-color: var(--border); background: var(--bg-hover); }
.outcome-card.selected { border-color: var(--accent); background: var(--accent-dim); }

/* ─── Drag and drop ─── */
.outcome-card.dragging,
.backlog-card.dragging {
  opacity: 0.4;
  cursor: grabbing;
}
/* Highlight the column the dragged card is hovering over so the landing
   spot is obvious. Outline rather than border to avoid layout shift. */
.milestone-cards.drop-target-active,
.backlog-cards.drop-target-active {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
  background: var(--accent-dim);
  border-radius: var(--radius);
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}
.card-primary-link { font-size: 11px; color: var(--text-3); text-decoration: none; flex-shrink: 0; margin-left: auto; }
.card-primary-link:hover { color: var(--accent); }
.card-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}
.mismatch-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.mismatch-dot-critical { background: var(--red); }
.mismatch-dot-warning { background: var(--accent); }
.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: 12px;
}
.card-score { font-size: 12px; font-weight: 600; color: var(--accent); }
.card-tag { font-size: 10px; padding: 1px 7px; }

.empty {
  font-size: 12px;
  color: var(--text-3);
  padding: 12px;
  text-align: center;
}
.empty-milestones {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-3);
  font-size: 14px;
}
</style>
