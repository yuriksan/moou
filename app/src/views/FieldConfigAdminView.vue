<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { api } from '../composables/useApi';

// Provider + entity type come from the configured adapter; we discover them via
// the entity-types endpoint so the admin doesn't need to hard-code them.
const providerLabel = ref('');
const providerName = ref('');
const entityTypes = ref<{ name: string; label: string }[]>([]);
const selectedEntityType = ref('');
const rows = ref<any[]>([]);
const loading = ref(false);
const saving = ref(false);

// For the "add field" form
const newFieldName = ref('');
const newRequired = ref(true);

onMounted(async () => {
  try {
    const data = await api.getBackendEntityTypes();
    providerLabel.value = data.label || data.provider;
    providerName.value = data.provider;
    entityTypes.value = data.entityTypes || [];
    if (entityTypes.value.length) selectedEntityType.value = entityTypes.value[0].name;
  } catch { /* no adapter */ }
});

watch(selectedEntityType, loadRows);

async function loadRows() {
  if (!providerName.value || !selectedEntityType.value) return;
  loading.value = true;
  try {
    const res = await api.getFieldConfig(providerName.value, selectedEntityType.value);
    rows.value = res.data;
  } catch {
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

async function toggleRequired(row: any) {
  await api.upsertFieldConfig(providerName.value, selectedEntityType.value, row.fieldName, !row.required);
  await loadRows();
}

async function deleteRow(row: any) {
  if (!confirm(`Remove field config for "${row.fieldName}"?`)) return;
  await api.deleteFieldConfig(row.id);
  await loadRows();
}

async function addField() {
  const name = newFieldName.value.trim();
  if (!name || !providerName.value || !selectedEntityType.value) return;
  saving.value = true;
  try {
    await api.upsertFieldConfig(providerName.value, selectedEntityType.value, name, newRequired.value);
    newFieldName.value = '';
    await loadRows();
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="field-config-admin">
    <div class="admin-header">
      <h2 class="font-display">Field Requirements</h2>
      <span class="sub" v-if="providerLabel">{{ providerLabel }}</span>
    </div>

    <p class="hint">
      Override which fields are required when creating items in {{ providerLabel || 'the backend' }}.
      These settings take precedence over the provider's metadata.
    </p>

    <div v-if="!entityTypes.length" class="empty">
      No backend adapter configured. Set <code>EXTERNAL_PROVIDER</code> to enable this page.
    </div>

    <template v-else>
      <!-- Entity type picker -->
      <div class="type-row">
        <label class="type-label">Entity type</label>
        <select v-model="selectedEntityType" class="input type-select">
          <option v-for="t in entityTypes" :key="t.name" :value="t.name">{{ t.label }}</option>
        </select>
      </div>

      <!-- Config rows -->
      <div v-if="loading" class="loading">Loading...</div>

      <table v-else-if="rows.length" class="config-table">
        <thead>
          <tr>
            <th>Field name</th>
            <th>Required</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td class="font-mono">{{ row.fieldName }}</td>
            <td>
              <button
                :class="['toggle-btn', row.required ? 'toggle-on' : 'toggle-off']"
                @click="toggleRequired(row)"
              >
                {{ row.required ? 'Required' : 'Optional' }}
              </button>
            </td>
            <td>
              <button class="btn btn-sm btn-danger" @click="deleteRow(row)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">No overrides configured for this entity type.</div>

      <!-- Add field form -->
      <div class="add-form">
        <h3 class="add-title">Add override</h3>
        <div class="add-row">
          <input
            v-model="newFieldName"
            class="input field-input"
            placeholder="Field name (e.g. team, sprint)"
            @keyup.enter="addField"
          />
          <label class="req-label">
            <input type="checkbox" v-model="newRequired" />
            Required
          </label>
          <button class="btn btn-sm btn-primary" @click="addField" :disabled="!newFieldName.trim() || saving">
            {{ saving ? 'Saving…' : 'Add' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.field-config-admin {
  padding: 24px;
  max-width: 700px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
}

.admin-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.admin-header h2 { font-size: 20px; margin: 0; }
.sub { font-size: 13px; color: var(--text-3); }

.hint {
  font-size: 13px;
  color: var(--text-2);
  margin-bottom: 20px;
  line-height: 1.5;
}

.type-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.type-label { font-size: 13px; color: var(--text-2); white-space: nowrap; }
.type-select { width: auto; min-width: 180px; }

.loading { color: var(--text-3); font-size: 13px; padding: 12px 0; }

.config-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 24px;
  font-size: 13px;
}
.config-table th {
  text-align: left;
  padding: 6px 10px;
  color: var(--text-3);
  border-bottom: 1px solid var(--border);
  font-weight: 500;
}
.config-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.toggle-btn {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 600;
  transition: all var(--transition);
}
.toggle-on { background: var(--red-dim); color: var(--red); border-color: var(--red); }
.toggle-off { background: var(--bg-3); color: var(--text-2); border-color: var(--border); }
.toggle-on:hover { opacity: 0.8; }
.toggle-off:hover { border-color: var(--accent); color: var(--accent); }

.empty { color: var(--text-3); font-size: 13px; padding: 12px 0; }

.add-form { border-top: 1px solid var(--border); padding-top: 20px; }
.add-title { font-size: 14px; font-weight: 600; margin: 0 0 10px; }
.add-row { display: flex; align-items: center; gap: 10px; }
.field-input { flex: 1; }
.req-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
  white-space: nowrap;
}

.input {
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-1);
  color: var(--text-0);
  outline: none;
  width: 100%;
}
.input:focus { border-color: var(--accent); }
</style>
