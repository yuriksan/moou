import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../composables/useApi', () => ({
  api: {
    getMilestones: vi.fn().mockResolvedValue({
      data: [
        { id: 'ms-1', name: 'Q2 Release' },
        { id: 'ms-2', name: 'Q3 Release' },
      ],
    }),
    getTags: vi.fn().mockResolvedValue([
      { id: 't-1', name: 'security', emoji: '🔒', colour: '#c43c3c' },
    ]),
    createOutcome: vi.fn().mockResolvedValue({ id: 'new-1', title: 'Test Outcome' }),
    updateOutcome: vi.fn().mockResolvedValue({ id: 'edit-1', title: 'Updated' }),
  },
}));

vi.mock('../components/TagPicker.vue', () => ({
  default: { template: '<div class="mock-tag-picker"></div>', props: ['modelValue'] },
}));

import OutcomeForm from '../components/OutcomeForm.vue';
import { api } from '../composables/useApi';

describe('OutcomeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders create mode by default', async () => {
    const wrapper = mount(OutcomeForm);
    await flushPromises();

    expect(wrapper.find('.form-title').text()).toBe('New Outcome');
    expect(wrapper.find('.input-lg').exists()).toBe(true);
  });

  it('renders edit mode when outcome prop provided', async () => {
    const wrapper = mount(OutcomeForm, {
      props: { outcome: { id: '1', title: 'Existing', description: 'Desc', effort: 'M', status: 'active', tags: [] } },
    });
    await flushPromises();

    expect(wrapper.find('.form-title').text()).toBe('Edit Outcome');
    expect((wrapper.find('.input-lg').element as HTMLInputElement).value).toBe('Existing');
  });

  it('loads milestones for dropdown', async () => {
    mount(OutcomeForm);
    await flushPromises();

    expect(api.getMilestones).toHaveBeenCalled();
  });

  it('shows error when title is empty', async () => {
    const wrapper = mount(OutcomeForm);
    await flushPromises();

    await wrapper.find('.btn-primary').trigger('click');
    expect(wrapper.find('.form-error').text()).toBe('Title is required');
  });

  it('calls createOutcome on save in create mode', async () => {
    const wrapper = mount(OutcomeForm);
    await flushPromises();

    await wrapper.find('.input-lg').setValue('New Feature');
    await wrapper.find('.btn-primary').trigger('click');
    await flushPromises();

    expect(api.createOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New Feature', status: 'draft' })
    );
  });

  it('calls updateOutcome on save in edit mode', async () => {
    const wrapper = mount(OutcomeForm, {
      props: { outcome: { id: 'edit-1', title: 'Old', tags: [] } },
    });
    await flushPromises();

    await wrapper.find('.input-lg').setValue('Updated Title');
    await wrapper.find('.btn-primary').trigger('click');
    await flushPromises();

    expect(api.updateOutcome).toHaveBeenCalledWith('edit-1', expect.objectContaining({ title: 'Updated Title' }));
  });

  it('pre-selects milestone when defaultMilestoneId provided', async () => {
    const wrapper = mount(OutcomeForm, {
      props: { defaultMilestoneId: 'ms-1' },
    });
    await flushPromises();

    // The milestone select should have ms-1 selected
    const selects = wrapper.findAll('select');
    const milestoneSelect = selects[selects.length - 1]!;
    expect((milestoneSelect.element as HTMLSelectElement).value).toBe('ms-1');
  });

  it('emits cancel when cancel button clicked', async () => {
    const wrapper = mount(OutcomeForm);
    await flushPromises();

    await wrapper.findAll('.btn')[0]!.trigger('click'); // Cancel is first button
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });
});
