import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const push = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useRoute: () => ({ query: {}, params: {}, path: '/' }),
}));

vi.mock('../composables/useApi', () => ({
  api: {
    // OutcomeDetail dependencies
    getOutcome: vi.fn().mockResolvedValue({
      id: 'o-1',
      title: 'Test outcome',
      status: 'active',
      effort: 'M',
      pinned: false,
      motivations: [],
      tags: [
        { id: 't-1', name: 'security', emoji: '🔒', colour: '#c43c3c' },
        { id: 't-2', name: 'platform', emoji: '🏗️', colour: '#3a8a4a' },
      ],
      externalLinks: [],
    }),
    getOutcomeScore: vi.fn().mockResolvedValue(null),
    getComments: vi.fn().mockResolvedValue({ data: [] }),
    getOutcomeHistory: vi.fn().mockResolvedValue({ data: [] }),
    getProvider: vi.fn().mockResolvedValue({ name: 'github', label: 'GitHub' }),
    getMilestone: vi.fn().mockResolvedValue({ targetDate: '2026-12-31' }),
    getMilestones: vi.fn().mockResolvedValue({ data: [] }),
    getBackendEntityTypes: vi.fn().mockResolvedValue({ entityTypes: [], provider: 'github', label: 'GitHub' }),
    // MotivationDetail dependencies
    getMotivation: vi.fn().mockResolvedValue({
      id: 'm-1',
      title: 'Acme renewal',
      typeName: 'Customer Demand',
      status: 'active',
      attributes: {},
      tags: [
        { id: 't-3', name: 'EMEA', emoji: '🌍', colour: '#2a7ac8' },
      ],
      outcomes: [],
    }),
    getMotivationHistory: vi.fn().mockResolvedValue({ data: [] }),
    // SearchBar dependencies
    search: vi.fn().mockResolvedValue({
      outcomes: [],
      motivations: [],
      tags: [{ id: 't-1', name: 'security', emoji: '🔒', colour: '#c43c3c' }],
    }),
  },
}));

vi.mock('../composables/useSSE', () => ({
  useSSE: () => ({ on: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

vi.mock('../components/OutcomeForm.vue', () => ({ default: { template: '<div></div>' } }));
vi.mock('../components/MotivationForm.vue', () => ({ default: { template: '<div></div>' } }));
vi.mock('../components/ConnectDialog.vue', () => ({ default: { template: '<div></div>' } }));
vi.mock('../components/ExternalLinkCard.vue', () => ({ default: { template: '<div></div>' } }));

import OutcomeDetail from '../components/OutcomeDetail.vue';
import MotivationDetail from '../components/MotivationDetail.vue';
import SearchBar from '../components/SearchBar.vue';

describe('tag chips navigate to filtered list views', () => {
  beforeEach(() => { push.mockClear(); });

  it('OutcomeDetail tag chip → /outcomes?tags={name}', async () => {
    const wrapper = mount(OutcomeDetail, { props: { outcomeId: 'o-1' } });
    await flushPromises();

    const chips = wrapper.findAll('.clickable-tag');
    expect(chips.length).toBeGreaterThan(0);
    await chips[0]!.trigger('click');

    expect(push).toHaveBeenCalledWith({ path: '/outcomes', query: { tags: 'security' } });
  });

  it('MotivationDetail tag chip → /motivations?tags={name}', async () => {
    const wrapper = mount(MotivationDetail, { props: { motivationId: 'm-1' } });
    await flushPromises();

    const chip = wrapper.find('.clickable-tag');
    expect(chip.exists()).toBe(true);
    await chip.trigger('click');

    expect(push).toHaveBeenCalledWith({ path: '/motivations', query: { tags: 'EMEA' } });
  });

  it('SearchBar tag result → /outcomes?tags={name}', async () => {
    const wrapper = mount(SearchBar);
    await wrapper.find('.search-input').setValue('sec');
    // Wait for the 250ms debounce + the search promise to resolve
    await new Promise(r => setTimeout(r, 300));
    await flushPromises();

    const tagResult = wrapper.find('.result-tag');
    expect(tagResult.exists()).toBe(true);
    await tagResult.trigger('click');

    expect(push).toHaveBeenCalledWith({ path: '/outcomes', query: { tags: 'security' } });
  });
});
