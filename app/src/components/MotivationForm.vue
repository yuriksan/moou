<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { api } from '../composables/useApi';
import TagPicker from './TagPicker.vue';

const props = defineProps<{
  motivation?: any;
  linkToOutcomeId?: string;
  hideActions?: boolean;
}>();

const emit = defineEmits<{
  saved: [motivation: any];
  cancel: [];
}>();

const motivationTypes = ref<any[]>([]);
const saving = ref(false);
const error = ref('');
const fieldErrors = ref<Record<string, string>>({});
const showAttributes = ref(false);

const form = ref({
  title: '',
  typeId: '',
  notes: '',
  attributes: {} as Record<string, unknown>,
  tagIds: [] as string[],
});

onMounted(async () => {
  const types = await api.getMotivationTypes();
  motivationTypes.value = types;

  if (props.motivation) {
    form.value = {
      title: props.motivation.title || '',
      typeId: props.motivation.typeId || '',
      notes: props.motivation.notes || '',
      attributes: { ...(props.motivation.attributes || {}) },
      tagIds: (props.motivation.tags || []).map((t: any) => t.id),
    };
    showAttributes.value = true;
  }
});

const isEdit = computed(() => !!props.motivation);
const selectedType = computed(() => motivationTypes.value.find(t => t.id === form.value.typeId));

const attributeFields = computed(() => {
  if (!selectedType.value?.attributeSchema?.properties) return [];
  return Object.entries(selectedType.value.attributeSchema.properties).map(([key, schema]: [string, any]) => ({
    key,
    label: key.replace(/_/g, ' '),
    type: schema.type,
    enum: schema.enum,
    minimum: schema.minimum,
    maximum: schema.maximum,
    format: schema.format,
  }));
});

// Reset attributes when type changes
watch(() => form.value.typeId, () => {
  if (!isEdit.value) form.value.attributes = {};
});

function getAttrInputType(field: any): string {
  if (field.enum) return 'select';
  if (field.type === 'boolean') return 'checkbox';
  if (field.format === 'date' || field.key.includes('date')) return 'date';
  // Use range slider for numbers where both min and max are defined and span ≤ 1
  if (field.type === 'number' && field.minimum !== undefined && field.maximum !== undefined && (field.maximum - field.minimum) <= 1) return 'range';
  if (field.type === 'number') return 'number';
  return 'text';
}

function constraintHint(field: any): string {
  if (field.type !== 'number') return '';
  if (field.minimum !== undefined && field.maximum !== undefined) return `${field.minimum} – ${field.maximum}`;
  if (field.minimum !== undefined) return `min ${field.minimum}`;
  if (field.maximum !== undefined) return `max ${field.maximum}`;
  return '';
}

async function save() {
  if (!form.value.title.trim()) { error.value = 'Title is required'; return; }
  if (!form.value.typeId) { error.value = 'Type is required'; return; }
  error.value = '';
  fieldErrors.value = {};
  saving.value = true;

  try {
    const data = {
      title: form.value.title.trim(),
      typeId: form.value.typeId,
      notes: form.value.notes.trim() || null,
      attributes: form.value.attributes,
      tagIds: form.value.tagIds,
    };

    let result;
    if (isEdit.value) {
      result = await api.updateMotivation(props.motivation.id, data);
    } else {
      result = await api.createMotivation(data);
    }

    // Link to outcome if specified
    if (props.linkToOutcomeId && !isEdit.value) {
      await api.linkMotivation(result.id, props.linkToOutcomeId);
    }

    emit('saved', result);
  } catch (err: any) {
    error.value = err.detail?.message || err.message || 'Failed to save';
    // Populate per-field errors from API validation details
    const details = err.detail?.details;
    if (Array.isArray(details)) {
      const fe: Record<string, string> = {};
      for (const d of details) {
        if (d.field) fe[d.field] = d.message;
      }
      fieldErrors.value = fe;
    }
  } finally {
    saving.value = false;
  }
}

defineExpose({ save });

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
  <div class="motivation-form">
    <h3 v-if="!hideActions" class="form-title font-display">{{ isEdit ? 'Edit Motivation' : 'New Motivation' }}</h3>

    <div v-if="error" class="form-error">{{ error }}</div>

    <!-- Quick fields (always visible) -->
    <div class="field">
      <label class="label">Title</label>
      <input v-model="form.title" class="input input-lg" placeholder="What's the motivation?" autofocus />
    </div>

    <div class="field">
      <label class="label">Type</label>
      <div class="type-picker">
        <button
          v-for="mt in motivationTypes" :key="mt.id"
          :class="['type-btn', pillClass(mt.name), { active: form.typeId === mt.id }]"
          @click="form.typeId = mt.id"
        >{{ mt.name }}</button>
      </div>
    </div>

    <!-- Expand for attributes (progressive disclosure) -->
    <button
      v-if="!showAttributes && form.typeId"
      class="btn btn-sm expand-btn"
      @click="showAttributes = true"
    >+ Add details</button>

    <template v-if="showAttributes && selectedType">
      <!-- Dynamic attribute fields -->
      <div class="attributes-section">
        <h4 class="section-label">{{ selectedType.name }} Details</h4>
        <div v-for="field in attributeFields" :key="field.key" class="field">
          <label class="label">
            {{ field.label }}
            <span v-if="constraintHint(field)" class="field-hint">({{ constraintHint(field) }})</span>
          </label>

          <select v-if="field.enum" v-model="form.attributes[field.key]" class="input">
            <option value="">—</option>
            <option v-for="opt in field.enum" :key="opt" :value="opt">{{ opt }}</option>
          </select>

          <!-- Range slider for bounded 0-1 numbers (e.g. confidence) -->
          <div v-else-if="getAttrInputType(field) === 'range'" class="range-field">
            <input
              v-model.number="form.attributes[field.key]"
              type="range"
              :min="field.minimum"
              :max="field.maximum"
              step="0.05"
              class="range-input"
            />
            <span class="range-value font-mono">{{ form.attributes[field.key] ?? field.minimum }}</span>
          </div>

          <input v-else-if="getAttrInputType(field) === 'number'"
            v-model.number="form.attributes[field.key]" type="number" class="input"
            :min="field.minimum" :max="field.maximum" />

          <input v-else-if="getAttrInputType(field) === 'date'"
            v-model="form.attributes[field.key]" type="date" class="input" />

          <label v-else-if="getAttrInputType(field) === 'checkbox'" class="checkbox-label">
            <input type="checkbox" v-model="form.attributes[field.key]" />
            {{ field.label }}
          </label>

          <input v-else v-model="form.attributes[field.key]" class="input" />

          <div v-if="fieldErrors[field.key]" class="field-error">{{ fieldErrors[field.key] }}</div>
        </div>
      </div>

      <!-- Notes -->
      <div class="field">
        <label class="label">Notes</label>
        <textarea v-model="form.notes" class="input textarea" placeholder="Supporting context, evidence..." rows="6"></textarea>
      </div>

      <!-- Tags -->
      <div class="field">
        <label class="label">Tags</label>
        <TagPicker v-model="form.tagIds" />
      </div>
    </template>

    <div v-if="!hideActions" class="form-actions">
      <button class="btn" @click="emit('cancel')">Cancel</button>
      <button class="btn btn-primary" @click="save" :disabled="saving">
        {{ saving ? 'Saving...' : (isEdit ? 'Save Changes' : (linkToOutcomeId ? 'Create & Link' : 'Create Motivation')) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.motivation-form { padding: 20px 24px; }
.form-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
.form-error { background: var(--red-dim); color: var(--red); padding: 8px 12px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 12px; }

.field { margin-bottom: 14px; }
.label { display: block; font-size: 11px; font-weight: 600; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.input {
  font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-1); color: var(--text-0); outline: none; width: 100%;
}
.input:focus { border-color: var(--accent); }
.input-lg { font-size: 15px; padding: 10px 12px; }
.textarea { resize: vertical; line-height: 1.5; }

.type-picker { display: flex; flex-wrap: wrap; gap: 6px; }
.type-btn {
  font-family: 'DM Sans', sans-serif; font-size: 11px; padding: 4px 12px;
  border-radius: 12px; border: 1px solid transparent; cursor: pointer;
  transition: all var(--transition); opacity: 0.7;
}
.type-btn:hover { opacity: 1; }
.type-btn.active { opacity: 1; border-color: currentColor; font-weight: 600; }

.expand-btn { width: 100%; text-align: center; margin-bottom: 14px; }

.attributes-section { border: 1px solid var(--border-subtle); border-radius: var(--radius); padding: 14px; margin-bottom: 14px; background: var(--bg-0); }
.section-label { font-size: 11px; font-weight: 600; color: var(--text-2); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }

.checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-1); cursor: pointer; }

.field-hint { font-size: 10px; color: var(--text-3); font-weight: 400; text-transform: none; letter-spacing: 0; margin-left: 4px; }
.field-error { font-size: 11px; color: var(--red); margin-top: 4px; }

.range-field { display: flex; align-items: center; gap: 10px; }
.range-input { flex: 1; accent-color: var(--accent); cursor: pointer; }
.range-value { font-size: 13px; font-weight: 600; color: var(--accent); min-width: 32px; text-align: right; }

.tag-picker { display: flex; flex-wrap: wrap; gap: 6px; }
.tag-picker .tag { cursor: pointer; }
.tag-picker .tag.selected { border: 1px solid currentColor; font-weight: 600; }

.form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-subtle); }
</style>
