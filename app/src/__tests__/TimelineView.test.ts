import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

// Mock the composables before importing the component
vi.mock('../composables/useApi', () => ({
  api: {
    getMilestones: vi.fn().mockResolvedValue({
      data: [
        { id: 'ms-1', name: 'Q2 Release', targetDate: '2026-06-30', type: 'release', status: 'active', outcomeCount: 2, effortSummary: null, createdBy: 'sarah-chen', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'ms-2', name: 'SOC2 Audit', targetDate: '2026-05-16', type: 'deadline', status: 'upcoming', outcomeCount: 1, effortSummary: null, createdBy: 'james-obi', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      total: 2,
    }),
    getOutcomes: vi.fn().mockResolvedValue({
      data: [
        { id: 'o-1', title: 'Data Masking', milestoneId: 'ms-1', priorityScore: '842', effort: 'L', status: 'active', pinned: false, motivationCount: 3 },
        { id: 'o-2', title: 'GDPR Residency', milestoneId: 'ms-2', priorityScore: '721', effort: 'XL', status: 'active', pinned: false, motivationCount: 2 },
        { id: 'o-3', title: 'SSO Portal', milestoneId: null, priorityScore: '278', effort: 'L', status: 'draft', pinned: false, motivationCount: 1 },
      ],
      total: 3,
    }),
    createMilestone: vi.fn().mockResolvedValue({ id: 'ms-new', name: 'Test' }),
    deleteMilestone: vi.fn().mockResolvedValue(undefined),
    updateMilestone: vi.fn().mockResolvedValue({}),
    createOutcome: vi.fn().mockResolvedValue({ id: 'o-new', title: 'New Outcome' }),
    getTags: vi.fn().mockResolvedValue([]),
  },
  getCurrentUser: () => 'sarah-chen',
  setCurrentUser: vi.fn(),
}));

vi.mock('../composables/useSSE', () => ({
  useSSE: () => ({ connected: ref(false), lastEvent: ref(null), on: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

// Mock vue-router so useRoute()/useRouter() work without a full router instance
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: {}, path: '/timeline' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Stub OutcomeDetail since we're testing the layout, not the detail panel
vi.mock('../components/OutcomeDetail.vue', () => ({
  default: { template: '<div class="mock-detail">Detail Panel</div>', props: ['outcomeId'] },
}));

vi.mock('../components/OutcomeForm.vue', () => ({
  default: { template: '<div class="outcome-form">Outcome Form</div>', props: ['outcome', 'defaultMilestoneId'] },
}));

import TimelineView from '../views/TimelineView.vue';

describe('TimelineView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders milestone sections sorted by date', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    const milestoneNames = wrapper.findAll('.ms-name').map(el => el.text());
    // SOC2 Audit (May) should come before Q2 Release (June)
    expect(milestoneNames[0]).toBe('SOC2 Audit');
    expect(milestoneNames[1]).toBe('Q2 Release');
  });

  it('renders backlog with unassigned outcomes', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    const backlogCards = wrapper.findAll('.backlog-card');
    expect(backlogCards).toHaveLength(1);
    expect(backlogCards[0]!.find('.card-title').text()).toBe('SSO Portal');
  });

  it('renders outcomes under their milestones', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    const sections = wrapper.findAll('.milestone-section');
    expect(sections).toHaveLength(2);

    // SOC2 has GDPR
    const soc2Cards = sections[0]!.findAll('.outcome-card');
    expect(soc2Cards).toHaveLength(1);
    expect(soc2Cards[0]!.find('.card-title').text()).toBe('GDPR Residency');

    // Q2 has Data Masking
    const q2Cards = sections[1]!.findAll('.outcome-card');
    expect(q2Cards).toHaveLength(1);
    expect(q2Cards[0]!.find('.card-title').text()).toBe('Data Masking');
  });

  it('opens detail panel when clicking an outcome card', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    expect(wrapper.find('.mock-detail').exists()).toBe(false);

    await wrapper.find('.outcome-card').trigger('click');
    expect(wrapper.find('.mock-detail').exists()).toBe(true);
  });

  it('shows edit form when clicking edit button', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    expect(wrapper.find('.milestone-edit-form').exists()).toBe(false);

    // Find and click the edit button (✎)
    const editBtns = wrapper.findAll('.btn-icon');
    const editBtn = editBtns.find(b => b.text() === '✎');
    expect(editBtn).toBeDefined();
    await editBtn!.trigger('click');

    expect(wrapper.find('.milestone-edit-form').exists()).toBe(true);
  });

  it('shows new milestone form when clicking + Milestone', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    expect(wrapper.find('.new-milestone-form').exists()).toBe(false);
    // + Milestone is the first button in .header-buttons (not btn-primary)
    const headerBtns = wrapper.findAll('.header-buttons .btn');
    const milestoneBtn = headerBtns.find(b => b.text().includes('Milestone'));
    await milestoneBtn!.trigger('click');
    expect(wrapper.find('.new-milestone-form').exists()).toBe(true);
  });

  it('shows outcome form when clicking + Outcome', async () => {
    const wrapper = mount(TimelineView);
    await flushPromises();

    expect(wrapper.find('.outcome-form').exists()).toBe(false);
    await wrapper.find('.btn-primary').trigger('click');
    await flushPromises();
    expect(wrapper.find('.outcome-form').exists()).toBe(true);
  });
});
