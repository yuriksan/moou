import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

const replace = vi.fn();
const getOutcomes = vi.fn().mockResolvedValue({ data: [], total: 0 });

vi.mock('../composables/useApi', () => ({
  api: {
    getOutcomes: (...args: any[]) => getOutcomes(...args),
    getTags: vi.fn().mockResolvedValue([
      // platform has outcome usage → should appear in filter bar
      { id: 't-1', name: 'platform', emoji: '🏗️', colour: '#3a8a4a', usageOutcomes: 4, usageMotivations: 1, usageMilestones: 0, usageCount: 5 },
      // EMEA has zero outcome usage → should NOT appear in filter bar
      { id: 't-2', name: 'EMEA', emoji: '🌍', colour: '#2a7ac8', usageOutcomes: 0, usageMotivations: 1, usageMilestones: 0, usageCount: 1 },
      { id: 't-3', name: 'security', emoji: '🔒', colour: '#c43c3c', usageOutcomes: 3, usageMotivations: 0, usageMilestones: 0, usageCount: 3 },
    ]),
  },
}));

vi.mock('../composables/useSSE', () => ({
  useSSE: () => ({ connected: ref(false), lastEvent: ref(null), on: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

vi.mock('../components/OutcomeDetail.vue', () => ({
  default: { template: '<div class="mock-detail"></div>', props: ['outcomeId'] },
}));
vi.mock('../components/OutcomeForm.vue', () => ({
  default: { template: '<div class="mock-outcome-form"></div>', props: ['outcome', 'defaultMilestoneId'] },
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: {}, path: '/outcomes' }),
  useRouter: () => ({ push: vi.fn(), replace }),
}));

import OutcomesView from '../views/OutcomesView.vue';

describe('OutcomesView — tag filter', () => {
  beforeEach(() => {
    replace.mockClear();
    getOutcomes.mockClear();
  });

  it('hides tags that have zero outcome usage from the filter bar', async () => {
    const wrapper = mount(OutcomesView);
    await flushPromises();

    const chips = wrapper.findAll('.filter-bar .tag').map(c => c.text());
    // platform and security should be present, EMEA should NOT
    expect(chips.some(t => t.includes('platform'))).toBe(true);
    expect(chips.some(t => t.includes('security'))).toBe(true);
    expect(chips.some(t => t.includes('EMEA'))).toBe(false);
  });

  it('clicking a tag updates the URL and reloads outcomes with the tag filter', async () => {
    const wrapper = mount(OutcomesView);
    await flushPromises();

    const initialLoadCalls = getOutcomes.mock.calls.length;

    const platformChip = wrapper.findAll('.filter-bar .tag').find(c => c.text().includes('platform'));
    expect(platformChip).toBeDefined();
    await platformChip!.trigger('click');
    await flushPromises();

    // URL was updated with ?tags=platform
    expect(replace).toHaveBeenCalled();
    const lastCall = replace.mock.calls.at(-1)![0];
    expect(lastCall.query.tags).toBe('platform');

    // loadOutcomes was called again with the tag filter
    expect(getOutcomes.mock.calls.length).toBeGreaterThan(initialLoadCalls);
    const lastLoadCall = getOutcomes.mock.calls.at(-1)![0];
    expect(lastLoadCall.tags).toBe('platform');
  });

  it('clicking the same tag a second time removes it from the filter', async () => {
    const wrapper = mount(OutcomesView);
    await flushPromises();

    const chip = wrapper.findAll('.filter-bar .tag').find(c => c.text().includes('platform'))!;
    await chip.trigger('click');
    await flushPromises();
    await chip.trigger('click');
    await flushPromises();

    const lastCall = replace.mock.calls.at(-1)![0];
    expect(lastCall.query.tags).toBeUndefined();
  });
});
