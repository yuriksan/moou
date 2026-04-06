<script setup lang="ts">
import { useToast } from '../composables/useToast';

const { toasts, dismiss } = useToast();

function iconFor(variant: string): string {
  if (variant === 'error') return '!';
  if (variant === 'success') return '✓';
  return 'i';
}
</script>

<template>
  <div class="toast-stack" aria-live="polite" aria-atomic="true">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        :class="['toast', `toast-${t.variant}`]"
        role="status"
      >
        <div :class="['toast-icon', `toast-icon-${t.variant}`]">{{ iconFor(t.variant) }}</div>
        <div class="toast-body">
          <div v-if="t.title" class="toast-title">{{ t.title }}</div>
          <div class="toast-message">{{ t.message }}</div>
        </div>
        <button class="toast-close" @click="dismiss(t.id)" aria-label="Dismiss">×</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  top: 72px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 10000;
  max-width: 420px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  pointer-events: auto;
  min-width: 280px;
  max-width: 420px;
}

.toast-error { border-left: 3px solid var(--red); }
.toast-success { border-left: 3px solid var(--green); }
.toast-info { border-left: 3px solid var(--blue); }

.toast-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
}
.toast-icon-error { background: var(--red-dim); color: var(--red); }
.toast-icon-success { background: var(--green-dim); color: var(--green); }
.toast-icon-info { background: var(--blue-dim, #2b7fff20); color: var(--blue, #4a9eff); }

.toast-body {
  flex: 1;
  min-width: 0;
}
.toast-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-0);
  margin-bottom: 2px;
}
.toast-message {
  font-size: 12px;
  color: var(--text-1);
  line-height: 1.45;
  word-wrap: break-word;
}

.toast-close {
  background: none;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 2px 4px;
  flex-shrink: 0;
  transition: color var(--transition);
}
.toast-close:hover { color: var(--text-0); }

/* TransitionGroup animations */
.toast-enter-active,
.toast-leave-active {
  transition: transform 250ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease;
}
.toast-enter-from {
  transform: translateX(30px);
  opacity: 0;
}
.toast-leave-to {
  transform: translateX(30px);
  opacity: 0;
}
.toast-leave-active {
  position: absolute;
  right: 0;
}
</style>
