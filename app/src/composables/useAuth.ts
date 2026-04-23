import { ref, computed } from 'vue';

export interface AuthUser {
  id: string;
  name: string;
  role: string;
  status: string;
  jobTitle?: string | null;
  initials: string;
  avatarUrl?: string | null;
}

export const currentUser = ref<AuthUser | null>(null);

export const isAdmin = computed(() => currentUser.value?.role === 'admin');
export const canWrite = computed(() => ['admin', 'modifier'].includes(currentUser.value?.role ?? ''));
export const isViewer = computed(() => currentUser.value?.role === 'viewer');
