import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

// Default outcome data — overridden per test by tweaking the api.getOutcome mock.
const draftOutcome = {
  id: 'o-draft',
  title: 'Draft outcome',
  description: 'A description',
  status: 'draft',
  effort: 'M',
  pinned: false,
  motivations: [],
  tags: [],
  externalLinks: [],
};

const connectedOutcome = {
  ...draftOutcome,
  id: 'o-connected',
  externalLinks: [
    {
      id: 'link-1',
      entityType: 'issue',
      entityId: '42',
      url: 'https://github.com/org/repo/issues/42',
      connectionState: 'connected',
      cachedDetails: {
        title: 'Existing issue',
        state: 'open',
        labels: [],
        htmlUrl: 'https://github.com/org/repo/issues/42',
        fetchedAt: new Date().toISOString(),
      },
    },
  ],
};

const getOutcome = vi.fn();
const publishOutcome = vi.fn();

vi.mock('../composables/useApi', () => ({
  api: {
    getOutcome: (...args: any[]) => getOutcome(...args),
    getOutcomeScore: vi.fn().mockResolvedValue(null),
    getComments: vi.fn().mockResolvedValue({ data: [] }),
    getOutcomeHistory: vi.fn().mockResolvedValue({ data: [] }),
    getProvider: vi.fn().mockResolvedValue({ name: 'github', label: 'GitHub' }),
    getMilestone: vi.fn().mockResolvedValue({ targetDate: '2026-12-31' }),
    getBackendEntityTypes: vi.fn().mockResolvedValue({
      entityTypes: [
        { name: 'issue', label: 'Issue', default: true },
        { name: 'pr', label: 'Pull Request' },
      ],
      provider: 'github',
      label: 'GitHub',
    }),
    publishOutcome: (...args: any[]) => publishOutcome(...args),
  },
}));

// Stub child components so we can focus on OutcomeDetail's own behaviour.
vi.mock('../components/OutcomeForm.vue', () => ({
  default: { template: '<div class="mock-outcome-form"></div>' },
}));
vi.mock('../components/MotivationForm.vue', () => ({
  default: { template: '<div class="mock-motivation-form"></div>' },
}));
vi.mock('../components/ConnectDialog.vue', () => ({
  default: { template: '<div class="mock-connect-dialog"></div>' },
}));
vi.mock('../components/ExternalLinkCard.vue', () => ({
  default: { template: '<div class="mock-external-link-card"></div>' },
}));

import OutcomeDetail from '../components/OutcomeDetail.vue';

describe('OutcomeDetail — publish flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishOutcome.mockResolvedValue({ id: 'link-new', connectionState: 'published' });
  });

  it('shows the Publish button on a draft outcome (no external links)', async () => {
    getOutcome.mockResolvedValue({ ...draftOutcome });

    const wrapper = mount(OutcomeDetail, { props: { outcomeId: 'o-draft' } });
    await flushPromises();

    const buttons = wrapper.findAll('button').map(b => b.text());
    expect(buttons.some(t => t.startsWith('Publish as'))).toBe(true);
  });

  it('hides the Publish button once the outcome already has an external link', async () => {
    getOutcome.mockResolvedValue({ ...connectedOutcome });

    const wrapper = mount(OutcomeDetail, { props: { outcomeId: 'o-connected' } });
    await flushPromises();

    const buttons = wrapper.findAll('button').map(b => b.text());
    expect(buttons.some(t => t.startsWith('Publish as'))).toBe(false);
  });

  it('uses the provider label in the publish button copy', async () => {
    getOutcome.mockResolvedValue({ ...draftOutcome });

    const wrapper = mount(OutcomeDetail, { props: { outcomeId: 'o-draft' } });
    await flushPromises();

    const publishBtn = wrapper.findAll('button').find(b => b.text().startsWith('Publish as'));
    expect(publishBtn?.text()).toContain('GitHub');
  });

  it('publishes with the selected entity type after confirmation and reloads', async () => {
    getOutcome.mockResolvedValue({ ...draftOutcome });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const wrapper = mount(OutcomeDetail, { props: { outcomeId: 'o-draft' } });
    await flushPromises();

    // Open the inline publish form
    const openBtn = wrapper.findAll('button').find(b => b.text().startsWith('Publish as'))!;
    await openBtn.trigger('click');

    // Only one publishable type (PR is filtered out) → no select, just static label
    expect(wrapper.find('.publish-type-static').exists()).toBe(true);
    expect(wrapper.find('.publish-type-static').text()).toBe('Issue');

    // Click the inner Publish button
    const publishBtn = wrapper.findAll('button').find(b => b.text().startsWith('Publish to'))!;
    await publishBtn.trigger('click');
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]![0]).toContain('GitHub');
    expect(confirmSpy.mock.calls[0]![0]).toContain('issue');

    expect(publishOutcome).toHaveBeenCalledWith('o-draft', 'issue');
    // Reload should have been triggered (initial + post-publish)
    expect(getOutcome).toHaveBeenCalledTimes(2);
    confirmSpy.mockRestore();
  });

  it('does not publish if the user cancels the confirmation', async () => {
    getOutcome.mockResolvedValue({ ...draftOutcome });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const wrapper = mount(OutcomeDetail, { props: { outcomeId: 'o-draft' } });
    await flushPromises();

    await wrapper.findAll('button').find(b => b.text().startsWith('Publish as'))!.trigger('click');
    await wrapper.findAll('button').find(b => b.text().startsWith('Publish to'))!.trigger('click');
    await flushPromises();

    expect(publishOutcome).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
