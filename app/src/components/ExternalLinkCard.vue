<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { api } from '../composables/useApi';

const props = defineProps<{
  link: any;
  isPrimary?: boolean;
}>();

const emit = defineEmits<{
  refreshed: [];
  deleted: [];
  setPrimary: [];
  clearPrimary: [];
}>();

const refreshing = ref(false);
const settingPrimary = ref(false);

const details = computed(() => props.link.cachedDetails as Record<string, unknown> | null);
const hasDetails = computed(() => !!details.value?.title);
const progress = computed(() => details.value?.childProgress as { total: number; completed: number; inProgress: number } | null);
const progressPercent = computed(() => {
  if (!progress.value || progress.value.total === 0) return 0;
  return Math.round((progress.value.completed / progress.value.total) * 100);
});

function timeAgo(dateStr: string | undefined): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function stateClass(state: string): string {
  const map: Record<string, string> = {
    open: 'state-open', closed: 'state-closed', merged: 'state-merged',
    draft: 'state-draft', done: 'state-closed', 'in-progress': 'state-open',
    new: 'state-draft',
  };
  return map[state] || '';
}

async function refresh() {
  refreshing.value = true;
  try {
    await api.refreshExternalLink(props.link.id);
    emit('refreshed');
  } catch { /* error surfaced via toast by useApi */ } finally {
    refreshing.value = false;
  }
}

async function disconnect() {
  if (!confirm('Disconnect this item? The backend item will NOT be deleted.')) return;
  await api.deleteExternalLink(props.link.id);
  emit('deleted');
}

function togglePrimary() {
  settingPrimary.value = true;
  if (props.isPrimary) {
    emit('clearPrimary');
  } else {
    emit('setPrimary');
  }
}

// The parent performs the async API call and reloads data, which updates
// the isPrimary prop. Watch for that change to clear the loading state.
watch(() => props.isPrimary, () => {
  settingPrimary.value = false;
});
</script>

<template>
  <div class="link-card" :class="[`link-${props.link.connectionState}`, { 'link-primary': isPrimary }]">
    <!-- Rich details (when cached) -->
    <template v-if="hasDetails">
      <div class="link-head">
        <span v-if="isPrimary" class="primary-badge" title="Primary item">★ Primary</span>
        <span :class="['state-badge', stateClass(details!.state as string)]">{{ details!.state }}</span>
        <span class="link-type font-mono">{{ props.link.entityType }}</span>
        <span class="link-id font-mono">#{{ props.link.entityId }}</span>
        <span class="connection-badge">{{ props.link.connectionState }}</span>
        <div class="link-actions">
          <button class="btn-icon" @click.stop="togglePrimary" :disabled="settingPrimary" :title="isPrimary ? 'Remove primary' : 'Set as primary'">{{ isPrimary ? '★' : '☆' }}</button>
          <button class="btn-icon" @click.stop="refresh" :disabled="refreshing" title="Refresh">↻</button>
          <button class="btn-icon btn-icon-danger" @click.stop="disconnect" title="Disconnect">×</button>
        </div>
      </div>

      <a :href="props.link.url as string" target="_blank" class="link-title">{{ details!.title }}</a>

      <div class="link-meta">
        <span v-for="label in (details!.labels as any[] || []).slice(0, 4)" :key="label.name"
          class="link-label"
          :style="label.color ? { background: `#${label.color}20`, color: `#${label.color}` } : {}"
        >{{ label.name }}</span>

        <span v-if="(details!.assignee as any)?.login" class="link-assignee">
          <img v-if="(details!.assignee as any)?.avatarUrl" :src="(details!.assignee as any).avatarUrl" class="link-avatar" />
          {{ (details!.assignee as any).login }}
        </span>

        <span v-if="(details!.milestone as any)?.title" class="link-milestone font-mono">
          {{ (details!.milestone as any).title }}
        </span>
      </div>

      <!-- Progress bar -->
      <div v-if="progress && progress.total > 0" class="progress-section">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${progressPercent}%` }"></div>
        </div>
        <span class="progress-label font-mono">{{ progress.completed }}/{{ progress.total }} done</span>
      </div>

      <!-- Freshness -->
      <div class="link-freshness">
        <span class="freshness-text">Updated {{ timeAgo(details!.fetchedAt as string) }}</span>
        <span v-if="refreshing" class="refreshing-text">Refreshing...</span>
      </div>
    </template>

    <!-- Minimal display (no cached details) -->
    <template v-else>
      <div class="link-head">
        <span v-if="isPrimary" class="primary-badge" title="Primary item">★ Primary</span>
        <span class="link-type font-mono">{{ props.link.entityType }}</span>
        <span class="link-id font-mono">{{ props.link.entityId }}</span>
        <a v-if="props.link.url" :href="props.link.url" target="_blank" class="link-url">↗</a>
        <div class="link-actions">
          <button class="btn-icon" @click.stop="togglePrimary" :disabled="settingPrimary" :title="isPrimary ? 'Remove primary' : 'Set as primary'">{{ isPrimary ? '★' : '☆' }}</button>
          <button class="btn-icon btn-icon-danger" @click.stop="disconnect" title="Remove">×</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.link-card {
  background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 10px 12px; margin-bottom: 6px; transition: all var(--transition);
}
.link-card:hover { border-color: var(--text-3); }
.link-connected { border-left: 3px solid var(--teal); }
.link-published { border-left: 3px solid var(--accent); }
.link-primary { border-left: 3px solid var(--yellow, #c07a1a); background: var(--bg-1); }

.primary-badge {
  font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 8px;
  background: var(--yellow-dim, #c07a1a22); color: var(--yellow, #c07a1a);
  white-space: nowrap;
}

.link-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.link-type { font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: var(--bg-3); color: var(--text-2); text-transform: uppercase; }
.link-id { font-size: 11px; color: var(--text-2); }
.link-url { color: var(--blue); text-decoration: none; font-size: 12px; }
.connection-badge { font-size: 9px; padding: 1px 5px; border-radius: 8px; background: var(--bg-3); color: var(--text-3); margin-left: auto; }
.link-connected .connection-badge { background: var(--teal-dim); color: var(--teal); }
.link-published .connection-badge { background: var(--accent-dim); color: var(--accent); }

.link-actions { display: flex; gap: 2px; margin-left: 4px; }
.btn-icon {
  background: none; border: 1px solid transparent; color: var(--text-3); cursor: pointer;
  font-size: 14px; padding: 0 4px; border-radius: var(--radius-sm); transition: all var(--transition);
}
.btn-icon:hover { border-color: var(--border); color: var(--text-1); }
.btn-icon-danger:hover { border-color: var(--red); color: var(--red); }
.btn-icon:disabled { opacity: 0.3; cursor: default; }

.state-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
.state-open { background: var(--green-dim); color: var(--green); }
.state-closed { background: var(--red-dim); color: var(--red); }
.state-merged { background: var(--purple-dim); color: var(--purple); }
.state-draft { background: var(--bg-3); color: var(--text-2); }

.link-title { font-size: 13px; font-weight: 500; color: var(--text-0); text-decoration: none; display: block; margin-bottom: 6px; }
.link-title:hover { color: var(--blue); text-decoration: underline; }

.link-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
.link-label { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--bg-3); color: var(--text-2); }
.link-assignee { font-size: 11px; color: var(--text-2); display: flex; align-items: center; gap: 3px; }
.link-avatar { width: 16px; height: 16px; border-radius: 50%; }
.link-milestone { font-size: 10px; color: var(--text-3); background: var(--bg-3); padding: 1px 6px; border-radius: 8px; }

.progress-section { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.progress-bar { flex: 1; height: 6px; background: var(--bg-3); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--green); border-radius: 3px; transition: width 300ms ease; }
.progress-label { font-size: 10px; color: var(--text-2); white-space: nowrap; }

.link-freshness { display: flex; gap: 8px; align-items: center; }
.freshness-text { font-size: 10px; color: var(--text-3); }
.refreshing-text { font-size: 10px; color: var(--accent); }
</style>
