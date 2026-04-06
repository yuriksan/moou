import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

const updateOutcome = vi.fn().mockResolvedValue({});
const getOutcomes = vi.fn();

vi.mock('../composables/useApi', () => ({
  api: {
    getMilestones: vi.fn().mockResolvedValue({
      data: [
        { id: 'ms-q2', name: 'Q2 Release', targetDate: '2026-06-30', type: 'release', status: 'active' },
        { id: 'ms-q3', name: 'Q3 Release', targetDate: '2026-09-30', type: 'release', status: 'upcoming' },
      ],
      total: 2,
    }),
    getOutcomes: (...args: any[]) => getOutcomes(...args),
    getTags: vi.fn().mockResolvedValue([]),
    updateOutcome: (...args: any[]) => updateOutcome(...args),
  },
  getCurrentUser: () => 'sarah-chen',
  setCurrentUser: vi.fn(),
}));

vi.mock('../composables/useSSE', () => ({
  useSSE: () => ({ connected: ref(false), lastEvent: ref(null), on: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

vi.mock('../components/OutcomeDetail.vue', () => ({
  default: { template: '<div class="mock-detail"></div>', props: ['outcomeId'] },
}));
vi.mock('../components/OutcomeForm.vue', () => ({
  default: { template: '<div class="mock-outcome-form"></div>' },
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: {}, path: '/timeline' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import TimelineView from '../views/TimelineView.vue';

const SEED_OUTCOMES = [
  { id: 'o-1', title: 'Data Masking',  milestoneId: 'ms-q2', priorityScore: '842', effort: 'L',  status: 'active', pinned: false, motivationCount: 3 },
  { id: 'o-2', title: 'GDPR Residency', milestoneId: 'ms-q3', priorityScore: '721', effort: 'XL', status: 'active', pinned: false, motivationCount: 2 },
  { id: 'o-3', title: 'SSO Portal',     milestoneId: null,    priorityScore: '278', effort: 'L',  status: 'draft',  pinned: false, motivationCount: 1 },
];

describe('TimelineView — drag and drop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // getOutcomes returns a fresh deep copy each call so reverts/reloads work
    getOutcomes.mockImplementation(async () => ({
      data: SEED_OUTCOMES.map(o => ({ ...o })),
      total: SEED_OUTCOMES.length,
    }));
  });

  function findCardByTitle(wrapper: ReturnType<typeof mount>, title: string) {
    const cards = wrapper.findAll('.outcome-card, .backlog-card');
    return cards.find(c => c.find('.card-title').text() === title);
  }

  it('drags an outcome from one milestone column to another', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    const card = findCardByTitle(wrapper, 'Data Masking');
    expect(card).toBeDefined();

    // Start dragging the Data Masking card (currently in ms-q2)
    await card!.trigger('dragstart');

    // Drop it on the Q3 column (the second .milestone-cards container)
    const milestoneColumns = wrapper.findAll('.milestone-cards');
    expect(milestoneColumns).toHaveLength(2);
    await milestoneColumns[1]!.trigger('drop');
    await flushPromises();

    expect(updateOutcome).toHaveBeenCalledTimes(1);
    expect(updateOutcome).toHaveBeenCalledWith('o-1', { milestoneId: 'ms-q3' });
  });

  it('drags an outcome from a milestone to the backlog (milestoneId becomes null)', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    const card = findCardByTitle(wrapper, 'GDPR Residency');
    expect(card).toBeDefined();
    await card!.trigger('dragstart');

    await wrapper.find('.backlog-cards').trigger('drop');
    await flushPromises();

    expect(updateOutcome).toHaveBeenCalledWith('o-2', { milestoneId: null });
  });

  it('drags from the backlog onto a milestone column', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    const card = findCardByTitle(wrapper, 'SSO Portal');
    expect(card).toBeDefined();
    await card!.trigger('dragstart');

    const milestoneColumns = wrapper.findAll('.milestone-cards');
    await milestoneColumns[0]!.trigger('drop');
    await flushPromises();

    expect(updateOutcome).toHaveBeenCalledWith('o-3', { milestoneId: 'ms-q2' });
  });

  it('drop on the same column the card came from is a no-op', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    const card = findCardByTitle(wrapper, 'Data Masking');
    await card!.trigger('dragstart');

    // Drop on the same Q2 column
    const milestoneColumns = wrapper.findAll('.milestone-cards');
    await milestoneColumns[0]!.trigger('drop');
    await flushPromises();

    expect(updateOutcome).not.toHaveBeenCalled();
  });

  it('clears drag state on dragend even without a drop', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    const card = findCardByTitle(wrapper, 'Data Masking');
    await card!.trigger('dragstart');
    // Card should now have the dragging class
    expect(card!.classes()).toContain('dragging');

    await card!.trigger('dragend');
    expect(card!.classes()).not.toContain('dragging');
    expect(updateOutcome).not.toHaveBeenCalled();
  });
});
