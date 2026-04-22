<script setup lang="ts">
import { ref, onMounted, computed, onBeforeUnmount } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { api } from '../composables/useApi';
import TagPicker from './TagPicker.vue';

const props = defineProps<{
  outcome?: any; // existing outcome for edit mode, null for create
  defaultMilestoneId?: string | null;
  hideActions?: boolean;
}>();

const emit = defineEmits<{
  saved: [outcome: any];
  cancel: [];
}>();

const form = ref({
  title: '',
  description: '',
  effort: '' as string,
  milestoneId: '' as string,
  status: 'draft',
  tagIds: [] as string[],
});

const milestones = ref<any[]>([]);
const saving = ref(false);
const error = ref('');

const isHtml = computed(() => props.outcome?.descriptionFormat === 'html');
const editor = isHtml.value
  ? useEditor({
      content: '',  // Start empty, set content in onMounted
      extensions: [
        StarterKit,
        Link.configure({ openOnClick: false }),
      ],
    })
  : ref(null);
onBeforeUnmount(() => editor?.value?.destroy());

onMounted(async () => {
  const ms = await api.getMilestones();
  milestones.value = ms.data;

  if (props.outcome) {
    form.value = {
      title: props.outcome.title || '',
      description: props.outcome.description || '',
      effort: props.outcome.effort || '',
      milestoneId: props.outcome.milestoneId || '',
      status: props.outcome.status || 'draft',
      tagIds: props.outcome.ownTagIds ?? (props.outcome.tags || []).filter((t: any) => !t.inherited).map((t: any) => t.id),
    };
    if (editor.value) {
      editor.value.commands.setContent(props.outcome.description || '');
    }
  } else if (props.defaultMilestoneId) {
    form.value.milestoneId = props.defaultMilestoneId;
  }
});

const isEdit = computed(() => !!props.outcome);

async function save() {
  if (!form.value.title.trim()) {
    error.value = 'Title is required';
    return;
  }
  error.value = '';
  saving.value = true;
  try {
    const description = editor?.value
      ? (editor.value.getText().trim() ? editor.value.getHTML() : null)
      : (form.value.description.trim() || null);
    const data = {
      title: form.value.title.trim(),
      description,
      effort: form.value.effort || null,
      milestoneId: form.value.milestoneId || null,
      status: form.value.status,
      tagIds: form.value.tagIds,
    };

    let result;
    if (isEdit.value) {
      result = await api.updateOutcome(props.outcome.id, data);
    } else {
      result = await api.createOutcome(data);
    }
    emit('saved', result);
  } catch (err: any) {
    error.value = err.message || 'Failed to save';
  } finally {
    saving.value = false;
  }
}

defineExpose({ save });
</script>

<template>
  <div class="outcome-form">
    <h3 v-if="!hideActions" class="form-title font-display">{{ isEdit ? 'Edit Outcome' : 'New Outcome' }}</h3>

    <div v-if="error" class="form-error">{{ error }}</div>

    <div class="field">
      <label class="label">Title</label>
      <input v-model="form.title" class="input input-lg" placeholder="What's the desired result?" autofocus />
    </div>

    <div class="field">
      <label class="label">Description</label>
      <div v-if="isHtml && !editor" class="input textarea tiptap-loading">Loading editor...</div>
      <template v-else-if="isHtml && editor">
        <div class="tiptap-toolbar">
          <button type="button" :class="{ active: editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()">B</button>
          <button type="button" :class="{ active: editor.isActive('italic') }" @click="editor.chain().focus().toggleItalic().run()">I</button>
          <button type="button" :class="{ active: editor.isActive('bulletList') }" @click="editor.chain().focus().toggleBulletList().run()">&#8226; List</button>
          <button type="button" :class="{ active: editor.isActive('orderedList') }" @click="editor.chain().focus().toggleOrderedList().run()">1. List</button>
          <button type="button" :class="{ active: editor.isActive('blockquote') }" @click="editor.chain().focus().toggleBlockquote().run()">&#8220;</button>
        </div>
        <EditorContent :editor="editor" class="tiptap-editor" />
      </template>
      <textarea v-else v-model="form.description" class="input textarea" placeholder="Describe the outcome" rows="4"></textarea>
    </div>

    <div class="field-row">
      <div class="field">
        <label class="label">Effort</label>
        <select v-model="form.effort" class="input">
          <option value="">—</option>
          <option value="XS">XS</option>
          <option value="S">S</option>
          <option value="M">M</option>
          <option value="L">L</option>
          <option value="XL">XL</option>
        </select>
      </div>

      <div class="field">
        <label class="label">Status</label>
        <select v-model="form.status" class="input">
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="approved">Approved</option>
          <option value="deferred">Deferred</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      <div class="field">
        <label class="label">Milestone</label>
        <select v-model="form.milestoneId" class="input">
          <option value="">No milestone</option>
          <option v-for="ms in milestones" :key="ms.id" :value="ms.id">{{ ms.name }}</option>
        </select>
      </div>
    </div>

    <div class="field">
      <label class="label">Tags</label>
      <TagPicker v-model="form.tagIds" />
    </div>

    <div v-if="!hideActions" class="form-actions">
      <button class="btn" @click="emit('cancel')">Cancel</button>
      <button class="btn btn-primary" @click="save" :disabled="saving">
        {{ saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create Outcome') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.outcome-form { padding: 20px 24px; }
.form-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
.form-error { background: var(--red-dim); color: var(--red); padding: 8px 12px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 12px; }

.field { margin-bottom: 14px; }
.label { display: block; font-size: 11px; font-weight: 600; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
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
.input-lg { font-size: 15px; padding: 10px 12px; }
.textarea { resize: vertical; line-height: 1.5; font-family: 'JetBrains Mono', monospace; font-size: 12px; }

.field-row { display: flex; gap: 12px; }
.field-row .field { flex: 1; }

.tag-picker { display: flex; flex-wrap: wrap; gap: 6px; }
.tag-picker .tag { cursor: pointer; transition: all var(--transition); }
.tag-picker .tag.selected { border: 1px solid currentColor; font-weight: 600; }

.form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-subtle); }

.tiptap-toolbar {
  display: flex; gap: 4px; margin-bottom: 6px;
}
.tiptap-toolbar button {
  font-size: 12px; padding: 3px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-1); color: var(--text-1); cursor: pointer;
}
.tiptap-toolbar button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.tiptap-editor {
  border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-1);
  min-height: 100px; padding: 8px 10px; font-size: 13px; line-height: 1.5; color: var(--text-0);
}
.tiptap-editor :deep(.tiptap) { outline: none; min-height: 80px; }
.tiptap-editor :deep(p) { margin: 0.3em 0; }
.tiptap-editor :deep(ul), .tiptap-editor :deep(ol) { padding-left: 1.5em; }
.tiptap-editor :deep(blockquote) { border-left: 3px solid var(--border); padding-left: 10px; color: var(--text-2); }
</style>
