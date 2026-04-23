<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { currentUser } from '../composables/useAuth';
import { toast } from '../composables/useToast';

interface UserRow {
  id: string;
  name: string;
  email?: string | null;
  role: string;
  status: string;
  initials: string;
  avatarUrl?: string | null;
  providerId: string;
  jobTitle?: string | null;
  lastLoginAt?: string | null;
  isConfiguredAdmin: boolean;
}

interface AuditEntry {
  id: string;
  actorUserId: string;
  action: string;
  fromRole?: string | null;
  toRole?: string | null;
  at: string;
}

interface DirectoryUser {
  providerId: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  handle?: string;
}

const users = ref<UserRow[]>([]);
const searchQuery = ref('');
const roleFilter = ref('');
const statusFilter = ref('');
const loading = ref(false);
const nextCursor = ref<string>();

// Add user panel
const showAddUser = ref(false);
const directoryQuery = ref('');
const directoryResults = ref<DirectoryUser[]>([]);
const directoryLoading = ref(false);
const addingUserId = ref<string | null>(null);

// Audit drawer
const auditUserId = ref<string | null>(null);
const auditEntries = ref<AuditEntry[]>([]);

let searchTimeout: ReturnType<typeof setTimeout> | undefined;

async function loadUsers(append = false) {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (searchQuery.value) params.set('q', searchQuery.value);
    if (roleFilter.value) params.set('role', roleFilter.value);
    if (statusFilter.value) params.set('status', statusFilter.value);
    if (append && nextCursor.value) params.set('cursor', nextCursor.value);

    const res = await fetch(`/api/admin/users?${params}`, { credentials: 'include', headers: { 'X-User-Id': currentUser.value?.id || '' } });
    if (!res.ok) throw new Error('Failed to load users');
    const data = await res.json();

    if (append) {
      users.value.push(...data.data);
    } else {
      users.value = data.data;
    }
    nextCursor.value = data.nextCursor;
  } catch (err: any) {
    toast.error(err.message);
  } finally {
    loading.value = false;
  }
}

function onSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadUsers(), 250);
}

async function changeRole(user: UserRow, newRole: string) {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUser.value?.id || '' },
      credentials: 'include',
      body: JSON.stringify({ role: newRole }),
    });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error?.message || 'Failed to change role');
      return;
    }
    const updated = await res.json();
    const idx = users.value.findIndex(u => u.id === user.id);
    if (idx >= 0) users.value[idx] = updated;
    toast.success(`${user.name} is now ${newRole}`);
  } catch (err: any) {
    toast.error(err.message);
  }
}

async function revokeUser(user: UserRow) {
  if (!confirm(`Revoke access for ${user.name}? They will be logged out on their next request.`)) return;
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/revoke`, {
      method: 'POST',
      headers: { 'X-User-Id': currentUser.value?.id || '' },
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error?.message || 'Failed to revoke');
      return;
    }
    const updated = await res.json();
    const idx = users.value.findIndex(u => u.id === user.id);
    if (idx >= 0) users.value[idx] = updated;
    toast.success(`${user.name} has been revoked`);
  } catch (err: any) {
    toast.error(err.message);
  }
}

async function restoreUser(user: UserRow) {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/restore`, {
      method: 'POST',
      headers: { 'X-User-Id': currentUser.value?.id || '' },
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error?.message || 'Failed to restore');
      return;
    }
    const updated = await res.json();
    const idx = users.value.findIndex(u => u.id === user.id);
    if (idx >= 0) users.value[idx] = updated;
    toast.success(`${user.name} has been restored`);
  } catch (err: any) {
    toast.error(err.message);
  }
}

async function openAudit(userId: string) {
  auditUserId.value = userId;
  auditEntries.value = [];
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/audit`, {
      credentials: 'include',
      headers: { 'X-User-Id': currentUser.value?.id || '' },
    });
    if (res.ok) auditEntries.value = await res.json();
  } catch { /* ignore */ }
}

async function searchDirectory() {
  if (directoryQuery.value.length < 2) { directoryResults.value = []; return; }
  directoryLoading.value = true;
  try {
    const res = await fetch(`/api/admin/directory?q=${encodeURIComponent(directoryQuery.value)}`, {
      credentials: 'include',
      headers: { 'X-User-Id': currentUser.value?.id || '' },
    });
    if (res.ok) {
      const data = await res.json();
      directoryResults.value = data.results || [];
    }
  } catch { /* ignore */ } finally {
    directoryLoading.value = false;
  }
}

function isAlreadyAdded(providerId: string): UserRow | undefined {
  const provider = currentUser.value?.id?.split(':')[0] || '';
  return users.value.find(u => u.id === `${provider}:${providerId}`);
}

async function addUser(du: DirectoryUser, role: string) {
  addingUserId.value = du.providerId;
  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUser.value?.id || '' },
      credentials: 'include',
      body: JSON.stringify({ providerId: du.providerId, name: du.name, email: du.email, avatarUrl: du.avatarUrl, role }),
    });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error?.message || 'Failed to add user');
      return;
    }
    const created = await res.json();
    users.value.unshift(created);
    toast.success(`${du.name} added as ${role}`);
    showAddUser.value = false;
    directoryQuery.value = '';
    directoryResults.value = [];
  } catch (err: any) {
    toast.error(err.message);
  } finally {
    addingUserId.value = null;
  }
}

onMounted(() => loadUsers());

watch([roleFilter, statusFilter], () => loadUsers());
</script>

<template>
  <div class="user-admin">
    <div class="page-header">
      <h1 class="page-title font-display">User Management</h1>
      <button class="btn btn-primary" @click="showAddUser = !showAddUser">
        {{ showAddUser ? 'Cancel' : '+ Add User' }}
      </button>
    </div>

    <!-- Add user panel -->
    <div v-if="showAddUser" class="add-user-panel">
      <h3>Search provider directory</h3>
      <input
        v-model="directoryQuery"
        class="input"
        placeholder="Search by name or handle..."
        @input="searchDirectory"
      />
      <div v-if="directoryLoading" class="loading">Searching...</div>
      <div v-for="du in directoryResults" :key="du.providerId" class="directory-result">
        <img v-if="du.avatarUrl" :src="du.avatarUrl" class="avatar-sm" alt="" />
        <div v-else class="avatar-sm avatar-placeholder">??</div>
        <div class="directory-info">
          <span class="directory-name">{{ du.name }}</span>
          <span v-if="du.handle" class="directory-handle">@{{ du.handle }}</span>
          <span v-if="du.email" class="directory-email">{{ du.email }}</span>
        </div>
        <template v-if="isAlreadyAdded(du.providerId)">
          <span class="already-badge">Already added ({{ isAlreadyAdded(du.providerId)!.role }})</span>
        </template>
        <template v-else>
          <button class="btn btn-sm" @click="addUser(du, 'modifier')" :disabled="addingUserId === du.providerId">Add as modifier</button>
        </template>
      </div>
    </div>

    <!-- Filters -->
    <div class="filters">
      <input v-model="searchQuery" class="input filter-search" placeholder="Search users..." @input="onSearchInput" />
      <div class="filter-chips">
        <button :class="['chip', { active: roleFilter === '' }]" @click="roleFilter = ''">All roles</button>
        <button :class="['chip', { active: roleFilter === 'admin' }]" @click="roleFilter = 'admin'">Admin</button>
        <button :class="['chip', { active: roleFilter === 'modifier' }]" @click="roleFilter = 'modifier'">Modifier</button>
        <button :class="['chip', { active: roleFilter === 'viewer' }]" @click="roleFilter = 'viewer'">Viewer</button>
        <span class="filter-sep">|</span>
        <button :class="['chip', { active: statusFilter === '' }]" @click="statusFilter = ''">All</button>
        <button :class="['chip', { active: statusFilter === 'active' }]" @click="statusFilter = 'active'">Active</button>
        <button :class="['chip', { active: statusFilter === 'revoked' }]" @click="statusFilter = 'revoked'">Revoked</button>
      </div>
    </div>

    <!-- User list -->
    <div class="user-list">
      <div v-for="user in users" :key="user.id" :class="['user-row', { revoked: user.status === 'revoked' }]">
        <div class="user-identity">
          <img v-if="user.avatarUrl" :src="user.avatarUrl" class="avatar-sm" alt="" />
          <div v-else class="avatar-sm avatar-placeholder">{{ user.initials }}</div>
          <div class="user-info">
            <div class="user-name-line">
              <span class="user-name">{{ user.name }}</span>
              <span v-if="user.isConfiguredAdmin" class="config-badge" title="Configured via ADMIN_USERS env var">Configured</span>
              <span v-if="user.status === 'revoked'" class="revoked-badge">Revoked</span>
            </div>
            <span class="user-detail">{{ user.providerId }}{{ user.email ? ` · ${user.email}` : '' }}</span>
          </div>
        </div>

        <div class="user-actions">
          <!-- Role dropdown -->
          <select
            :value="user.role"
            @change="changeRole(user, ($event.target as HTMLSelectElement).value)"
            class="input role-select"
            :disabled="user.id === currentUser?.id || user.isConfiguredAdmin"
            :title="user.id === currentUser?.id ? 'You can\'t change your own role' : user.isConfiguredAdmin ? 'Configured via ADMIN_USERS' : ''"
          >
            <option value="admin">Admin</option>
            <option value="modifier">Modifier</option>
            <option value="viewer">Viewer</option>
          </select>

          <!-- Last login -->
          <span class="last-login">{{ user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never' }}</span>

          <!-- Actions -->
          <button
            v-if="user.status === 'active'"
            class="btn btn-sm btn-danger"
            @click="revokeUser(user)"
            :disabled="user.id === currentUser?.id || user.isConfiguredAdmin"
            :title="user.id === currentUser?.id ? 'You can\'t revoke yourself' : user.isConfiguredAdmin ? 'Configured via ADMIN_USERS' : 'Revoke access'"
          >Revoke</button>
          <button
            v-else
            class="btn btn-sm"
            @click="restoreUser(user)"
            :disabled="user.isConfiguredAdmin"
          >Restore</button>

          <button class="btn btn-sm" @click="openAudit(user.id)" title="View audit log">Audit</button>
        </div>
      </div>

      <div v-if="users.length === 0 && !loading" class="empty">No users match the filter</div>

      <button v-if="nextCursor" class="btn load-more" @click="loadUsers(true)" :disabled="loading">
        {{ loading ? 'Loading...' : 'Load more' }}
      </button>
    </div>

    <!-- Audit drawer -->
    <div v-if="auditUserId" class="audit-drawer">
      <div class="audit-header">
        <h3>Audit Log</h3>
        <button class="btn btn-sm" @click="auditUserId = null">Close</button>
      </div>
      <div v-if="auditEntries.length === 0" class="empty">No audit entries</div>
      <div v-for="entry in auditEntries" :key="entry.id" class="audit-entry">
        <span class="audit-action">{{ entry.action }}</span>
        <span v-if="entry.fromRole" class="audit-change">{{ entry.fromRole }} &rarr; {{ entry.toRole || '—' }}</span>
        <span class="audit-date">{{ new Date(entry.at).toLocaleString() }}</span>
        <span class="audit-actor">by {{ entry.actorUserId }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.user-admin { padding: 24px 32px; max-width: 1100px; margin: 0 auto; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.page-title { font-size: 22px; font-weight: 700; }

.add-user-panel {
  background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 16px; margin-bottom: 20px;
}
.add-user-panel h3 { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
.directory-result {
  display: flex; align-items: center; gap: 10px; padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.directory-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.directory-name { font-weight: 600; font-size: 13px; }
.directory-handle { font-size: 12px; color: var(--text-2); }
.directory-email { font-size: 11px; color: var(--text-2); }
.already-badge {
  font-size: 11px; color: var(--text-2); background: var(--bg-3); padding: 2px 8px;
  border-radius: 8px;
}

.filters { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.filter-search { max-width: 260px; }
.filter-chips { display: flex; gap: 4px; align-items: center; }
.filter-sep { color: var(--border); margin: 0 4px; }
.chip {
  font-size: 11px; padding: 3px 10px; border: 1px solid var(--border); border-radius: 12px;
  background: var(--bg-1); color: var(--text-1); cursor: pointer;
}
.chip.active { background: var(--accent); color: #fff; border-color: var(--accent); }

.user-list { display: flex; flex-direction: column; gap: 2px; }
.user-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}
.user-row.revoked { opacity: 0.55; }
.user-identity { display: flex; align-items: center; gap: 10px; }
.avatar-sm { width: 32px; height: 32px; border-radius: 50%; }
.avatar-placeholder {
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-3); color: var(--text-2); font-size: 11px; font-weight: 700;
}
.user-info { display: flex; flex-direction: column; gap: 2px; }
.user-name-line { display: flex; align-items: center; gap: 6px; }
.user-name { font-weight: 600; font-size: 13px; }
.user-detail { font-size: 11px; color: var(--text-2); }
.config-badge {
  font-size: 9px; padding: 1px 5px; border-radius: 6px;
  background: var(--accent-dim, #e8f0eb); color: var(--accent); font-weight: 600;
}
.revoked-badge {
  font-size: 9px; padding: 1px 5px; border-radius: 6px;
  background: #fee2e2; color: #991b1b; font-weight: 600;
}

.user-actions { display: flex; align-items: center; gap: 8px; }
.role-select { width: 110px; font-size: 12px; padding: 4px 6px; }
.last-login { font-size: 11px; color: var(--text-2); min-width: 70px; text-align: center; }

.btn-danger { background: #dc2626; color: #fff; border-color: #dc2626; }
.btn-danger:hover { background: #b91c1c; }
.btn-danger:disabled { background: #fca5a5; border-color: #fca5a5; cursor: not-allowed; }

.load-more { margin: 12px auto; }
.loading { font-size: 12px; color: var(--text-2); padding: 8px 0; }
.empty { font-size: 13px; color: var(--text-2); padding: 20px 0; text-align: center; }

.audit-drawer {
  position: fixed; right: 0; top: 0; bottom: 0; width: 380px;
  background: var(--bg-0); border-left: 1px solid var(--border);
  padding: 20px; overflow-y: auto; z-index: 100;
  box-shadow: -4px 0 12px rgba(0,0,0,0.08);
}
.audit-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.audit-entry {
  display: flex; flex-direction: column; gap: 2px; padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle); font-size: 12px;
}
.audit-action { font-weight: 600; text-transform: capitalize; }
.audit-change { color: var(--text-1); }
.audit-date { color: var(--text-2); }
.audit-actor { color: var(--text-2); font-size: 11px; }
</style>
