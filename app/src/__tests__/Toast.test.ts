import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import Toast from '../components/Toast.vue';
import { useToast } from '../composables/useToast';

describe('Toast.vue', () => {
  beforeEach(() => {
    useToast().clearAll();
  });

  it('renders nothing when the stack is empty', () => {
    const wrapper = mount(Toast);
    expect(wrapper.findAll('.toast')).toHaveLength(0);
  });

  it('renders one node per toast with the right variant class', async () => {
    const { pushToast } = useToast();
    const wrapper = mount(Toast);
    pushToast('error', 'Something went wrong');
    pushToast('success', 'Saved');
    await flushPromises();

    const nodes = wrapper.findAll('.toast');
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.classes()).toContain('toast-error');
    expect(nodes[1]!.classes()).toContain('toast-success');
    expect(nodes[0]!.find('.toast-message').text()).toBe('Something went wrong');
  });

  it('renders title when provided', async () => {
    const { pushToast } = useToast();
    const wrapper = mount(Toast);
    pushToast('error', 'detail', { title: 'Server error' });
    await flushPromises();

    expect(wrapper.find('.toast-title').text()).toBe('Server error');
  });

  it('dismisses a toast when its close button is clicked', async () => {
    const { pushToast, toasts } = useToast();
    const wrapper = mount(Toast);
    pushToast('info', 'hi', { timeoutMs: null });
    await flushPromises();

    expect(toasts.value).toHaveLength(1);
    await wrapper.find('.toast-close').trigger('click');
    expect(toasts.value).toHaveLength(0);
  });
});
