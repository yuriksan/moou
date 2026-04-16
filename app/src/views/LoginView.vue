<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';

const BASE = import.meta.env.VITE_API_URL || '/api';
const AUTH_BASE = '/auth';

const router = useRouter();

const provider = ref<string>('');
const providerLabel = ref<string>('');
const error = ref('');
const step = ref<'idle' | 'waiting' | 'done'>('idle');
const authUrl = ref('');
const userName = ref('');
let handshakeId = '';
let tenantId = '1';
let pollTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(async () => {
  const saved = localStorage.getItem('moou-ve-username');
  if (saved) userName.value = saved;
  try {
    const res = await fetch(`${BASE}/provider`);
    const data = await res.json();
    provider.value = data.name || '';
    providerLabel.value = data.label || data.name || '';
  } catch {
    error.value = 'Could not reach server.';
  }
});

onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer);
});

// ─── ValueEdge Interactive Token Sharing ───────────────────────────────────
async function startValueEdge() {
  error.value = '';
  if (!userName.value.trim()) {
    error.value = 'Please enter your ValueEdge username (usually your email address).';
    return;
  }
  localStorage.setItem('moou-ve-username', userName.value.trim());
  userName.value = userName.value.trim();
  // Open the window synchronously (still in the click event stack) with a
  // placeholder URL so browsers don't block the popup, then redirect it once
  // we have the real auth URL from the server.
  const authWindow = window.open('about:blank', '_blank');
  try {
    const res = await fetch(`${AUTH_BASE}/valueedge/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (!res.ok) {
      authWindow?.close();
      throw new Error('Failed to start sign-in');
    }
    const data = await res.json();
    authUrl.value = data.authUrl;
    handshakeId = data.handshakeId;
    tenantId = data.tenantId ?? '1';
    step.value = 'waiting';
    // Start polling BEFORE opening the tab — if the user is already logged in
    // to VE, auth completes the instant they hit the auth URL. Polling first
    // ensures we don't miss the one-time 200 response.
    startPolling();
    if (authWindow) {
      authWindow.location.href = data.authUrl;
    } else {
      window.open(data.authUrl, '_blank', 'noopener,noreferrer');
    }
  } catch (e: any) {
    authWindow?.close();
    error.value = e.message || 'Sign-in failed';
  }
}

function startPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  const deadline = Date.now() + 3 * 60 * 1000;
  async function poll() {
    if (Date.now() > deadline) {
      step.value = 'idle';
      error.value = 'Sign-in timed out. Please try again.';
      return;
    }
    try {
      const res = await fetch(`${AUTH_BASE}/valueedge/poll?handshakeId=${encodeURIComponent(handshakeId)}&tenantId=${encodeURIComponent(tenantId)}&userName=${encodeURIComponent(userName.value)}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as any;
        const code = body?.error?.code;
        if (code === 'WORKSPACE_ACCESS_DENIED') {
          error.value = 'Sign-in failed: your account does not have access to the configured workspace. Contact your ValueEdge administrator.';
        } else if (code === 'WORKSPACE_NOT_FOUND') {
          error.value = 'Sign-in failed: the configured workspace does not exist. Contact your administrator.';
        } else if (res.status === 404) {
          error.value = `Sign-in failed: the username does not match the account used in the browser. This is usually your email address — check the username field and try again.`;
        } else {
          error.value = body?.error?.message || `Poll failed (${res.status})`;
        }
        step.value = 'idle';
        return;
      }
      const data = await res.json();
      if (data.status === 'ok') {
        step.value = 'done';
        router.push('/timeline');
        return;
      } else if (data.status === 'expired') {
        step.value = 'idle';
        error.value = 'Sign-in expired. Please try again.';
        return;
      }
    } catch (e: any) {
      error.value = `Network error: ${e?.message}`;
      return;
    }
    // Still pending — schedule next poll
    pollTimer = setTimeout(poll, 3000);
  }
  pollTimer = setTimeout(poll, 0);  // start immediately
}

// ─── GitHub OAuth redirect ─────────────────────────────────────────────────
function signInGitHub() {
  window.location.href = `${AUTH_BASE}/github`;
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo font-display">
        <svg viewBox="0 0 32 32" width="36" height="36">
          <ellipse cx="7" cy="8" rx="3.5" ry="2.5" fill="#c07a1a" transform="rotate(-20 7 8)"/>
          <ellipse cx="25" cy="8" rx="3.5" ry="2.5" fill="#c07a1a" transform="rotate(20 25 8)"/>
          <ellipse cx="16" cy="17" rx="10" ry="9" fill="#1a1a1a"/>
          <circle cx="12" cy="16" r="1.5" fill="#f0efe9"/>
          <circle cx="20" cy="16" r="1.5" fill="#f0efe9"/>
          <ellipse cx="16" cy="21.5" rx="5" ry="3.5" fill="#c07a1a" opacity="0.4"/>
        </svg>
        moou
      </div>
      <p class="login-subtitle">Sign in to continue</p>

      <div v-if="error" class="login-error">{{ error }}</div>

      <!-- ValueEdge -->
      <template v-if="provider === 'valueedge'">
        <template v-if="step === 'idle'">
          <input
            v-model="userName"
            type="text"
            class="login-input"
            placeholder="Username (usually your email address)"
            autocomplete="username"
            @keydown.enter="startValueEdge"
          />
          <button class="btn btn-primary login-btn" @click="startValueEdge">
            Sign in with {{ providerLabel || 'ValueEdge' }}
          </button>
        </template>
        <template v-else-if="step === 'waiting'">
          <p class="login-hint">
            A sign-in tab has been opened. Complete authentication there, then return here.
          </p>
          <a v-if="authUrl" :href="authUrl" target="_blank" rel="noopener noreferrer" class="reopen-link">
            Re-open sign-in tab ↗
          </a>
          <div class="login-spinner">Waiting for sign-in…</div>
        </template>
        <template v-else>
          <div class="login-spinner">Signed in, redirecting…</div>
        </template>
      </template>

      <!-- GitHub -->
      <template v-else-if="provider === 'github'">
        <button class="btn btn-primary login-btn" @click="signInGitHub">
          Sign in with GitHub
        </button>
      </template>

      <!-- Fallback / loading -->
      <template v-else>
        <div class="login-spinner">Loading…</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-0);
}

.login-card {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 40px 48px;
  width: 360px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.login-logo {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.login-subtitle {
  font-size: 14px;
  color: var(--text-2);
  margin: 0;
}

.login-error {
  background: var(--red-dim);
  color: var(--red);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.login-btn {
  width: 100%;
  padding: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.login-input {
  width: 100%;
  padding: 9px 11px;
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-1);
  color: var(--text-0);
  box-sizing: border-box;
  margin-bottom: 8px;
}
.login-input:focus {
  outline: none;
  border-color: var(--teal);
}

.login-hint {
  font-size: 13px;
  color: var(--text-2);
  margin: 0;
  line-height: 1.5;
}

.reopen-link {
  font-size: 13px;
  color: var(--teal);
}

.login-spinner {
  font-size: 13px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
</style>
