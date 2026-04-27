import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('../composables/useApi', () => ({
  api: {
    getMotivation: vi.fn(),
    getMotivationHistory: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getMotivationTypes: vi.fn(),
    resolveMotivation: vi.fn().mockResolvedValue({}),
    reopenMotivation: vi.fn().mockResolvedValue({}),
    deleteMotivation: vi.fn().mockResolvedValue({}),
    unlinkMotivation: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../components/MotivationForm.vue', () => ({
  default: { template: '<div class="mock-motivation-form"></div>' },
}));

import MotivationDetail from '../components/MotivationDetail.vue';
import { api } from '../composables/useApi';

describe('MotivationDetail readonly attributes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getMotivationHistory).mockResolvedValue({ data: [], total: 0 });
  });

  it('renders schema-defined attribute fields in readonly mode even when values are missing', async () => {
    vi.mocked(api.getMotivation).mockResolvedValue({
      id: 'm-1',
      title: 'NTT DoCoMo, Inc. :Oracle Private Cloud',
      typeId: 'mt-customer',
      typeName: 'Customer Demand',
      status: 'active',
      score: 0,
      attributes: {},
      tags: [],
      outcomes: [],
    });

    vi.mocked(api.getMotivationTypes).mockResolvedValue([
      {
        id: 'mt-customer',
        name: 'Customer Demand',
        attributeSchema: {
          type: 'object',
          properties: {
            segment: { type: 'string' },
            confidence: { type: 'number' },
            target_date: { type: 'string', format: 'date' },
            strategic_flag: { type: 'boolean' },
            revenue_at_risk: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    ]);

    const wrapper = mount(MotivationDetail, { props: { motivationId: 'm-1' } });
    await flushPromises();

    const keys = wrapper.findAll('.attr-key').map((n) => n.text());
    expect(keys).toEqual([
      'segment',
      'confidence',
      'target date',
      'strategic flag',
      'revenue at risk',
    ]);

    const values = wrapper.findAll('.attr-value').map((n) => n.text());
    expect(values).toEqual(['—', '—', '—', '—', '—']);
    expect(wrapper.text()).not.toContain('No attributes configured');
  });

  it('falls back to raw attributes when type schema is unavailable', async () => {
    vi.mocked(api.getMotivation).mockResolvedValue({
      id: 'm-2',
      title: 'Fallback',
      typeId: 'mt-missing',
      typeName: 'Customer Demand',
      status: 'active',
      score: 0,
      attributes: {
        customer_name: 'Acme Corp',
      },
      tags: [],
      outcomes: [],
    });

    vi.mocked(api.getMotivationTypes).mockResolvedValue([]);

    const wrapper = mount(MotivationDetail, { props: { motivationId: 'm-2' } });
    await flushPromises();

    const keys = wrapper.findAll('.attr-key').map((n) => n.text());
    expect(keys).toEqual(['customer name']);

    const values = wrapper.findAll('.attr-value').map((n) => n.text());
    expect(values).toEqual(['Acme Corp']);
  });
});