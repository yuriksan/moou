import { createRouter, createWebHistory } from 'vue-router';

// Each entity view accepts an optional `:slugId?` segment of the form
// `human-readable-slug-{uuid}`. The slug is decorative; the UUID at the tail
// is the source of truth (see composables/useSlug.ts).
const router = createRouter({
  history: createWebHistory(),
  routes: [
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
  ],
});

export default router;
