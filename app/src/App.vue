<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api } from './composables/useApi';
import { useSSE } from './composables/useSSE';
import { toast } from './composables/useToast';
import { currentUser, isAdmin } from './composables/useAuth';
import { connectionState, startConnectionMonitor, stopConnectionMonitor } from './composables/useConnectionStatus';
import Walkthrough from './components/Walkthrough.vue';
import SearchBar from './components/SearchBar.vue';
import Toast from './components/Toast.vue';

const router = useRouter();
const route = useRoute();

// Redirect to login whenever the provider signals the session has expired
const { on } = useSSE();
on('session_expired', () => {
  toast.error('Your session has expired. Please sign in again.', { title: 'Session expired' });
  authenticatedUser.value = null;
  currentUser.value = null;
  stopConnectionMonitor();
  router.push('/login');
});

// Also redirect when the health monitor detects an expired token (HTTP 401 from /provider/health).
// Network errors stay as 'disconnected' and do NOT trigger a redirect.
watch(connectionState, (state) => {
  if (state === 'auth_expired' && route.path !== '/login') {
    toast.error('Your session has expired. Please sign in again.', { title: 'Session expired' });
    stopConnectionMonitor();
    authenticatedUser.value = null;
    currentUser.value = null;
    router.push('/login');
  }
});

const routeTitles: Record<string, string> = {
  timeline: 'Timeline',
  outcomes: 'Outcomes',
  motivations: 'Motivations',
  'tag-admin': 'Tags',
  'field-config-admin': 'Field Config',
  login: 'Login',
};

const UUID_TAIL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function titleFromSlugId(slugId: unknown): string | null {
  if (!slugId || typeof slugId !== 'string') return null;
  // Strip the trailing UUID (and any separator hyphen) to recover the human-readable slug.
  const slug = slugId.replace(UUID_TAIL, '').replace(/-$/, '').replace(/-/g, ' ').trim();
  return slug || null;
}

watch(() => [route.name, route.params.slugId], ([name]) => {
  const section = routeTitles[name as string] ?? 'moou';
  const item = titleFromSlugId(route.params.slugId);
  document.title = item ? `${section} · ${item}` : section;
}, { immediate: true });

const showUserMenu = ref(false);
const showWalkthrough = ref(false);
const showAdminMenu = ref(false);
const authenticatedUser = ref<any>(null);
const authChecked = ref(false);

onMounted(async () => {
  if (route.path === '/login') {
    // On the login page, check if already authenticated (e.g. stale tab after
    // OAuth completed in another context). If so, redirect to the app.
    try {
      const me = await api.getMe();
      authenticatedUser.value = me;
      authChecked.value = true;
      router.replace('/timeline');
      return;
    } catch {
      // Not authenticated — stay on login
    }
    authChecked.value = true;
    return;
  }
  await fetchMe();
});

// When the user logs in and is redirected away from /login, load their profile
watch(() => route.path, async (newPath, oldPath) => {
  if (oldPath === '/login' && newPath !== '/login') {
    await fetchMe();
  }
});

async function fetchMe() {
  try {
    const me = await api.getMe();
    authenticatedUser.value = me;
    currentUser.value = me;
    startConnectionMonitor();
  } catch {
    router.push('/login');
    authChecked.value = true;
    return;
  }
  authChecked.value = true;

  if (!localStorage.getItem('moou-walkthrough-seen')) {
    showWalkthrough.value = true;
  }
}

function closeWalkthrough() {
  showWalkthrough.value = false;
  localStorage.setItem('moou-walkthrough-seen', '1');
}

async function logout() {
  const provider = authenticatedUser.value?.provider || '';
  if (provider === 'valueedge') {
    await fetch('/auth/valueedge/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  } else {
    await api.logout();
  }
  authenticatedUser.value = null;
  currentUser.value = null;
  stopConnectionMonitor();
  router.push('/login');
}

// `routeName` matches the named route in router.ts and stays stable when a
// `:slugId?` segment is appended (e.g. /outcomes/upgrade-postgres-{uuid}).
// We used to compare against the full path, but that broke the active-tab
// underline as soon as the user selected an item in any list view.
const navItems = [
  { name: 'Timeline', route: '/timeline', routeName: 'timeline' },
  { name: 'Outcomes', route: '/outcomes', routeName: 'outcomes' },
  { name: 'Motivations', route: '/motivations', routeName: 'motivations' },
];
</script>

<template>
  <template v-if="route.path === '/login'">
    <router-view />
    <Toast />
  </template>
  <template v-else>
  <header class="topbar">
    <div class="logo font-display" @click="router.push('/timeline')">
      <svg class="logo-cow" viewBox="0 0 32 32" width="24" height="24">
        <ellipse cx="7" cy="8" rx="3.5" ry="2.5" fill="#c07a1a" transform="rotate(-20 7 8)"/>
        <ellipse cx="25" cy="8" rx="3.5" ry="2.5" fill="#c07a1a" transform="rotate(20 25 8)"/>
        <ellipse cx="16" cy="17" rx="10" ry="9" fill="#1a1a1a"/>
        <circle cx="12" cy="16" r="1.5" fill="#f0efe9"/>
        <circle cx="20" cy="16" r="1.5" fill="#f0efe9"/>
        <ellipse cx="16" cy="21.5" rx="5" ry="3.5" fill="#c07a1a" opacity="0.4"/>
        <ellipse cx="14" cy="22" rx="1" ry="0.7" fill="#f0efe9" opacity="0.5"/>
        <ellipse cx="18" cy="22" rx="1" ry="0.7" fill="#f0efe9" opacity="0.5"/>
      </svg>
      moou
    </div>

    <nav class="nav-tabs">
      <router-link
        v-for="item in navItems"
        :key="item.route"
        :to="item.route"
        class="nav-tab"
        :class="{ active: route.name === item.routeName }"
      >
        {{ item.name }}
      </router-link>
    </nav>

    <div class="topbar-right">
      <SearchBar />
      <div v-if="isAdmin" class="admin-dropdown">
        <button class="help-btn" @click="showAdminMenu = !showAdminMenu" title="Admin">⚙</button>
        <div v-if="showAdminMenu" class="admin-menu" @click.stop>
          <div class="admin-menu-item" @click="router.push('/admin/users'); showAdminMenu = false">Users</div>
          <div class="admin-menu-item" @click="router.push('/admin/tags'); showAdminMenu = false">Tags</div>
          <div class="admin-menu-item" @click="router.push('/admin/field-config'); showAdminMenu = false">Field Requirements</div>
        </div>
      </div>
      <button class="help-btn" @click="showWalkthrough = true" title="Help & walkthrough">?</button>
      <!-- Authenticated user (GitHub or ValueEdge) -->
      <div v-if="authenticatedUser" class="user-switcher" @click="showUserMenu = !showUserMenu">
        <img v-if="authenticatedUser.avatarUrl" :src="authenticatedUser.avatarUrl" class="avatar-img" />
        <div v-else class="avatar">{{ authenticatedUser.initials }}</div>
        <div class="user-info">
          <span class="user-name">{{ authenticatedUser.name }}</span><span v-if="currentUser?.role === 'admin'" class="role-label role-admin"> · Admin</span><span v-else-if="currentUser?.role === 'viewer'" class="role-label role-viewer"> · Read-only</span>
        </div>
        <div v-if="showUserMenu" class="user-menu">
          <div class="user-menu-item" @click.stop="logout">Sign out</div>
        </div>
      </div>
      <!-- Connection health — rightmost, least intrusive position -->
      <span
        v-if="connectionState !== 'idle'"
        class="connection-status"
        role="img"
        :aria-label="connectionState === 'connected' ? 'Backend connected' : connectionState === 'checking' ? 'Checking connection' : connectionState === 'auth_expired' ? 'Session expired' : 'Backend unreachable'"
        :title="connectionState === 'connected' ? 'Backend connected' : connectionState === 'checking' ? 'Checking connection...' : connectionState === 'auth_expired' ? 'Session expired — redirecting to login' : 'Backend unreachable (network error)'"
        tabindex="0"
      >{{ connectionState === 'connected' ? '🟢' : connectionState === 'checking' ? '🔵' : '🔴' }}</span>
    </div>
  </header>

  <main class="main-content">
    <router-view />
  </main>

  <Walkthrough v-if="showWalkthrough" @close="closeWalkthrough" />

  <Toast />
  </template>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  padding: 0 24px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--border);
  gap: 32px;
  height: 56px;
  flex-shrink: 0;
  z-index: 100;
}

.logo {
  font-weight: 800;
  font-size: 20px;
  letter-spacing: -0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.logo-cow {
  flex-shrink: 0;
}

.nav-tabs {
  display: flex;
  gap: 4px;
  height: 100%;
  align-items: stretch;
}
.nav-tab {
  display: flex;
  align-items: center;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all var(--transition);
  text-decoration: none;
}
.nav-tab:hover { color: var(--text-1); }
.nav-tab.active {
  color: var(--text-0);
  border-bottom-color: var(--accent);
}

.topbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 16px;
}

.help-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-2);
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.help-btn:hover { border-color: var(--accent); color: var(--accent); }

.admin-dropdown {
  position: relative;
}

.admin-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  min-width: 160px;
  z-index: 100;
  overflow: hidden;
}
.admin-menu-item {
  padding: 9px 14px;
  font-size: 13px;
  color: var(--text-1);
  cursor: pointer;
  transition: background var(--transition);
}
.admin-menu-item:hover { background: var(--bg-3); }

.user-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  position: relative;
  padding: 4px 8px;
  border-radius: var(--radius);
  transition: background var(--transition);
}
.user-switcher:hover { background: var(--bg-hover); }
.avatar-img { width: 28px; height: 28px; border-radius: 50%; }
.avatar {
  width: 28px; height: 28px; border-radius: 50%; background: var(--bg-3);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; color: var(--text-2);
}

.user-info {
  display: flex;
  align-items: baseline;
  white-space: nowrap;
  line-height: 1;
}
.user-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
}
.role-label {
  font-size: 11px;
  font-weight: 400;
}
.role-admin { color: var(--accent, #4a7c59); }
.role-viewer { color: #856404; }
.connection-status { font-size: 10px; cursor: default; line-height: 1; }
.user-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  min-width: 200px;
  z-index: 200;
  overflow: hidden;
}
.user-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-1);
  cursor: pointer;
  transition: background var(--transition);
}
.user-menu-item:hover { background: var(--bg-hover); }
.user-menu-item.active { background: var(--accent-dim); color: var(--accent); }

.main-content {
  flex: 1;
  overflow: hidden;
}
</style>
