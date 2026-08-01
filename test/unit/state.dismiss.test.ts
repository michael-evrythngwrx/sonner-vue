/**
 * `src/state.ts` — `dismiss()` (state-api-spec.md §2.7) and the introspection trio
 * `getActiveToasts()` / `toast.getHistory()` / `toast.getToasts()` (§2.11, §2.15).
 *
 * test-contract.md §10 lists BOTH `toast.dismiss()` (dismiss-all) and the introspection
 * getters as entirely untested by the 36 Playwright specs — this file is their only coverage.
 *
 * The rAF stub comes from the harness, per state-api-spec.md AC-S4: upstream calls bare
 * `requestAnimationFrame` and the port must NOT add a fallback, so the deferral is made
 * observable from the test side instead.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToastState, toast } from '../../src/state';
import type { ToastT, ToastToDismiss } from '../../src/types';
import {
  capture,
  dismissEvents,
  flushRaf,
  installRafStub,
  pendingFrames,
  resetToastState,
  restoreRafStub,
} from './helpers';

const history = () => ToastState.toasts as ToastT[];

beforeEach(() => {
  resetToastState();
  installRafStub();
});

afterEach(() => {
  restoreRafStub();
  resetToastState();
});

// =========================================================================================
// §2.7 single-id branch
// =========================================================================================
describe('dismiss(id) — truthy-id branch (§2.7)', () => {
  it('adds the id to dismissedToasts SYNCHRONOUSLY but defers the subscriber publish to requestAnimationFrame', () => {
    const id = toast.success('a');
    const c = capture();

    const returned = toast.dismiss(id);

    // Synchronous half.
    expect(returned).toBe(id);
    expect(ToastState.dismissedToasts.has(id as number)).toBe(true);
    expect(c.events).toHaveLength(0);
    expect(pendingFrames()).toBe(1);

    // Deferred half.
    flushRaf();
    expect(c.events).toEqual([{ id, dismiss: true }]);
    c.unsubscribe();
  });

  it('getActiveToasts()/getToasts() already exclude the toast BEFORE the frame fires', () => {
    const id = toast.success('a');
    toast.success('b');

    toast.dismiss(id);

    expect(pendingFrames()).toBe(1); // publish not yet delivered
    expect(toast.getToasts()).toHaveLength(1);
    // `getToasts()` is typed `Array<ToastT | ToastToDismiss>` (Observer.toasts' own union, as
    // upstream) — narrow to read `title`. Assertion semantics unchanged.
    expect((toast.getToasts()[0] as ToastT).title).toBe('b');
    expect(ToastState.getActiveToasts()).toHaveLength(1);
  });

  it('never removes the toast from the history array (§2.2 — Observer.toasts is append-only)', () => {
    const id = toast.success('a');
    toast.dismiss(id);
    flushRaf();

    expect(toast.getHistory()).toHaveLength(1);
    expect(history()[0]!.id).toBe(id);
    expect(toast.getToasts()).toHaveLength(0);
  });

  it('fans out to every subscriber, in subscription order, when the frame fires', () => {
    const id = toast.success('a');
    const order: string[] = [];
    ToastState.subscribe(() => order.push('first'));
    ToastState.subscribe(() => order.push('second'));

    toast.dismiss(id);
    expect(order).toEqual([]);
    flushRaf();
    expect(order).toEqual(['first', 'second']);
  });

  it('schedules one independent frame per call — dismissing the same id twice publishes twice', () => {
    const id = toast.success('a');
    const c = capture();

    toast.dismiss(id);
    toast.dismiss(id);

    expect(pendingFrames()).toBe(2);
    expect(ToastState.dismissedToasts.size).toBe(1); // Set dedupes
    flushRaf();
    expect(dismissEvents(c)).toEqual([
      { id, dismiss: true },
      { id, dismiss: true },
    ]);
    c.unsubscribe();
  });

  it('dismisses an id that was never created (no history entry required)', () => {
    const c = capture();
    const returned = toast.dismiss('never-existed');

    expect(returned).toBe('never-existed');
    expect(ToastState.dismissedToasts.has('never-existed')).toBe(true);
    flushRaf();
    expect(c.events).toEqual([{ id: 'never-existed', dismiss: true }]);
    c.unsubscribe();
  });

  it('a subscriber added AFTER the dismiss call but BEFORE the frame still receives the event', () => {
    const id = toast.success('a');
    toast.dismiss(id);

    const late = capture();
    flushRaf();

    expect(late.events).toEqual([{ id, dismiss: true }]);
    late.unsubscribe();
  });
});

// =========================================================================================
// §2.7 dismiss-all branch
// =========================================================================================
describe('dismiss() — falsy-id (dismiss-all) branch (§2.7)', () => {
  it('publishes SYNCHRONOUSLY for every history entry, with no requestAnimationFrame at all', () => {
    const a = toast.success('a');
    const b = toast.success('b');
    const c = capture();

    const returned = toast.dismiss();

    expect(returned).toBeUndefined();
    expect(pendingFrames()).toBe(0);
    expect(c.events).toEqual([
      { id: a, dismiss: true },
      { id: b, dismiss: true },
    ]);
    c.unsubscribe();
  });

  it('QUIRK §2.7: dismiss-all NEVER populates dismissedToasts, so getToasts() is unchanged by it', () => {
    toast.success('a');
    toast.success('b');
    const before = toast.getToasts();

    toast.dismiss();

    expect(ToastState.dismissedToasts.size).toBe(0);
    expect(toast.getToasts()).toEqual(before);
    expect(toast.getToasts()).toHaveLength(2);
  });

  it('iterates the FULL history, re-publishing dismiss events for already-dismissed toasts too', () => {
    const a = toast.success('a');
    const b = toast.success('b');
    toast.dismiss(a);
    flushRaf();

    const c = capture();
    toast.dismiss();

    expect(c.events).toEqual([
      { id: a, dismiss: true },
      { id: b, dismiss: true },
    ]);
    c.unsubscribe();
  });

  it('QUIRK §2.7: `dismiss(0)` takes the dismiss-all path (0 is falsy) instead of dismissing id 0', () => {
    const zero = toast.success('the zero toast', { id: 0 });
    const other = toast.success('other');
    expect(zero).toBe(0);

    const c = capture();
    const returned = toast.dismiss(0);

    expect(returned).toBe(0);
    expect(ToastState.dismissedToasts.has(0)).toBe(false);
    expect(pendingFrames()).toBe(0);
    expect(c.events).toEqual([
      { id: 0, dismiss: true },
      { id: other, dismiss: true },
    ]);
    // Nothing was marked inactive, so both toasts are still "active".
    expect(toast.getToasts()).toHaveLength(2);
    c.unsubscribe();
  });

  it('QUIRK §2.7: `dismiss("")` also takes the dismiss-all path and returns the empty string', () => {
    toast.success('a');
    const c = capture();

    const returned = toast.dismiss('');

    expect(returned).toBe('');
    expect(ToastState.dismissedToasts.size).toBe(0);
    expect(c.events).toHaveLength(1);
    c.unsubscribe();
  });

  it('publishes nothing when the history is empty', () => {
    const c = capture();
    toast.dismiss();
    expect(c.events).toHaveLength(0);
    c.unsubscribe();
  });
});

// =========================================================================================
// §2.11 / §2.15 introspection
// =========================================================================================
describe('getActiveToasts / getHistory / getToasts (§2.11, §2.15)', () => {
  it('getHistory() is the raw, ever-growing array — updates replace entries but never shrink it', () => {
    toast.success('a', { id: 'a' });
    toast.success('b', { id: 'b' });
    toast.success('a updated', { id: 'a' });

    expect(toast.getHistory()).toHaveLength(2);
    expect((toast.getHistory() as ToastT[]).map((t) => t.title)).toEqual(['a updated', 'b']);
  });

  it('getToasts() filters strictly by dismissedToasts membership', () => {
    const a = toast.success('a');
    toast.success('b');

    expect(toast.getToasts()).toHaveLength(2);
    toast.dismiss(a);
    expect(toast.getToasts()).toHaveLength(1);
    flushRaf();
    expect(toast.getToasts()).toHaveLength(1);
  });

  it('getToasts() returns the live stored objects (not copies)', () => {
    toast.success('a');
    expect(toast.getToasts()[0]).toBe(ToastState.toasts[0]);
  });

  it('dismissed-then-recreated toasts reappear in getToasts()', () => {
    const id = toast.success('a', { id: 'a' });
    toast.dismiss(id);
    expect(toast.getToasts()).toHaveLength(0);

    toast.success('a again', { id: 'a' });

    expect(toast.getToasts()).toHaveLength(1);
    expect((toast.getToasts()[0] as ToastT).title).toBe('a again');
  });

  it('base `toast()` entries with duplicate ids are ALL filtered out by a single dismiss', () => {
    toast('one', { id: 'dup' });
    toast('two', { id: 'dup' });
    expect(toast.getToasts()).toHaveLength(2);

    toast.dismiss('dup');

    expect(toast.getToasts()).toHaveLength(0);
    expect(toast.getHistory()).toHaveLength(2);
    flushRaf();
  });

  it('dismiss events published for a toast are `ToastToDismiss`-shaped, never `ToastT`-shaped', () => {
    const id = toast.success('a');
    const c = capture();
    toast.dismiss(id);
    flushRaf();

    const evt = c.events[0] as ToastToDismiss;
    expect(evt.dismiss).toBe(true);
    expect((evt as unknown as ToastT).title).toBeUndefined();
    expect((evt as unknown as ToastT).type).toBeUndefined();
    c.unsubscribe();
  });
});
