import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../composables/useApi', () => ({
  api: {
    getBackendEntityTypes: vi.fn().mockResolvedValue({
      entityTypes: [
        { name: 'issue', label: 'Issue', default: true },
        { name: 'pr', label: 'Pull Request' },
      ],
      provider: 'github',
      label: 'GitHub',
    }),
    searchBackend: vi.fn().mockResolvedValue({
      items: [
        { entityType: 'issue', entityId: '42', title: 'Fix login bug', state: 'open', labels: [{ name: 'bug', color: 'd73a4a' }], assignee: { login: 'dev', avatarUrl: 'https://...' }, milestone: null, htmlUrl: 'https://...' },
        { entityType: 'issue', entityId: '13', title: 'Add dark mode', state: 'closed', labels: [], assignee: null, milestone: { title: 'v2.0' }, htmlUrl: 'https://...' },
      ],
    }),
    connectOutcome: vi.fn().mockResolvedValue({ id: 'link-1', connectionState: 'connected' }),
  },
}));

import ConnectDialog from '../components/ConnectDialog.vue';
import { api } from '../composables/useApi';

describe('ConnectDialog', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders with entity type selector and search input', async () => {
    const wrapper = mount(ConnectDialog, { props: { outcomeId: 'test-outcome' } });
    await flushPromises();

    expect(wrapper.find('.dialog-title').text()).toContain('GitHub');
    expect(wrapper.find('.type-select').exists()).toBe(true);
    expect(wrapper.find('.search-input').exists()).toBe(true);
  });

  it('shows search results after typing', async () => {
    const wrapper = mount(ConnectDialog, { props: { outcomeId: 'test-outcome' } });
    await flushPromises();

    await wrapper.find('.search-input').setValue('bug');
    // Wait for debounce
    await new Promise(r => setTimeout(r, 350));
    await flushPromises();

    const results = wrapper.findAll('.result-item');
    expect(results.length).toBe(2);
    expect(results[0]!.find('.result-title').text()).toBe('Fix login bug');
    expect(results[0]!.find('.state-badge').text()).toBe('open');
  });

  it('emits connected when an item is clicked', async () => {
    const wrapper = mount(ConnectDialog, { props: { outcomeId: 'test-outcome' } });
    await flushPromises();

    await wrapper.find('.search-input').setValue('bug');
    await new Promise(r => setTimeout(r, 350));
    await flushPromises();

    await wrapper.find('.result-item').trigger('click');
    await flushPromises();

    expect(api.connectOutcome).toHaveBeenCalledWith('test-outcome', 'issue', '42');
    expect(wrapper.emitted('connected')).toHaveLength(1);
  });

  it('emits cancel on cancel button', async () => {
    const wrapper = mount(ConnectDialog, { props: { outcomeId: 'test-outcome' } });
    await flushPromises();

    await wrapper.find('.btn').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });
});
