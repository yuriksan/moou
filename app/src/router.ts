import { createRouter, createWebHistory } from 'vue-router';
import { currentUser } from './composables/useAuth';
import { toast } from './composables/useToast';

// Each entity view accepts an optional `:slugId?` segment of the form
// `human-readable-slug-{uuid}`. The slug is decorative; the UUID at the tail
// is the source of truth (see composables/useSlug.ts).
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
    },
    {
      path: '/',
      redirect: '/timeline',
    },
    {
      path: '/timeline/:slugId?',
      name: 'timeline',
      component: () => import('./views/TimelineView.vue'),
    },
    {
      path: '/outcomes/:slugId?',
      name: 'outcomes',
      component: () => import('./views/OutcomesView.vue'),
    },
    {
      path: '/motivations/:slugId?',
      name: 'motivations',
      component: () => import('./views/MotivationsView.vue'),
    },
    {
      path: '/admin/tags',
      name: 'tag-admin',
      component: () => import('./views/TagAdminView.vue'),
    },
    {
      path: '/admin/field-config',
      name: 'field-config-admin',
      component: () => import('./views/FieldConfigAdminView.vue'),
      meta: { requiresRole: 'admin' },
    },
    {
      path: '/admin/users',
      name: 'user-admin',
      component: () => import('./views/UserAdminView.vue'),
      meta: { requiresRole: 'admin' },
    },
  ],
});

// Route guard: redirect non-admins away from admin pages
router.beforeEach((to) => {
  const requiredRole = to.meta.requiresRole as string | undefined;
  if (!requiredRole) return;
  // Don't enforce until auth state is loaded
  if (!currentUser.value) return;
  if (currentUser.value.role !== requiredRole) {
    toast.error('You don\'t have access to that page.');
    return '/';
  }
});

export default router;
