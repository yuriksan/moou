import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../composables/useApi', () => ({
  api: {
    getMotivationTypes: vi.fn().mockResolvedValue([
      { id: 'mt-1', name: 'Customer Demand', attributeSchema: { type: 'object', properties: { customer_name: { type: 'string' }, revenue_at_risk: { type: 'number' }, confidence: { type: 'number' } }, additionalProperties: false } },
      { id: 'mt-2', name: 'Tech Debt', attributeSchema: { type: 'object', properties: { incident_frequency: { type: 'number' } }, additionalProperties: false } },
    ]),
    getTags: vi.fn().mockResolvedValue([]),
    createMotivation: vi.fn().mockResolvedValue({ id: 'new-m', title: 'Test' }),
    linkMotivation: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../components/TagPicker.vue', () => ({
  default: { template: '<div class="mock-tag-picker"></div>', props: ['modelValue'] },
}));

import MotivationForm from '../components/MotivationForm.vue';
import { api } from '../composables/useApi';

describe('MotivationForm', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders type picker with all types', async () => {
    const wrapper = mount(MotivationForm);
    await flushPromises();

    const typeBtns = wrapper.findAll('.type-btn');
    expect(typeBtns).toHaveLength(2);
    expect(typeBtns[0]!.text()).toBe('Customer Demand');
    expect(typeBtns[1]!.text()).toBe('Tech Debt');
  });

  it('shows progressive disclosure button after selecting type', async () => {
    const wrapper = mount(MotivationForm);
    await flushPromises();

    // No expand button initially (no type selected)
    expect(wrapper.find('.expand-btn').exists()).toBe(false);

    // Select a type
    await wrapper.findAll('.type-btn')[0]!.trigger('click');
    expect(wrapper.find('.expand-btn').exists()).toBe(true);
  });

  it('shows attribute fields after clicking "+ Add details"', async () => {
    const wrapper = mount(MotivationForm);
    await flushPromises();

    await wrapper.findAll('.type-btn')[0]!.trigger('click');
    await wrapper.find('.expand-btn').trigger('click');

    expect(wrapper.find('.attributes-section').exists()).toBe(true);
    // Customer Demand has 3 attributes in our mock
    const attrFields = wrapper.findAll('.attributes-section .field');
    expect(attrFields.length).toBe(3);
  });

  it('requires title and type', async () => {
    const wrapper = mount(MotivationForm);
    await flushPromises();

    await wrapper.find('.btn-primary').trigger('click');
    expect(wrapper.find('.form-error').text()).toBe('Title is required');

    await wrapper.find('.input-lg').setValue('Test');
    await wrapper.find('.btn-primary').trigger('click');
    expect(wrapper.find('.form-error').text()).toBe('Type is required');
  });

  it('creates motivation and links to outcome when linkToOutcomeId provided', async () => {
    const wrapper = mount(MotivationForm, {
      props: { linkToOutcomeId: 'outcome-123' },
    });
    await flushPromises();

    await wrapper.find('.input-lg').setValue('Customer need');
    await wrapper.findAll('.type-btn')[0]!.trigger('click');
    await wrapper.find('.btn-primary').trigger('click');
    await flushPromises();

    expect(api.createMotivation).toHaveBeenCalled();
    expect(api.linkMotivation).toHaveBeenCalledWith('new-m', 'outcome-123');
  });

  it('shows "Create & Link" button text when linkToOutcomeId provided', async () => {
    const wrapper = mount(MotivationForm, {
      props: { linkToOutcomeId: 'outcome-123' },
    });
    await flushPromises();

    expect(wrapper.find('.btn-primary').text()).toBe('Create & Link');
  });
});
