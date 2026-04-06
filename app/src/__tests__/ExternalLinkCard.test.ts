import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('../composables/useApi', () => ({
  api: {
    refreshExternalLink: vi.fn().mockResolvedValue({ changed: true }),
    deleteExternalLink: vi.fn().mockResolvedValue(undefined),
  },
}));

import ExternalLinkCard from '../components/ExternalLinkCard.vue';

describe('ExternalLinkCard', () => {
  const richLink = {
    id: 'link-1',
    entityType: 'issue',
    entityId: '42',
    url: 'https://github.com/org/repo/issues/42',
    connectionState: 'connected',
    cachedDetails: {
      title: 'Fix login bug',
      state: 'open',
      labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'P1', color: 'ff0000' }],
      assignee: { login: 'devuser', avatarUrl: 'https://avatars.githubusercontent.com/u/123' },
      milestone: { title: 'v2.0', dueOn: '2026-06-01' },
      childProgress: { total: 5, completed: 2, inProgress: 3 },
      htmlUrl: 'https://github.com/org/repo/issues/42',
      fetchedAt: new Date().toISOString(),
    },
  };

  const minimalLink = {
    id: 'link-2',
    entityType: 'link',
    entityId: 'VE-1042',
    url: 'https://valueedge.example.com/epics/1042',
    connectionState: 'connected',
    cachedDetails: null,
  };

  it('renders rich details when cached', () => {
    const wrapper = mount(ExternalLinkCard, { props: { link: richLink } });

    expect(wrapper.find('.link-title').text()).toBe('Fix login bug');
    expect(wrapper.find('.state-badge').text()).toBe('open');
    expect(wrapper.findAll('.link-label')).toHaveLength(2);
    expect(wrapper.find('.link-assignee').text()).toContain('devuser');
    expect(wrapper.find('.link-milestone').text()).toBe('v2.0');
    expect(wrapper.find('.connection-badge').text()).toBe('connected');
  });

  it('renders progress bar when child progress exists', () => {
    const wrapper = mount(ExternalLinkCard, { props: { link: richLink } });

    expect(wrapper.find('.progress-section').exists()).toBe(true);
    expect(wrapper.find('.progress-label').text()).toBe('2/5 done');
  });

  it('shows freshness timestamp', () => {
    const wrapper = mount(ExternalLinkCard, { props: { link: richLink } });
    expect(wrapper.find('.freshness-text').text()).toContain('Updated');
  });

  it('renders minimal display without cached details', () => {
    const wrapper = mount(ExternalLinkCard, { props: { link: minimalLink } });

    expect(wrapper.find('.link-title').exists()).toBe(false);
    expect(wrapper.find('.link-id').text()).toBe('VE-1042');
  });

  it('shows published state badge', () => {
    const published = { ...richLink, connectionState: 'published' };
    const wrapper = mount(ExternalLinkCard, { props: { link: published } });
    expect(wrapper.find('.connection-badge').text()).toBe('published');
    expect(wrapper.find('.link-published').exists()).toBe(true);
  });
});
