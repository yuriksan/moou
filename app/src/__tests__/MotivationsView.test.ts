import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

vi.mock('../composables/useApi', () => ({
  api: {
    getMotivations: vi.fn().mockResolvedValue({
      data: [
        { id: 'm-1', title: 'Acme renewal', typeName: 'Customer Demand', status: 'active', score: '1200', linkedOutcomeCount: 2, createdBy: 'james-obi', attributes: { target_date: '2026-05-01' }, earliestMilestoneDate: '2026-09-30' },
        { id: 'm-2', title: 'Jenkins debt', typeName: 'Tech Debt', status: 'active', score: '125', linkedOutcomeCount: 1, createdBy: 'dev-patel', attributes: {}, earliestMilestoneDate: null },
      ],
      total: 2,
    }),
    getMotivationTypes: vi.fn().mockResolvedValue([]),
    getTags: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../composables/useSSE', () => ({
  useSSE: () => ({ connected: ref(false), lastEvent: ref(null), on: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

vi.mock('../components/MotivationDetail.vue', () => ({
  default: { template: '<div class="mock-detail">Detail</div>', props: ['motivationId'] },
}));

vi.mock('../components/MotivationForm.vue', () => ({
  default: { template: '<div class="motivation-form">Form</div>', props: ['motivation', 'linkToOutcomeId'] },
}));

// Mock vue-router
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: {}, path: '/motivations' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import MotivationsView from '../views/MotivationsView.vue';

describe('MotivationsView', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders motivation rows', async () => {
    const wrapper = mount(MotivationsView);
    await flushPromises();

    const rows = wrapper.findAll('.motivation-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.find('.row-title').text()).toBe('Acme renewal');
    expect(rows[1]!.find('.row-title').text()).toBe('Jenkins debt');
  });

  it('shows mismatch dot for motivation with date conflict', async () => {
    const wrapper = mount(MotivationsView);
    await flushPromises();

    // m-1 has target_date 2026-05-01, milestone 2026-09-30 → critical (>90 days)
    const dots = wrapper.findAll('.mismatch-dot-critical');
    expect(dots.length).toBeGreaterThanOrEqual(1);
  });

  it('shows + Motivation button that opens form', async () => {
    const wrapper = mount(MotivationsView);
    await flushPromises();

    expect(wrapper.find('.motivation-form').exists()).toBe(false);
    await wrapper.find('.btn-primary').trigger('click');
    await flushPromises();
    expect(wrapper.find('.motivation-form').exists()).toBe(true);
  });

  it('opens detail panel on row click', async () => {
    const wrapper = mount(MotivationsView);
    await flushPromises();

    expect(wrapper.find('.mock-detail').exists()).toBe(false);
    await wrapper.findAll('.motivation-row')[0]!.trigger('click');
    expect(wrapper.find('.mock-detail').exists()).toBe(true);
  });
});
