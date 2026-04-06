<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getCurrentUser, setCurrentUser, api } from './composables/useApi';
import Walkthrough from './components/Walkthrough.vue';
import SearchBar from './components/SearchBar.vue';
import Toast from './components/Toast.vue';

const router = useRouter();
const route = useRoute();

const MOCK_USERS = [
  { id: 'sarah-chen', name: 'Sarah Chen', initials: 'SC' },
  { id: 'james-obi', name: 'James Obi', initials: 'JO' },
  { id: 'dev-patel', name: 'Dev Patel', initials: 'DP' },
  { id: 'anna-mueller', name: 'Anna Müller', initials: 'AM' },
];

const currentUserId = ref(getCurrentUser());
const showUserMenu = ref(false);
const showWalkthrough = ref(false);
const authenticatedUser = ref<any>(null);
const isGitHubAuth = ref(false);
const authChecked = ref(false);

onMounted(async () => {
  // Try to get authenticated user from session
  try {
    const me = await api.getMe();
    authenticatedUser.value = me;
    isGitHubAuth.value = me.provider === 'github';
    // Set the user ID for API calls
    if (me.id) setCurrentUser(me.id);
  } catch {
    // Not authenticated — that's fine in mock mode
  }
  authChecked.value = true;

  if (!localStorage.getItem('moou-walkthrough-seen')) {
    showWalkthrough.value = true;
  }
});

function closeWalkthrough() {
  showWalkthrough.value = false;
  localStorage.setItem('moou-walkthrough-seen', '1');
}

async function logout() {
  await api.logout();
  authenticatedUser.value = null;
  window.location.href = '/auth/github';
}

function switchUser(userId: string) {
  setCurrentUser(userId);
  currentUserId.value = userId;
  showUserMenu.value = false;
}

const currentUser = () => MOCK_USERS.find(u => u.id === currentUserId.value) || MOCK_USERS[0]!;

const navItems = [
  { name: 'Timeline', route: '/timeline' },
  { name: 'Outcomes', route: '/outcomes' },
  { name: 'Motivations', route: '/motivations' },
];
</script>

<template>
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
        :class="{ active: route.path === item.route }"
      >
        {{ item.name }}
      </router-link>
    </nav>

    <div class="topbar-right">
      <SearchBar />
      <button class="help-btn" @click="router.push('/admin/tags')" title="Tag admin">⚙</button>
      <button class="help-btn" @click="showWalkthrough = true" title="Help & walkthrough">?</button>
      <!-- GitHub authenticated user -->
      <div v-if="authenticatedUser?.provider === 'github'" class="user-switcher" @click="showUserMenu = !showUserMenu">
        <img v-if="authenticatedUser.avatarUrl" :src="authenticatedUser.avatarUrl" class="avatar-img" />
        <div v-else class="avatar">{{ authenticatedUser.initials }}</div>
        <span class="user-name">{{ authenticatedUser.name }}</span>
        <div v-if="showUserMenu" class="user-menu">
          <div class="user-menu-item" @click.stop="logout">Sign out</div>
        </div>
      </div>

      <!-- Mock user switcher (dev mode) -->
      <div v-else class="user-switcher" @click="showUserMenu = !showUserMenu">
        <div class="avatar">{{ currentUser().initials }}</div>
        <span class="user-name">{{ currentUser().name }}</span>
        <div v-if="showUserMenu" class="user-menu">
          <div
            v-for="user in MOCK_USERS"
            :key="user.id"
            class="user-menu-item"
            :class="{ active: user.id === currentUserId }"
            @click.stop="switchUser(user.id)"
          >
            <div class="avatar-sm">{{ user.initials }}</div>
            {{ user.name }}
          </div>
        </div>
      </div>
    </div>
  </header>

  <main class="main-content">
    <router-view />
  </main>

  <Walkthrough v-if="showWalkthrough" @close="closeWalkthrough" />

  <Toast />
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
}
.help-btn:hover { border-color: var(--accent); color: var(--accent); }

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

.avatar-img {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  flex-shrink: 0;
}
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--teal));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  flex-shrink: 0;
}
.avatar-sm {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg-3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 600;
  color: var(--text-1);
}
.user-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
}
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
