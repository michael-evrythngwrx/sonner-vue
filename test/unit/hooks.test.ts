/**
 * `src/hooks.ts` — `useIsDocumentHidden` (state-api-spec.md §3.1-§3.2, AC-S4) and `useSonner`
 * (React source: `sonner-react/src/index.tsx` lines 552-591; relocated into hooks.ts by
 * component-spec.md §7 / ARCHITECTURE.md's file layout).
 *
 * test-contract.md §10: `useSonner()` is "exported by the library, entirely unused/untested by
 * the test app" — this file is its only coverage. `useIsDocumentHidden` is likewise never
 * reached by the 36 Playwright specs (they never background the tab).
 *
 * Both composables register lifecycle hooks, so every test mounts them inside a real Vue app
 * (@vue/test-utils) rather than calling them bare.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, type Ref } from 'vue';
import { useIsDocumentHidden, useSonner } from '../../src/hooks';
import { ToastState, toast } from '../../src/state';
import type { ToastT } from '../../src/types';
import {
  flushRaf,
  installRafStub,
  mountSetup,
  nextMacrotask,
  resetToastState,
  restoreRafStub,
} from './helpers';

// ---------------------------------------------------------------------------------------
// document.hidden control. jsdom defines `hidden` as a getter on Document.prototype; defining
// an own property on the instance shadows it, and deleting that own property restores it.
// ---------------------------------------------------------------------------------------
let hiddenValue = false;

function stubDocumentHidden(): void {
  hiddenValue = false;
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hiddenValue,
  });
}

function setHidden(value: boolean): void {
  hiddenValue = value;
}

function restoreDocumentHidden(): void {
  delete (document as unknown as { hidden?: boolean }).hidden;
}

beforeEach(() => {
  resetToastState();
  installRafStub();
  stubDocumentHidden();
});

afterEach(() => {
  restoreDocumentHidden();
  restoreRafStub();
  resetToastState();
  vi.restoreAllMocks();
});

// =========================================================================================
// useIsDocumentHidden (§3.1-§3.2)
// =========================================================================================
describe('useIsDocumentHidden (§3.2)', () => {
  it('seeds the ref from `document.hidden` at composable-call time (not lazily)', () => {
    setHidden(true);
    const { result, wrapper } = mountSetup(() => useIsDocumentHidden());

    expect(result.value).toBe(true);
    wrapper.unmount();
  });

  it('seeds `false` when the document is visible', () => {
    const { result, wrapper } = mountSetup(() => useIsDocumentHidden());
    expect(result.value).toBe(false);
    wrapper.unmount();
  });

  it('registers exactly one `visibilitychange` listener on `document` (not `window`) after mount', () => {
    const docSpy = vi.spyOn(document, 'addEventListener');
    const winSpy = vi.spyOn(window, 'addEventListener');

    const { wrapper } = mountSetup(() => useIsDocumentHidden());

    const visibilityCalls = docSpy.mock.calls.filter(([type]) => type === 'visibilitychange');
    expect(visibilityCalls).toHaveLength(1);
    expect(winSpy.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(0);
    wrapper.unmount();
  });

  it('re-syncs from `document.hidden` on every visibilitychange event', async () => {
    const { result, wrapper } = mountSetup(() => useIsDocumentHidden());

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();
    expect(result.value).toBe(true);

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();
    expect(result.value).toBe(false);

    wrapper.unmount();
  });

  it('re-reads `document.hidden` rather than inspecting the event payload', async () => {
    const { result, wrapper } = mountSetup(() => useIsDocumentHidden());

    // A different event type must not touch the ref, even with `hidden` already flipped.
    setHidden(true);
    document.dispatchEvent(new Event('someotherevent'));
    await nextTick();
    expect(result.value).toBe(false);

    // The event object carries nothing useful; only `document.hidden` matters.
    document.dispatchEvent(Object.assign(new Event('visibilitychange'), { hidden: false }));
    await nextTick();
    expect(result.value).toBe(true);

    wrapper.unmount();
  });

  it('removes the SAME handler reference on unmount and stops updating afterwards', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { result, wrapper } = mountSetup(() => useIsDocumentHidden());
    const registered = addSpy.mock.calls.find(([type]) => type === 'visibilitychange')![1];

    wrapper.unmount();

    const removed = removeSpy.mock.calls.find(([type]) => type === 'visibilitychange')!;
    expect(removed[1]).toBe(registered);

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();
    expect(result.value).toBe(false);
  });

  it('gives each component instance its own independent ref', async () => {
    const a = mountSetup(() => useIsDocumentHidden());
    const b = mountSetup(() => useIsDocumentHidden());

    expect(a.result).not.toBe(b.result);

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();
    expect(a.result.value).toBe(true);
    expect(b.result.value).toBe(true);

    a.wrapper.unmount();
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();
    expect(a.result.value).toBe(true); // frozen after unmount
    expect(b.result.value).toBe(false);

    b.wrapper.unmount();
  });
});

// =========================================================================================
// useSonner
// =========================================================================================
describe('useSonner (subscribe/unsubscribe lifecycle)', () => {
  const mountSonner = () => mountSetup(() => useSonner());

  it('returns `{ toasts }` as a Ref<ToastT[]> starting empty', () => {
    const { result, wrapper } = mountSonner();
    expect(Object.keys(result)).toEqual(['toasts']);
    expect((result.toasts as Ref<ToastT[]>).value).toEqual([]);
    wrapper.unmount();
  });

  it('subscribes to ToastState on mount and unsubscribes on unmount', () => {
    expect(ToastState.subscribers).toHaveLength(0);

    const { wrapper } = mountSonner();
    expect(ToastState.subscribers).toHaveLength(1);

    wrapper.unmount();
    expect(ToastState.subscribers).toHaveLength(0);
  });

  it('each mounted instance adds its own subscriber', () => {
    const a = mountSonner();
    const b = mountSonner();
    expect(ToastState.subscribers).toHaveLength(2);

    a.wrapper.unmount();
    expect(ToastState.subscribers).toHaveLength(1);
    b.wrapper.unmount();
    expect(ToastState.subscribers).toHaveLength(0);
  });

  it('defers the update by a macrotask — `toasts` is still empty synchronously after toast()', async () => {
    const { result, wrapper } = mountSonner();

    toast.success('a');
    expect(result.toasts.value).toHaveLength(0);

    await nextMacrotask();
    expect(result.toasts.value).toHaveLength(1);
    expect(result.toasts.value[0]!.title).toBe('a');
    expect(result.toasts.value[0]!.type).toBe('success');

    wrapper.unmount();
  });

  it('PREPENDS new toasts (newest first)', async () => {
    const { result, wrapper } = mountSonner();

    toast.success('first');
    toast.success('second');
    await nextMacrotask();

    expect(result.toasts.value.map((t) => t.title)).toEqual(['second', 'first']);
    wrapper.unmount();
  });

  it('merges an update into the existing entry, preserving its array position', async () => {
    const { result, wrapper } = mountSonner();

    toast.success('first', { id: 'a' });
    toast.success('second', { id: 'b' });
    await nextMacrotask();
    expect(result.toasts.value.map((t) => t.id)).toEqual(['b', 'a']);

    toast.error('first updated', { id: 'a' });
    await nextMacrotask();

    expect(result.toasts.value).toHaveLength(2);
    expect(result.toasts.value.map((t) => t.id)).toEqual(['b', 'a']);
    const updated = result.toasts.value[1]!;
    expect(updated.title).toBe('first updated');
    expect(updated.type).toBe('error');

    wrapper.unmount();
  });

  it('removes the toast on a dismiss event (after the rAF deferral AND the macrotask deferral)', async () => {
    const { result, wrapper } = mountSonner();

    const id = toast.success('a');
    toast.success('b');
    await nextMacrotask();
    expect(result.toasts.value).toHaveLength(2);

    toast.dismiss(id);
    await nextMacrotask();
    expect(result.toasts.value).toHaveLength(2); // rAF has not fired yet

    flushRaf();
    await nextMacrotask();
    expect(result.toasts.value).toHaveLength(1);
    expect(result.toasts.value[0]!.title).toBe('b');

    wrapper.unmount();
  });

  it('dismiss-all removes every tracked toast (synchronous publish, still macrotask-deferred state update)', async () => {
    const { result, wrapper } = mountSonner();

    toast.success('a');
    toast.success('b');
    await nextMacrotask();
    expect(result.toasts.value).toHaveLength(2);

    toast.dismiss();
    await nextMacrotask();

    expect(result.toasts.value).toHaveLength(0);
    wrapper.unmount();
  });

  it('stops tracking after unmount', async () => {
    const { result, wrapper } = mountSonner();
    toast.success('a');
    await nextMacrotask();
    expect(result.toasts.value).toHaveLength(1);

    wrapper.unmount();

    toast.success('b');
    await nextMacrotask();
    expect(result.toasts.value).toHaveLength(1);
  });

  it('tracks toasts created by the base callable `toast()` too (it publishes via addToast)', async () => {
    const { result, wrapper } = mountSonner();

    toast('bare');
    await nextMacrotask();

    expect(result.toasts.value).toHaveLength(1);
    expect(result.toasts.value[0]!.title).toBe('bare');
    wrapper.unmount();
  });

  it('is independent of ToastState.toasts — it only ever reflects published events', async () => {
    // Toasts created BEFORE the composable mounted are never back-filled.
    toast.success('created before mount');
    const { result, wrapper } = mountSonner();
    await nextMacrotask();

    expect(ToastState.toasts).toHaveLength(1);
    expect(result.toasts.value).toHaveLength(0);
    wrapper.unmount();
  });
});
