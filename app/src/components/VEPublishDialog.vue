<script setup lang="ts">
/**
 * VEPublishDialog — ValueEdge publish form.
 *
 * Renders a multi-step form to create a new Epic, Feature, or Story in ValueEdge:
 *   Step 1 — choose entity type
 *   Step 2 — pick parent (epic picker for features, feature picker for stories; skipped for epics)
 *   Step 3 — fill in fields (name pre-filled, description pre-filled, phase, optional fields)
 */
import { ref, watch, computed } from 'vue';
import { api } from '../composables/useApi';

const props = defineProps<{
  outcomeId: string;
  entityTypes: Array<{ name: string; label: string; default?: boolean; parentEntityType?: string }>;
  providerLabel: string;
  /** Pre-filled from the outcome */
  title: string;
  description?: string;
}>();

const emit = defineEmits<{
  published: [link: any];
  cancel: [];
}>();

// ─── Step state ───
type Step = 'type' | 'parent' | 'fields';
const step = ref<Step>('type');

// ─── Type selection ───
const selectedType = ref(props.entityTypes.find(t => t.default)?.name ?? props.entityTypes[0]?.name ?? '');

// ─── Parent picker ───
const parentQuery = ref('');
const parentResults = ref<any[]>([]);
const parentSelected = ref<{ id: string; name: string; description?: string; htmlUrl: string } | null>(null);
const parentSearching = ref(false);
let parentDebounce: ReturnType<typeof setTimeout>;

// Create options loaded from backend (field metadata)
const createOptions = ref<{ fields: any[]; parentEntityType: string | null; parentEntityTypeLabel: string | null } | null>(null);
const loadingOptions = ref(false);

// ─── Field values ───
const fieldValues = ref<Record<string, any>>({});

// Inline search for reference fields (team, release, sprint, owner)
const refSearch = ref<Record<string, string>>({});
const refResults = ref<Record<string, any[]>>({});
const refSelected = ref<Record<string, { id: string; name: string } | null>>({});
let refDebounce: Record<string, ReturnType<typeof setTimeout>> = {};

const error = ref('');
const publishing = ref(false);

// ─── Computed helpers ───
const selectedTypeLabel = computed(
  () => props.entityTypes.find(t => t.name === selectedType.value)?.label ?? selectedType.value,
);

const needsParent = computed(() => !!createOptions.value?.parentEntityType);

// Phase options from the create options fields
const phaseOptions = computed(
  () => createOptions.value?.fields.find(f => f.name === 'phase')?.options ?? [],
);

// ─── Steps ───
async function goToParentOrFields() {
  error.value = '';
  loadingOptions.value = true;
  try {
    createOptions.value = await api.getCreateOptions(selectedType.value);
    // Default phase to "New"
    const phases = createOptions.value?.fields.find(f => f.name === 'phase')?.options ?? [];
    const newPhase = phases.find((p: any) => p.name.toLowerCase() === 'new') ?? phases[0];
    if (newPhase) fieldValues.value['phase'] = newPhase.id;
  } catch {
    createOptions.value = null;
  } finally {
    loadingOptions.value = false;
  }

  if (needsParent.value) {
    step.value = 'parent';
  } else {
    step.value = 'fields';
  }
}

function selectParent(item: any) {
  parentSelected.value = { id: item.entityId, name: item.title, description: item.description, htmlUrl: item.htmlUrl };
  step.value = 'fields';
}

// ─── Parent search ───
watch(parentQuery, (q) => {
  clearTimeout(parentDebounce);
  if (!q.trim()) { parentResults.value = []; return; }
  parentDebounce = setTimeout(async () => {
    parentSearching.value = true;
    try {
      const parentType = createOptions.value?.parentEntityType ?? '';
      const data = await api.searchBackend(q.trim(), parentType);
      parentResults.value = data.items;
    } catch {
      parentResults.value = [];
    } finally {
      parentSearching.value = false;
    }
  }, 300);
});

// ─── Inline reference field search ───
function searchRef(fieldName: string, entityType: string) {
  clearTimeout(refDebounce[fieldName]);
  const q = refSearch.value[fieldName] ?? '';
  if (!q.trim()) { refResults.value[fieldName] = []; return; }
  refDebounce[fieldName] = setTimeout(async () => {
    try {
      const data = await api.searchBackend(q.trim(), entityType);
      refResults.value[fieldName] = data.items;
    } catch {
      refResults.value[fieldName] = [];
    }
  }, 300);
}

function selectRef(fieldName: string, item: any) {
  refSelected.value[fieldName] = { id: item.entityId, name: item.title };
  refSearch.value[fieldName] = item.title;
  refResults.value[fieldName] = [];
}

function clearRef(fieldName: string) {
  refSelected.value[fieldName] = null;
  refSearch.value[fieldName] = '';
}

// ─── Publish ───
async function publish() {
  error.value = '';
  publishing.value = true;

  try {
    // Build extra fields payload
    const extra: Record<string, any> = {};

    // Selected phase
    if (fieldValues.value['phase']) {
      extra.phase = { type: 'phase', id: fieldValues.value['phase'] };
    }

    // list_node fields (priority etc.)
    for (const field of (createOptions.value?.fields ?? [])) {
      if (field.fieldType === 'list_node' && field.name !== 'phase') {
        const v = fieldValues.value[field.name];
        if (v) extra[field.name] = { type: 'list_node', id: v };
      }
      if (field.fieldType === 'integer' && field.name !== 'phase') {
        const v = fieldValues.value[field.name];
        if (v !== undefined && v !== '') extra[field.name] = Number(v);
      }
    }

    // Reference fields selected via inline search
    for (const [key, sel] of Object.entries(refSelected.value)) {
      if (sel) {
        const field = createOptions.value?.fields.find(f => f.name === key);
        extra[key] = { type: field?.referenceType ?? key, id: sel.id };
      }
    }

    const link = await api.publishOutcome(
      props.outcomeId,
      selectedType.value,
      parentSelected.value?.id,
      createOptions.value?.parentEntityType ?? undefined,
      extra,
    );
    emit('published', link);
  } catch (err: any) {
    error.value = err.message || 'Failed to publish';
  } finally {
    publishing.value = false;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
</script>

<template>
  <div class="ve-publish">
    <div class="dialog-header">
      <h3 class="font-display dialog-title">Publish to {{ providerLabel }}</h3>
      <div class="step-pills">
        <span :class="['step-pill', step === 'type' ? 'active' : 'done']">1 Type</span>
        <span class="step-sep">›</span>
        <span :class="['step-pill', step === 'parent' ? 'active' : step === 'fields' ? 'done' : '']">2 Parent</span>
        <span class="step-sep">›</span>
        <span :class="['step-pill', step === 'fields' ? 'active' : '']">3 Details</span>
      </div>
    </div>

    <div v-if="error" class="dialog-error">{{ error }}</div>

    <!-- Step 1: Entity Type -->
    <div v-if="step === 'type'" class="step-body">
      <p class="step-label">What type of item are you creating?</p>
      <div class="type-grid">
        <button
          v-for="t in entityTypes.filter(t => t.name !== 'pr')"
          :key="t.name"
          :class="['type-card', { selected: selectedType === t.name }]"
          @click="selectedType = t.name"
        >
          <span class="type-name">{{ t.label }}</span>
          <span v-if="t.parentEntityType" class="type-hint">needs a parent {{ t.parentEntityType }}</span>
          <span v-else class="type-hint">top-level item</span>
        </button>
      </div>
      <div class="step-actions">
        <button class="btn btn-sm" @click="emit('cancel')">Cancel</button>
        <button class="btn btn-sm btn-primary" :disabled="!selectedType || loadingOptions" @click="goToParentOrFields">
          {{ loadingOptions ? 'Loading...' : 'Next →' }}
        </button>
      </div>
    </div>

    <!-- Step 2: Parent picker -->
    <div v-if="step === 'parent'" class="step-body">
      <p class="step-label">
        Select a parent <strong>{{ createOptions?.parentEntityTypeLabel }}</strong> to file this {{ selectedTypeLabel }} under:
      </p>

      <input
        v-model="parentQuery"
        class="input"
        :placeholder="`Search ${createOptions?.parentEntityTypeLabel ?? 'parent'} items…`"
        autofocus
      />

      <div v-if="parentSearching" class="searching">Searching…</div>

      <div class="parent-results">
        <div
          v-for="item in parentResults"
          :key="item.entityId"
          :class="['parent-item', { 'parent-selected': parentSelected?.id === item.entityId }]"
          @click="selectParent(item)"
        >
          <div class="parent-item-head">
            <span class="parent-item-id font-mono">#{{ item.entityId }}</span>
            <span class="parent-item-state state-badge">{{ item.state }}</span>
            <span class="parent-item-title">{{ item.title }}</span>
            <a
              v-if="item.htmlUrl"
              :href="item.htmlUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="parent-item-link"
              @click.stop
              title="Open in ValueEdge"
            >↗</a>
          </div>
          <p v-if="item.description" class="parent-item-desc">{{ stripHtml(item.description).slice(0, 160) }}…</p>
        </div>

        <div v-if="!parentSearching && parentQuery && parentResults.length === 0" class="no-results">
          No {{ createOptions?.parentEntityTypeLabel }} items found
        </div>
        <div v-if="!parentQuery" class="no-results">
          Start typing to search…
        </div>
      </div>

      <div v-if="parentSelected" class="parent-confirmed">
        ✓ Selected: <strong>{{ parentSelected.name }}</strong>
        <a :href="parentSelected.htmlUrl" target="_blank" rel="noopener noreferrer" class="parent-confirmed-link">↗</a>
      </div>

      <div class="step-actions">
        <button class="btn btn-sm" @click="step = 'type'">← Back</button>
        <button class="btn btn-sm btn-primary" :disabled="!parentSelected" @click="step = 'fields'">
          Next →
        </button>
      </div>
    </div>

    <!-- Step 3: Fields -->
    <div v-if="step === 'fields'" class="step-body">
      <div v-if="parentSelected" class="parent-summary">
        Filing under: <strong>{{ createOptions?.parentEntityTypeLabel }} #{{ parentSelected.id }}</strong>
        — {{ parentSelected.name }}
        <a :href="parentSelected.htmlUrl" target="_blank" rel="noopener noreferrer" class="parent-confirmed-link">↗</a>
        <button class="btn-link" @click="step = 'parent'">change</button>
      </div>

      <!-- Phase -->
      <div v-if="phaseOptions.length > 0" class="field-row">
        <label class="field-label">Phase <span class="required">*</span></label>
        <select v-model="fieldValues['phase']" class="input">
          <option v-for="p in phaseOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>

      <!-- Dynamic fields from createOptions -->
      <template v-for="field in (createOptions?.fields ?? []).filter(f => f.name !== 'phase')" :key="field.name">

        <!-- list_node dropdown (e.g. priority) -->
        <div v-if="field.fieldType === 'list_node' && field.options?.length" class="field-row">
          <label class="field-label">
            {{ field.label }}
            <span v-if="field.required" class="required">*</span>
          </label>
          <select v-model="fieldValues[field.name]" class="input">
            <option value="">— none —</option>
            <option v-for="opt in field.options" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
          </select>
        </div>

        <!-- integer field (story_points) -->
        <div v-else-if="field.fieldType === 'integer'" class="field-row">
          <label class="field-label">
            {{ field.label }}
            <span v-if="field.required" class="required">*</span>
          </label>
          <input
            v-model.number="fieldValues[field.name]"
            type="number"
            min="0"
            class="input input-narrow"
            :placeholder="field.label"
          />
        </div>

        <!-- reference field with live search (team, release, sprint, owner) -->
        <div v-else-if="field.fieldType === 'reference' && field.searchEntityType" class="field-row">
          <label class="field-label">
            {{ field.label }}
            <span v-if="field.required" class="required">*</span>
          </label>
          <div class="ref-search-wrap">
            <input
              v-model="refSearch[field.name]"
              class="input"
              :placeholder="`Search ${field.label}…`"
              @input="searchRef(field.name, field.searchEntityType)"
            />
            <button
              v-if="refSelected[field.name]"
              class="btn-link ref-clear"
              @click="clearRef(field.name)"
              title="Clear"
            >×</button>
          </div>
          <div v-if="refResults[field.name]?.length" class="ref-results">
            <div
              v-for="item in refResults[field.name]"
              :key="item.entityId"
              class="ref-result-item"
              @click="selectRef(field.name, item)"
            >
              <span class="ref-item-id font-mono">#{{ item.entityId }}</span>
              <span class="ref-item-name">{{ item.title }}</span>
              <a
                v-if="item.htmlUrl"
                :href="item.htmlUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="ref-item-link"
                @click.stop
                title="Open in ValueEdge"
              >↗</a>
            </div>
          </div>
        </div>

      </template>

      <div class="step-actions">
        <button class="btn btn-sm" @click="needsParent ? (step = 'parent') : (step = 'type')">← Back</button>
        <button class="btn btn-sm btn-primary" :disabled="publishing" @click="publish">
          {{ publishing ? 'Creating…' : `Create ${selectedTypeLabel}` }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ve-publish { padding: 20px 24px; min-width: 460px; }

.dialog-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; gap: 16px; }
.dialog-title { font-size: 15px; font-weight: 700; }
.step-pills { display: flex; gap: 4px; align-items: center; }
.step-pill { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--bg-3); color: var(--text-2); font-weight: 500; }
.step-pill.active { background: var(--accent-mid); color: var(--accent); }
.step-pill.done { background: var(--green-dim); color: var(--green); }
.step-sep { color: var(--text-3); font-size: 10px; }

.dialog-error { background: var(--red-dim); color: var(--red); padding: 8px 12px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 12px; }

.step-body { display: flex; flex-direction: column; gap: 12px; }
.step-label { font-size: 13px; color: var(--text-1); }

/* Type grid */
.type-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.type-card { padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-1); cursor: pointer; text-align: left; transition: all var(--transition); display: flex; flex-direction: column; gap: 4px; }
.type-card:hover { border-color: var(--accent); background: var(--accent-dim); }
.type-card.selected { border-color: var(--accent); background: var(--accent-mid); }
.type-name { font-size: 13px; font-weight: 600; }
.type-hint { font-size: 10px; color: var(--text-2); }

/* Parent search */
.input { font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-1); color: var(--text-0); outline: none; width: 100%; }
.input:focus { border-color: var(--accent); }
.input-narrow { width: 100px; }

.searching { font-size: 12px; color: var(--text-3); text-align: center; padding: 8px 0; }
.no-results { font-size: 12px; color: var(--text-3); padding: 12px; text-align: center; }

.parent-results { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.parent-item { padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); cursor: pointer; transition: all var(--transition); }
.parent-item:hover { border-color: var(--teal); background: var(--teal-dim); }
.parent-item.parent-selected { border-color: var(--teal); background: var(--teal-dim); }
.parent-item-head { display: flex; align-items: center; gap: 8px; }
.parent-item-id { font-size: 11px; color: var(--text-2); }
.parent-item-title { font-size: 13px; font-weight: 500; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.parent-item-state { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--bg-3); color: var(--text-2); font-weight: 600; text-transform: uppercase; }
.parent-item-link { font-size: 12px; color: var(--teal); text-decoration: none; flex-shrink: 0; padding: 2px 4px; border-radius: 3px; }
.parent-item-link:hover { background: var(--teal-dim); }
.parent-item-desc { font-size: 11px; color: var(--text-2); margin-top: 4px; line-height: 1.4; }

.parent-confirmed { font-size: 12px; color: var(--green); background: var(--green-dim); padding: 8px 12px; border-radius: var(--radius-sm); display: flex; align-items: center; gap: 6px; }
.parent-confirmed-link { color: var(--teal); text-decoration: none; font-size: 12px; }
.parent-confirmed-link:hover { text-decoration: underline; }
.parent-summary { font-size: 12px; color: var(--text-1); background: var(--bg-2); padding: 8px 12px; border-radius: var(--radius-sm); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* Field rows */
.field-row { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-size: 12px; font-weight: 500; color: var(--text-1); }
.required { color: var(--red); margin-left: 2px; }

/* Reference search */
.ref-search-wrap { position: relative; }
.ref-clear { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 14px; color: var(--text-2); cursor: pointer; background: none; border: none; padding: 0; }
.ref-results { border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-1); max-height: 160px; overflow-y: auto; }
.ref-result-item { padding: 7px 10px; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: background var(--transition); }
.ref-result-item:hover { background: var(--bg-hover); }
.ref-item-id { font-size: 10px; color: var(--text-2); font-weight: 600; }
.ref-item-name { font-size: 12px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ref-item-link { font-size: 11px; color: var(--teal); text-decoration: none; flex-shrink: 0; }
.ref-item-link:hover { text-decoration: underline; }

/* Actions */
.step-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border-subtle); }
.btn { font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 7px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-1); color: var(--text-0); cursor: pointer; transition: all var(--transition); }
.btn:hover { background: var(--bg-2); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-sm { font-size: 12px; padding: 5px 11px; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: white; }
.btn-primary:hover:not(:disabled) { opacity: 0.9; }
.btn-link { background: none; border: none; color: var(--teal); font-size: 11px; cursor: pointer; text-decoration: underline; padding: 0; font-family: inherit; }
</style>
