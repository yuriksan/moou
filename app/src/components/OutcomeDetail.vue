<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../composables/useApi';
import OutcomeForm from './OutcomeForm.vue';
import MotivationForm from './MotivationForm.vue';
import { checkOutcomeMismatches, mismatchSummary, type DateMismatch } from '../composables/useDateMismatch';
import { formatHistory } from '../composables/useHistoryFormatter';
import { buildSlugId } from '../composables/useSlug';
import ConnectDialog from './ConnectDialog.vue';
import ExternalLinkCard from './ExternalLinkCard.vue';
import VEPublishDialog from './VEPublishDialog.vue';

const router = useRouter();

/**
 * Tag chip click → navigate to the Outcomes list filtered by that tag.
 * Same param the OutcomesView filter bar uses, so the URL is shareable
 * and the back button works as expected.
 */
function navigateToTag(name: string) {
  router.push({ path: '/outcomes', query: { tags: name } });
}

const props = defineProps<{
  outcomeId: string;
}>();

const emit = defineEmits<{
  close: [];
  updated: [];
}>();

const outcome = ref<any>(null);
const score = ref<any>(null);
const comments = ref<any[]>([]);
const history = ref<any[]>([]);
const showAllHistory = ref(false);
const newComment = ref('');
const loading = ref(true);
const editing = ref(false);
const outcomeFormRef = ref<any>(null);
const showNewMotivation = ref(false);
const showLinkMotivation = ref(false);
const linkSearch = ref('');
const linkResults = ref<any[]>([]);
const showAddLink = ref(false);
const showConnect = ref(false);
const showPublish = ref(false);
const publishing = ref(false);
const publishEntityType = ref('');
const newLinkUrl = ref('');
const provider = ref<any>(null);
const backendEntityTypes = ref<any[]>([]);
const backendProviderLabel = ref('');
const milestoneDate = ref<string | null>(null);
const syncingTitle = ref(false);
const syncingDescription = ref(false);
// All milestones, used so history entries can render `milestoneId` changes
// as the milestone's actual name ("moved to Q3 Release") rather than a UUID.
const milestoneNames = ref<Record<string, string>>({});

// Formatted history — entries that carry no information (e.g. an `updated`
// row whose only change is the auto-incrementing `updatedAt` field) are
// dropped entirely.
const displayHistory = computed(() =>
  formatHistory(history.value, { milestoneNames: milestoneNames.value })
);

// Outcome is "draft" when it has no external links. Used by publish (hidden, kept for future use).

// Entity types the user can publish to. PRs are excluded because they cannot
// be created from a title + description alone (need a head/base branch).
const publishableEntityTypes = computed(() =>
  backendEntityTypes.value.filter((t: any) => t.name !== 'pr')
);

const mismatches = computed(() => {
  if (!outcome.value?.motivations || !milestoneDate.value) return [];
  return checkOutcomeMismatches(outcome.value.motivations, milestoneDate.value);
});

const mismatchCounts = computed(() => mismatchSummary(mismatches.value));

function getMotivationMismatch(motivationId: string): DateMismatch | undefined {
  return mismatches.value.find(m => {
    // Match by title since we don't have ID in the mismatch object
    const mot = outcome.value?.motivations?.find((mo: any) => mo.id === motivationId);
    return mot && m.motivationTitle === mot.title;
  });
}

async function load() {
  loading.value = true;
  try {
    const [o, s, c, h, p] = await Promise.all([
      api.getOutcome(props.outcomeId),
      api.getOutcomeScore(props.outcomeId).catch(() => null),
      api.getComments(props.outcomeId, { limit: '50' }),
      api.getOutcomeHistory(props.outcomeId, { limit: '10' }),
      api.getProvider(),
    ]);
    outcome.value = o;
    score.value = s;
    comments.value = c.data;
    history.value = h.data;
    provider.value = p;

    // Load backend entity types once for the publish flow. Quietly ignore failures
    // (mock providers / no adapter configured).
    if (!backendEntityTypes.value.length) {
      try {
        const data = await api.getBackendEntityTypes();
        backendEntityTypes.value = data.entityTypes || [];
        backendProviderLabel.value = data.label || '';
        const def = backendEntityTypes.value.find((t: any) => t.default && t.name !== 'pr')
          || backendEntityTypes.value.find((t: any) => t.name !== 'pr');
        if (def) publishEntityType.value = def.name;
      } catch { /* no adapter */ }
    }

    // Get milestone date for mismatch detection
    if (o.milestoneId) {
      try {
        const ms = await api.getMilestone(o.milestoneId);
        milestoneDate.value = ms.targetDate;
      } catch { milestoneDate.value = null; }
    } else {
      milestoneDate.value = null;
    }

    // Build the milestone id → name lookup once per detail open. We need it
    // so history rows like `{ milestoneId: { old, new } }` can render as
    // "moved to Q3 Release" instead of an opaque UUID.
    if (Object.keys(milestoneNames.value).length === 0) {
      try {
        const ms = await api.getMilestones();
        const map: Record<string, string> = {};
        for (const m of ms.data) map[m.id] = m.name;
        milestoneNames.value = map;
      } catch { /* fall back to "a milestone" in formatter */ }
    }
  } finally {
    loading.value = false;
  }
}

watch(() => props.outcomeId, () => { editing.value = false; load(); });
onMounted(load);

async function onEditSaved() {
  editing.value = false;
  emit('updated');
  await load();
}

async function deleteOutcome() {
  if (!confirm('Delete this outcome? This cannot be undone.')) return;
  await api.deleteOutcome(props.outcomeId);
  emit('updated');
  emit('close');
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function searchMotivations() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  if (!linkSearch.value.trim()) { linkResults.value = []; return; }
  searchDebounceTimer = setTimeout(async () => {
    const res = await api.getMotivations({ limit: '20', search: linkSearch.value.trim() });
    const linkedIds = new Set((outcome.value?.motivations || []).map((m: any) => m.id));
    linkResults.value = res.data.filter((m: any) => !linkedIds.has(m.id));
  }, 300);
}

async function linkMotivation(motivationId: string) {
  await api.linkMotivation(motivationId, props.outcomeId);
  showLinkMotivation.value = false;
  linkSearch.value = '';
  linkResults.value = [];
  emit('updated');
  await load();
}

async function unlinkMotivation(motivationId: string) {
  if (!confirm('Unlink this motivation? The outcome\'s priority score will change.')) return;
  await api.unlinkMotivation(motivationId, props.outcomeId);
  emit('updated');
  await load();
}

async function onMotivationSaved() {
  showNewMotivation.value = false;
  emit('updated');
  await load();
}

function parseUrl(url: string): { entityType: string; entityId: string } {
  // Try to extract entity type and ID from common URL patterns
  // GitHub: /issues/123, /pull/456
  const ghIssue = url.match(/\/issues\/(\d+)/);
  if (ghIssue) return { entityType: 'issue', entityId: ghIssue[1]! };
  const ghPr = url.match(/\/pull\/(\d+)/);
  if (ghPr) return { entityType: 'pr', entityId: ghPr[1]! };

  // Jira: /browse/PROJ-123
  const jira = url.match(/\/browse\/([A-Z]+-\d+)/);
  if (jira) return { entityType: 'issue', entityId: jira[1]! };

  // Generic: use last path segment as ID
  const path = new URL(url).pathname.split('/').filter(Boolean);
  return { entityType: 'link', entityId: path[path.length - 1] || url };
}

async function addExternalLink() {
  const url = newLinkUrl.value.trim();
  if (!url) return;
  const { entityType, entityId } = parseUrl(url);
  try {
    await api.createExternalLink(props.outcomeId, { entityType, entityId, url });
  } catch {
    // If entity type is not valid for provider, retry with 'link'
    await api.createExternalLink(props.outcomeId, { entityType: 'link', entityId, url });
  }
  newLinkUrl.value = '';
  showAddLink.value = false;
  emit('updated');
  await load();
}

// deleteExternalLink moved to ExternalLinkCard component

async function setPrimaryLink(linkId: string | null) {
  await api.setPrimaryLink(props.outcomeId, linkId);
  emit('updated');
  await load();
}

async function pullField(field: 'title' | 'description') {
  const syncing = field === 'title' ? syncingTitle : syncingDescription;
  syncing.value = true;
  try {
    await api.pullPrimary(props.outcomeId, field);
    emit('updated');
    await load();
  } catch { /* error surfaced via toast */ } finally {
    syncing.value = false;
  }
}

async function pushField(field: 'title' | 'description') {
  const syncing = field === 'title' ? syncingTitle : syncingDescription;
  syncing.value = true;
  try {
    await api.pushPrimary(props.outcomeId, field);
    await load();
  } catch { /* error surfaced via toast */ } finally {
    syncing.value = false;
  }
}

async function publishOutcome() {
  const type = publishEntityType.value;
  const typeLabel = publishableEntityTypes.value.find((t: any) => t.name === type)?.label || type || 'item';
  const providerName = backendProviderLabel.value || 'the issue tracker';
  if (!confirm(`This will create a new ${providerName} ${typeLabel.toLowerCase()}. Continue?`)) return;
  publishing.value = true;
  try {
    await api.publishOutcome(props.outcomeId, type || undefined);
    showPublish.value = false;
    emit('updated');
    await load();
  } catch { /* error surfaced via toast by useApi */ } finally {
    publishing.value = false;
  }
}

async function onConnected(link: any, asPrimary?: boolean) {
  showConnect.value = false;
  if (asPrimary && link?.id) {
    await api.setPrimaryLink(props.outcomeId, link.id);
  }
  emit('updated');
  await load();
}

async function togglePin() {
  await api.pinOutcome(props.outcomeId);
  emit('updated');
  await load();
}

async function addComment() {
  if (!newComment.value.trim()) return;
  await api.createComment(props.outcomeId, newComment.value.trim());
  newComment.value = '';
  await load();
}

function motivationPillClass(typeName: string): string {
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
</script>

<template>
  <aside class="detail-panel">
    <div v-if="loading" class="loading">Loading...</div>
    <template v-else-if="outcome">
      <!-- Header -->
      <div class="detail-header">
        <div class="header-top">
          <button class="close-btn" @click="emit('close')">×</button>
          <div class="header-info">
            <div class="field-with-sync">
              <h2 class="detail-title font-display editable-field" title="Click to edit" @click="editing = true">{{ outcome.title }}</h2>
              <template v-if="outcome.primaryLinkId">
                <button class="btn-sync" @click="pullField('title')" :disabled="syncingTitle" title="Pull title from primary item">↓</button>
                <button class="btn-sync" @click="pushField('title')" :disabled="syncingTitle" title="Push title to primary item">↑</button>
              </template>
            </div>
            <div class="header-meta">
              <span :class="['status-badge', `status-${outcome.status}`]" class="editable-field" title="Click to edit" @click="editing = true">{{ outcome.status }}</span>
              <span v-if="outcome.effort" :class="['effort-badge', `effort-${outcome.effort.toLowerCase()}`]" class="editable-field" title="Click to edit" @click="editing = true">{{ outcome.effort }}</span>
              <span
                v-for="tag in outcome.tags"
                :key="tag.id"
                :class="['tag', 'clickable-tag', { 'tag-inherited': tag.inherited }]"
                :style="{ background: (tag.colour || '#888') + '15', color: tag.colour || '#888' }"
                :title="tag.inherited ? `Inherited from a linked motivation — edit the motivation to remove` : `Show outcomes tagged ${tag.name}`"
                @click="navigateToTag(tag.name)"
              >
                {{ tag.emoji }} {{ tag.name }}<span v-if="tag.inherited" class="tag-inherited-icon" aria-label="inherited">↑</span>
              </span>
            </div>
          </div>
        </div>
        <div class="header-actions">
          <template v-if="editing">
            <button class="btn btn-sm" @click="editing = false">Cancel</button>
            <button class="btn btn-sm btn-primary" @click="outcomeFormRef?.save()">Save Changes</button>
          </template>
          <template v-else>
            <button class="btn btn-sm" @click="editing = true">Edit</button>
            <button class="btn btn-sm" @click="togglePin">
              {{ outcome.pinned ? 'Unpin' : 'Pin' }}
            </button>
            <button class="btn btn-sm btn-danger" @click="deleteOutcome">Delete</button>
          </template>
        </div>
      </div>

      <!-- Edit Form -->
      <OutcomeForm
        v-if="editing"
        ref="outcomeFormRef"
        :outcome="outcome"
        :hide-actions="true"
        @saved="onEditSaved"
        @cancel="editing = false"
      />

      <!-- Description (read mode) -->
      <section v-else-if="outcome.description" class="section editable-section" @click="editing = true" title="Click to edit">
        <div class="section-title-row">
          <h3 class="section-title">Description</h3>
          <template v-if="outcome.primaryLinkId">
            <button class="btn-sync" @click="pullField('description')" :disabled="syncingDescription" title="Pull description from primary item">↓</button>
            <button class="btn-sync" @click="pushField('description')" :disabled="syncingDescription" title="Push description to primary item">↑</button>
          </template>
        </div>
        <div class="description">{{ outcome.description }}</div>
      </section>

      <!-- Score Breakdown -->
      <section v-if="!editing && score && score.motivations?.length" class="section">
        <h3 class="section-title">Priority Score</h3>
        <div class="score-breakdown">
          <div v-for="m in score.motivations" :key="m.id" class="score-row">
            <span :class="['motivation-pill', motivationPillClass(m.type)]">{{ m.type }}</span>
            <span class="score-label">{{ m.title }}</span>
            <span class="score-value font-mono">{{ Number(m.score).toFixed(0) }}</span>
          </div>
          <div v-if="score.effortPenalty > 0" class="score-row penalty">
            <span class="score-label">Effort penalty ({{ outcome.effort }})</span>
            <span class="score-value font-mono">-{{ score.effortPenalty }}</span>
          </div>
          <div class="score-total">
            <span class="score-total-label">Total</span>
            <span class="score-total-value font-display">{{ Number(outcome.priorityScore).toFixed(0) }}</span>
          </div>
        </div>
      </section>

      <!-- Motivations -->
      <section v-if="!editing" class="section">
        <h3 class="section-title">
          Motivations ({{ outcome.motivations?.length || 0 }})
          <span v-if="mismatchCounts.critical" class="mismatch-badge mismatch-critical" :title="`${mismatchCounts.critical} date conflicts >90 days`">{{ mismatchCounts.critical }} critical</span>
          <span v-if="mismatchCounts.warning" class="mismatch-badge mismatch-warning" :title="`${mismatchCounts.warning} date conflicts`">{{ mismatchCounts.warning }} warning</span>
        </h3>
        <div v-for="m in outcome.motivations" :key="m.id" :class="['motivation-card', getMotivationMismatch(m.id)?.level === 'critical' ? 'card-mismatch-critical' : getMotivationMismatch(m.id)?.level === 'warning' ? 'card-mismatch-warning' : '']">
          <div class="motivation-card-head">
            <span v-if="getMotivationMismatch(m.id)" :class="['mismatch-dot', `mismatch-dot-${getMotivationMismatch(m.id)!.level}`]" :title="getMotivationMismatch(m.id)!.message"></span>
            <span :class="['motivation-pill', motivationPillClass(m.typeName)]">{{ m.typeName }}</span>
            <span class="motivation-card-title">{{ m.title }}</span>
            <span class="motivation-card-score font-mono">{{ Number(m.score).toFixed(0) }}</span>
            <a :href="`/motivations/${buildSlugId(m.title, m.id)}`" target="_blank" rel="noopener noreferrer" class="motivation-open-link" title="Open motivation in new tab" @click.stop>&#8599;</a>
            <button class="unlink-btn" @click.stop="unlinkMotivation(m.id)" title="Unlink">×</button>
          </div>
          <div v-if="m.tags && m.tags.length" class="motivation-card-tags">
            <span
              v-for="tag in m.tags" :key="tag.id"
              class="tag motivation-tag"
              :style="{ background: (tag.colour || '#888') + '15', color: tag.colour || '#888' }"
            >{{ tag.emoji }} {{ tag.name }}</span>
          </div>
          <div v-if="getMotivationMismatch(m.id)" class="mismatch-info">
            {{ getMotivationMismatch(m.id)!.message }}
          </div>
        </div>
        <div v-if="!outcome.motivations?.length" class="empty">No motivations linked</div>

        <!-- Link existing motivation -->
        <div v-if="showLinkMotivation" class="link-section">
          <input v-model="linkSearch" class="input" placeholder="Search motivations..." @input="searchMotivations" />
          <div v-for="m in linkResults" :key="m.id" class="link-result" @click="linkMotivation(m.id)">
            <span :class="['motivation-pill', motivationPillClass(m.typeName)]" style="font-size:9px">{{ m.typeName }}</span>
            <span class="link-result-title">{{ m.title }}</span>
            <span class="link-result-score font-mono">{{ Number(m.score).toFixed(0) }}</span>
          </div>
        </div>

        <!-- Create new motivation (inline) -->
        <MotivationForm
          v-if="showNewMotivation"
          :link-to-outcome-id="outcomeId"
          @saved="onMotivationSaved"
          @cancel="showNewMotivation = false"
        />

        <div v-if="!showNewMotivation && !showLinkMotivation" class="motivation-actions">
          <button class="btn btn-sm" @click="showLinkMotivation = true">Link Existing</button>
          <button class="btn btn-sm btn-primary" @click="showNewMotivation = true">+ New Motivation</button>
        </div>
        <div v-if="showLinkMotivation" class="motivation-actions">
          <button class="btn btn-sm" @click="showLinkMotivation = false; linkSearch = ''; linkResults = []">Cancel</button>
        </div>
      </section>

      <!-- External Links -->
      <section v-if="!editing" class="section">
        <h3 class="section-title">Linked Items</h3>

        <!-- Rich link cards (connected/published items with cached details) -->
        <ExternalLinkCard
          v-for="link in (outcome.externalLinks || [])"
          :key="link.id"
          :link="link"
          :is-primary="link.id === outcome.primaryLinkId"
          @refreshed="load"
          @deleted="() => { emit('updated'); load(); }"
          @set-primary="setPrimaryLink(link.id)"
          @clear-primary="setPrimaryLink(null)"
        />

        <!-- Connect dialog -->
        <ConnectDialog
          v-if="showConnect"
          :outcome-id="outcomeId"
          @connected="onConnected"
          @cancel="showConnect = false"
        />

        <!-- URL link form (fallback for non-adapter providers) -->
        <div v-if="showAddLink" class="add-link-form">
          <input v-model="newLinkUrl" class="input" placeholder="Paste URL..." style="flex:1" @keyup.enter="addExternalLink" autofocus />
          <button class="btn btn-sm btn-primary" @click="addExternalLink">Add</button>
          <button class="btn btn-sm" @click="showAddLink = false; newLinkUrl = ''">×</button>
        </div>

        <!-- ValueEdge multi-step publish dialog (hidden \u2014 kept for future use) -->
        <!-- Generic publish picker (hidden \u2014 kept for future use) -->
        <template v-if="false">
          <VEPublishDialog
            v-if="showPublish && provider?.name === 'valueedge'"
            :outcome-id="outcomeId"
            :entity-types="backendEntityTypes"
            :provider-label="backendProviderLabel"
            :title="outcome.title"
            :description="outcome.description"
            @published="onConnected"
            @cancel="showPublish = false"
          />

          <div v-if="showPublish && provider?.name !== 'valueedge'" class="publish-form">
            <select
              v-if="publishableEntityTypes.length > 1"
              v-model="publishEntityType"
              class="input publish-type-select"
              :disabled="publishing"
            >
              <option v-for="t in publishableEntityTypes" :key="t.name" :value="t.name">{{ t.label }}</option>
            </select>
            <span v-else class="publish-type-static">{{ publishableEntityTypes[0]?.label || 'Issue' }}</span>
            <div class="publish-actions">
              <button class="btn btn-sm btn-primary" @click="publishOutcome" :disabled="publishing">
                {{ publishing ? 'Publishing...' : `Publish to ${backendProviderLabel || 'backend'}` }}
              </button>
              <button class="btn btn-sm" :disabled="publishing" @click="showPublish = false">Cancel</button>
            </div>
          </div>
        </template>

        <div v-if="!showConnect && !showAddLink" class="link-actions-row">
          <button class="btn btn-sm btn-primary" @click="showConnect = true">Connect to Issue</button>
          <!-- Publish button hidden — kept for future use:
          <button
            v-if="isDraftOutcome && publishableEntityTypes.length > 0"
            class="btn btn-sm"
            @click="showPublish = true"
            :title="`Create a new ${backendProviderLabel || 'backend'} item from this outcome`"
          >
            Publish as {{ backendProviderLabel || 'Issue' }}
          </button>
          -->
          <button class="btn btn-sm" @click="showAddLink = true">+ URL</button>
        </div>
      </section>

      <!-- Comments -->
      <section class="section">
        <h3 class="section-title">Comments ({{ comments.length }})</h3>
        <div v-for="c in comments" :key="c.id" class="comment">
          <div class="comment-meta">
            <span class="comment-author">{{ c.createdBy }}</span>
            <span class="comment-time font-mono">{{ timeAgo(c.createdAt) }}</span>
          </div>
          <div class="comment-body">{{ c.body }}</div>
        </div>
        <div class="comment-input">
          <input
            v-model="newComment"
            placeholder="Add a comment..."
            class="input comment-field"
            @keyup.enter="addComment"
          />
          <button class="btn btn-sm" @click="addComment" :disabled="!newComment.trim()">Post</button>
        </div>
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
          <span class="history-text">
            <strong>{{ row.entry.changedBy }}</strong> {{ row.text }}
          </span>
          <span class="history-time font-mono">{{ timeAgo(row.entry.changedAt) }}</span>
        </div>
        <div v-if="displayHistory.length === 0" class="empty">No changes yet</div>
        <button
          v-if="displayHistory.length > 3 && !showAllHistory"
          class="btn btn-sm show-more"
          @click="showAllHistory = true"
        >
          Show {{ displayHistory.length - 3 }} more
        </button>
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

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-3);
}

.detail-header {
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg-1);
  z-index: 10;
}
.header-top {
  display: flex;
  gap: 12px;
}
.close-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--bg-3);
  border: none;
  color: var(--text-2);
  cursor: pointer;
  font-size: 16px;
  flex-shrink: 0;
  transition: all var(--transition);
}
.close-btn:hover { background: var(--bg-hover); color: var(--text-0); }

.header-info { flex: 1; min-width: 0; }
.detail-title { font-size: 18px; font-weight: 700; line-height: 1.3; }
.editable-field { cursor: pointer; }
.editable-field:hover { opacity: 0.75; }
.editable-section { cursor: pointer; }
.editable-section:hover { background: var(--bg-hover); }

.field-with-sync { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.field-with-sync .detail-title { flex: 1; min-width: 0; }
.section-title-row { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
.section-title-row .section-title { margin-bottom: 0; flex: 1; }
.btn-sync {
  background: none; border: 1px solid var(--border); color: var(--text-3); cursor: pointer;
  font-size: 12px; padding: 0 5px; border-radius: var(--radius-sm); line-height: 20px;
  transition: all var(--transition); flex-shrink: 0;
}
.btn-sync:hover { border-color: var(--accent); color: var(--accent); }
.btn-sync:disabled { opacity: 0.3; cursor: default; }
.header-meta { display: flex; gap: 6px; margin-top: 6px; align-items: center; flex-wrap: wrap; }
.header-actions { display: flex; gap: 6px; margin-top: 10px; }
.btn-danger { border-color: var(--red); color: var(--red); background: var(--red-dim); }
.btn-danger:hover { background: #c43c3c20; }

.section {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-subtle);
}
.section-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 10px;
}
.description {
  font-size: 13px;
  color: var(--text-1);
  line-height: 1.65;
  white-space: pre-wrap;
}

/* Score */
.score-breakdown { display: flex; flex-direction: column; gap: 8px; }
.score-row { display: flex; align-items: center; gap: 8px; }
.score-label { font-size: 12px; color: var(--text-1); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.score-value { font-size: 12px; font-weight: 600; width: 50px; text-align: right; color: var(--accent); }
.penalty .score-value { color: var(--red); }
.score-total { display: flex; justify-content: space-between; padding-top: 8px; border-top: 1px solid var(--border); margin-top: 4px; }
.score-total-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.score-total-value { font-size: 24px; font-weight: 800; color: var(--accent); }

/* Motivation cards */
.motivation-card {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  margin-bottom: 6px;
}
.motivation-card-head { display: flex; align-items: center; gap: 8px; }
.motivation-card-title { font-size: 13px; font-weight: 500; flex: 1; }
.motivation-card-score { font-size: 12px; font-weight: 600; color: var(--accent); }
.motivation-open-link { font-size: 13px; color: var(--text-3); text-decoration: none; line-height: 1; flex-shrink: 0; transition: color var(--transition); }
.motivation-open-link:hover { color: var(--accent); }
.motivation-card-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.motivation-tag { font-size: 10px; padding: 1px 7px; cursor: default; }

/* External links */
.ext-link { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; }
.ext-type { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: var(--bg-3); color: var(--text-2); text-transform: uppercase; }
.ext-id { color: var(--teal); font-weight: 500; flex: 1; }
.ext-url { color: var(--blue); text-decoration: none; font-size: 12px; }
.ext-url:hover { text-decoration: underline; }
.add-link-form { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
.link-actions-row { display: flex; gap: 6px; margin-top: 8px; }
.publish-form { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
/* Two-class selector so this wins against the later .input { width: 100% } rule.
   Compact, left-aligned — sits on its own line above the action buttons. */
.publish-form .publish-type-select { width: auto; align-self: flex-start; min-width: 160px; }
.publish-type-static {
  align-self: flex-start;
  font-size: 11px; padding: 4px 8px; border-radius: var(--radius-sm);
  background: var(--bg-3); color: var(--text-2); text-transform: uppercase; font-weight: 600;
}
.publish-actions { display: flex; gap: 6px; }

/* Comments */
.comment { padding: 8px 0; border-bottom: 1px solid var(--border-subtle); }
.comment:last-of-type { border-bottom: none; }
.comment-meta { display: flex; justify-content: space-between; margin-bottom: 4px; }
.comment-author { font-size: 12px; font-weight: 600; color: var(--text-1); }
.comment-time { font-size: 10px; color: var(--text-3); }
.comment-body { font-size: 13px; color: var(--text-1); line-height: 1.5; }
.comment-input { display: flex; gap: 8px; margin-top: 8px; }
.comment-field { flex: 1; }
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

/* History */
.history-item { display: flex; gap: 10px; padding: 6px 0; font-size: 12px; align-items: flex-start; }
.history-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--border); margin-top: 5px; flex-shrink: 0; }
.history-text { color: var(--text-2); flex: 1; }
.history-text strong { color: var(--text-1); font-weight: 500; }
.history-time { font-size: 10px; color: var(--text-3); flex-shrink: 0; }
.show-more { width: 100%; margin-top: 8px; text-align: center; }

/* Mismatch indicators */
.mismatch-badge {
  font-size: 9px; font-weight: 600; padding: 1px 6px; border-radius: 8px;
  margin-left: 6px; text-transform: none; letter-spacing: 0;
}
.mismatch-critical { background: var(--red-dim); color: var(--red); }
.mismatch-warning { background: #c07a1a15; color: var(--accent); }

.card-mismatch-critical { border-left: 3px solid var(--red); }
.card-mismatch-warning { border-left: 3px solid var(--accent); }

.mismatch-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.mismatch-dot-critical { background: var(--red); }
.mismatch-dot-warning { background: var(--accent); }

.mismatch-info {
  font-size: 11px; color: var(--red); margin-top: 4px; padding-left: 16px;
  line-height: 1.4;
}
.card-mismatch-warning .mismatch-info { color: var(--accent); }

.empty { font-size: 12px; color: var(--text-3); padding: 8px 0; }

/* Link/unlink */
.unlink-btn {
  background: none; border: none; color: var(--text-3); cursor: pointer; font-size: 14px;
  padding: 0 4px; transition: color var(--transition); flex-shrink: 0;
}
.unlink-btn:hover { color: var(--red); }

.link-section { margin-top: 8px; }
.link-result {
  display: flex; align-items: center; gap: 8px; padding: 8px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  margin-top: 4px; cursor: pointer; transition: all var(--transition);
}
.link-result:hover { border-color: var(--teal); background: var(--teal-dim); }
.link-result-title { font-size: 12px; flex: 1; }
.link-result-score { font-size: 11px; font-weight: 600; color: var(--accent); }

.motivation-actions { display: flex; gap: 6px; margin-top: 8px; }
.input {
  font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 6px 10px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-1); color: var(--text-0); outline: none; width: 100%;
}
.input:focus { border-color: var(--accent); }
</style>
