/**
 * `src/state.ts` — Observer primitives, the base callable `toast()`, the six typed wrappers,
 * `create()`'s dedupe/update engine and `custom()`.
 *
 * Every assertion below encodes UPSTREAM sonner v2.0.7 behavior (sonner-react/src/state.ts),
 * as documented in specs/state-api-spec.md §2.1–§2.6, §2.8, §2.10, §2.14, §2.15 and its
 * "Summary of behaviors that look like bugs but must be preserved" (§5). Quirks asserted here
 * are PARITY REQUIREMENTS, not defects.
 *
 * Untouched by the 36 Playwright tests (test-contract.md §10): `toast.loading/message/info/
 * warning`, `toast.getHistory()/getToasts()`, cross-type id-collision updates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { ToastState, toast } from '../../src/state';
import type { ToastT, ToastToDismiss } from '../../src/types';
import { capture, flushRaf, installRafStub, resetToastState, restoreRafStub, toastEvents } from './helpers';

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
// §2.3–§2.5 Observer primitives
// =========================================================================================
describe('Observer primitives (§2.3 subscribe / §2.4 publish / §2.5 addToast)', () => {
  it('subscribe() appends and returns an unsubscribe closure; publish() fans out synchronously in subscription order', () => {
    const order: string[] = [];
    const unsubA = ToastState.subscribe(() => order.push('a'));
    ToastState.subscribe(() => order.push('b'));

    expect(ToastState.subscribers).toHaveLength(2);
    ToastState.publish({ id: 1 } as ToastT);
    expect(order).toEqual(['a', 'b']);

    unsubA();
    expect(ToastState.subscribers).toHaveLength(1);
    ToastState.publish({ id: 2 } as ToastT);
    expect(order).toEqual(['a', 'b', 'b']);
  });

  it('QUIRK §2.3: calling the same unsubscribe twice removes the LAST subscriber (indexOf -1 -> splice(-1, 1))', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = ToastState.subscribe(a);
    ToastState.subscribe(b);

    unsubA();
    expect(ToastState.subscribers).toEqual([b]);

    // indexOf(a) is now -1, and `splice(-1, 1)` deletes the last element rather than no-oping.
    // Upstream has no `if (index === -1) return` guard, so neither may the port.
    unsubA();
    expect(ToastState.subscribers).toEqual([]);
  });

  it('§2.5: addToast() publishes BEFORE appending — subscribers observe a history that does not yet contain the toast', () => {
    let lengthAtPublishTime = -1;
    ToastState.subscribe(() => {
      lengthAtPublishTime = ToastState.toasts.length;
    });

    toast('hello');

    expect(lengthAtPublishTime).toBe(0);
    expect(ToastState.toasts).toHaveLength(1);
  });

  it('§2.5: addToast() REASSIGNS this.toasts (spread) rather than mutating the existing array', () => {
    const before = ToastState.toasts;
    toast('hello');
    expect(ToastState.toasts).not.toBe(before);
    expect(before).toHaveLength(0);
  });
});

// =========================================================================================
// §2.14 base callable `toast(message, data)` — bypasses create() entirely
// =========================================================================================
describe('base callable toast() (§2.14 — does NOT route through create())', () => {
  it('returns a freshly minted numeric id; consecutive mints increment by exactly 1', () => {
    const first = toast('a');
    const second = toast('b');
    expect(typeof first).toBe('number');
    expect(typeof second).toBe('number');
    expect(second).toBe((first as number) + 1);
  });

  it('reuses a non-empty string id verbatim', () => {
    expect(toast('a', { id: 'abc' })).toBe('abc');
    expect(history()[0]!.id).toBe('abc');
  });

  it('QUIRK §2.14: id resolution is truthiness-based (`data?.id || toastsCounter++`) so `{id: 0}` mints a FRESH id', () => {
    const id = toast('a', { id: 0 });
    expect(typeof id).toBe('number');
    expect(id).not.toBe(0);
    expect(history()[0]!.id).toBe(id);
  });

  it('QUIRK §2.14: `{id: ""}` also mints a fresh id (empty string is falsy)', () => {
    const id = toast('a', { id: '' });
    expect(typeof id).toBe('number');
    expect(history()[0]!.id).toBe(id);
  });

  it('QUIRK §2.14: applies NO `dismissible` default — the stored toast has no `dismissible` key at all', () => {
    toast('a');
    const stored = history()[0]!;
    expect('dismissible' in stored).toBe(false);
    expect(stored.dismissible).toBeUndefined();
  });

  it('QUIRK §2.14: never dedupes — a repeated id APPENDS a second entry instead of updating in place', () => {
    toast('first', { id: 'dup' });
    toast('second', { id: 'dup' });

    expect(history()).toHaveLength(2);
    expect(history().map((t) => t.id)).toEqual(['dup', 'dup']);
    expect(history()[0]!.title).toBe('first');
    expect(history()[1]!.title).toBe('second');
  });

  it('QUIRK §2.14: never un-dismisses — re-calling toast() with a dismissed id leaves it in dismissedToasts', () => {
    toast('first', { id: 'dup' });
    toast.dismiss('dup');
    expect(ToastState.dismissedToasts.has('dup')).toBe(true);

    toast('second', { id: 'dup' });

    expect(ToastState.dismissedToasts.has('dup')).toBe(true);
    // Both entries share the id, so getActiveToasts() filters out both.
    expect(toast.getToasts()).toHaveLength(0);
    expect(toast.getHistory()).toHaveLength(2);
  });

  it('stores `title: message` and places `id` last in the literal so it always wins', () => {
    const id = toast('the message', { id: 'x', description: 'desc' });
    expect(id).toBe('x');
    const stored = history()[0]!;
    expect(stored.title).toBe('the message');
    expect(stored.description).toBe('desc');
    expect(stored.id).toBe('x');
    // `message` was never destructured out here (unlike create()), but the base callable never
    // receives a `message` key — it builds `{title, ...data, id}`.
    expect('message' in stored).toBe(false);
  });

  it('accepts a function title (titleT) and stores it uncalled', () => {
    const titleFn = () => 'lazy';
    toast(titleFn);
    expect(history()[0]!.title).toBe(titleFn);
  });
});

// =========================================================================================
// §2.8 typed wrappers + §2.6 create()
// =========================================================================================
describe('typed wrappers (§2.8)', () => {
  it.each([
    ['success', 'success'],
    ['info', 'info'],
    ['warning', 'warning'],
    ['error', 'error'],
    ['loading', 'loading'],
  ] as const)('toast.%s() creates a toast with type "%s" and returns its id', (method, type) => {
    const id = (toast[method] as (m: string) => number | string)('hi');
    expect(typeof id).toBe('number');
    const stored = history()[0]!;
    expect(stored.id).toBe(id);
    expect(stored.type).toBe(type);
    expect(stored.title).toBe('hi');
  });

  it('toast.message() sets NO type at all (stays undefined)', () => {
    const id = toast.message('hi');
    const stored = history()[0]!;
    expect(stored.id).toBe(id);
    expect(stored.type).toBeUndefined();
    expect(stored.title).toBe('hi');
  });

  it('all wrappers route through create(), so they get the `dismissible: true` default', () => {
    toast.success('a');
    toast.message('b');
    toast.loading('c');
    for (const stored of history()) {
      expect(stored.dismissible).toBe(true);
    }
  });

  it('create() strips `message` from the create-branch entry (destructured into `rest`)', () => {
    toast.success('hi');
    const stored = history()[0]!;
    expect('message' in stored).toBe(false);
    expect(stored.title).toBe('hi');
  });
});

describe('create() id resolution (§2.6 step 2 — the ONLY strategy that handles id === 0)', () => {
  it('uses a numeric id as-is, INCLUDING 0 (typeof check, not truthiness)', () => {
    const id = toast.success('zero', { id: 0 });
    expect(id).toBe(0);
    expect(history()[0]!.id).toBe(0);
  });

  it('uses a non-empty string id as-is', () => {
    expect(toast.success('s', { id: 'abc' })).toBe('abc');
    expect(history()[0]!.id).toBe('abc');
  });

  it('mints a fresh id for an empty-string id, and the trailing `id` key discards the ""', () => {
    const id = toast.success('s', { id: '' });
    expect(typeof id).toBe('number');
    expect(history()[0]!.id).toBe(id);
    expect(history()[0]!.id).not.toBe('');
  });

  it('mints a fresh id when no id is supplied', () => {
    const a = toast.success('a');
    const b = toast.success('b');
    expect(typeof a).toBe('number');
    expect(b).toBe((a as number) + 1);
  });

  it('id lookup is strict `===`, so 5 and "5" are two different toasts', () => {
    toast.success('numeric', { id: 5 });
    toast.success('stringy', { id: '5' });
    expect(history()).toHaveLength(2);
    expect(history().map((t) => t.id)).toEqual([5, '5']);
  });
});

describe('create() dedupe / update engine (§2.6 steps 3-7)', () => {
  it('updates an existing toast in place: same array length, same id, replaced object reference', () => {
    toast.success('first', { id: 'x' });
    const original = history()[0]!;

    toast.success('second', { id: 'x' });

    expect(history()).toHaveLength(1);
    expect(history()[0]!.id).toBe('x');
    expect(history()[0]!.title).toBe('second');
    expect(history()[0]).not.toBe(original);
  });

  it('leaves non-matching entries as the very same object references', () => {
    toast.success('a', { id: 'a' });
    toast.success('b', { id: 'b' });
    const untouched = history()[0]!;

    toast.success('b2', { id: 'b' });

    expect(history()[0]).toBe(untouched);
    expect(history()[1]!.title).toBe('b2');
  });

  it('QUIRK §2.6 step 6: the UPDATE branch spreads the whole `data`, leaving a stray `message` key alongside `title`', () => {
    toast.success('first', { id: 'x' });
    expect('message' in history()[0]!).toBe(false); // create branch: destructured out

    toast.success('second', { id: 'x' });
    const updated = history()[0]! as ToastT & { message?: unknown };
    expect(updated.title).toBe('second');
    expect('message' in updated).toBe(true); // update branch: `...data` puts it back
    expect(updated.message).toBe('second');
  });

  it('updates across types (success -> error) — untested by the 36 e2e specs', () => {
    toast.success('was success', { id: 'x' });
    toast.error('now error', { id: 'x' });

    expect(history()).toHaveLength(1);
    expect(history()[0]!.type).toBe('error');
    expect(history()[0]!.title).toBe('now error');
  });

  it('finds toasts anywhere in the ever-growing history array, including already-dismissed ones', () => {
    toast.success('a', { id: 'a' });
    toast.success('b', { id: 'b' });
    toast.dismiss('a');

    toast.success('a-again', { id: 'a' });

    expect(history()).toHaveLength(2);
    expect(history()[0]!.title).toBe('a-again');
  });

  it('§2.6 step 4: create() un-dismisses unconditionally, on both the create and update paths', () => {
    const id = toast.success('a', { id: 'a' });
    toast.dismiss(id);
    expect(ToastState.dismissedToasts.has('a')).toBe(true);

    toast.success('a-again', { id: 'a' });

    expect(ToastState.dismissedToasts.has('a')).toBe(false);
    expect(toast.getToasts()).toHaveLength(1);
  });

  it('§2.6 step 4: un-dismiss also happens when the id has no matching history entry (create path)', () => {
    toast.dismiss('ghost');
    expect(ToastState.dismissedToasts.has('ghost')).toBe(true);

    toast.success('materialised', { id: 'ghost' });

    expect(ToastState.dismissedToasts.has('ghost')).toBe(false);
  });
});

describe('create() `dismissible` handling (§2.6 steps 5-6)', () => {
  it('defaults to true when `dismissible` is undefined, and preserves an explicit false', () => {
    toast.success('a', { id: 'a' });
    toast.success('b', { id: 'b', dismissible: false });

    expect(history()[0]!.dismissible).toBe(true);
    expect(history()[1]!.dismissible).toBe(false);
  });

  it('QUIRK §2.6 step 6 (the publish/store asymmetry): the PUBLISHED object keeps the OLD dismissible while the STORED entry gets the recomputed default', () => {
    // Seed a non-dismissible toast, then update it without passing `dismissible` again.
    toast.success('first', { id: 'x', dismissible: false });
    expect(history()[0]!.dismissible).toBe(false);

    const c = capture();
    toast.success('second', { id: 'x' });
    c.unsubscribe();

    const published = toastEvents(c);
    expect(published).toHaveLength(1);

    // The published literal is `{...oldToast, ...data, id, title}` — it deliberately omits an
    // explicit `dismissible` key, so `...oldToast` wins and subscribers see the OLD `false`.
    expect(published[0]!.dismissible).toBe(false);

    // The stored entry is `{...oldToast, ...data, id, dismissible, title}` — it DOES set the
    // freshly computed default, so the array now says `true`. Upstream diverges here; the port
    // must diverge identically (do not add `dismissible` to the published object).
    expect(history()[0]!.dismissible).toBe(true);
  });

  it('publish/store agree when the update call passes `dismissible` explicitly', () => {
    toast.success('first', { id: 'x', dismissible: false });

    const c = capture();
    toast.success('second', { id: 'x', dismissible: false });
    c.unsubscribe();

    expect(toastEvents(c)[0]!.dismissible).toBe(false);
    expect(history()[0]!.dismissible).toBe(false);
  });

  it('the published update object carries the merged old+new fields plus `id` and `title`', () => {
    toast.success('first', { id: 'x', description: 'kept', duration: 1234 });

    const c = capture();
    toast.error('second', { id: 'x' });
    c.unsubscribe();

    const published = toastEvents(c)[0]!;
    expect(published.id).toBe('x');
    expect(published.title).toBe('second');
    expect(published.type).toBe('error');
    expect(published.description).toBe('kept'); // survives from the old entry
    expect(published.duration).toBe(1234); // survives from the old entry
  });
});

// =========================================================================================
// §2.10 custom()
// =========================================================================================
describe('custom() (§2.10)', () => {
  it('invokes the jsx callback synchronously with the resolved id and stores the result as `jsx`', () => {
    const vnode = h('div', 'custom');
    const cb = vi.fn(() => vnode);

    const id = toast.custom(cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(id);
    expect(history()[0]!.jsx).toBe(vnode);
    expect(history()[0]!.id).toBe(id);
  });

  it('routes through create(), so it gets the `dismissible: true` default and no `message` key', () => {
    toast.custom(() => h('div'));
    expect(history()[0]!.dismissible).toBe(true);
    expect('message' in history()[0]!).toBe(false);
  });

  it('reuses a truthy id', () => {
    const id = toast.custom(() => h('div'), { id: 'c' });
    expect(id).toBe('c');
    expect(history()[0]!.id).toBe('c');
  });

  it('QUIRK §2.10: id resolution is `data?.id || toastsCounter++`, so `{id: 0}` mints a FRESH id', () => {
    const cb = vi.fn(() => h('div'));
    const id = toast.custom(cb, { id: 0 });

    expect(typeof id).toBe('number');
    expect(id).not.toBe(0);
    expect(cb).toHaveBeenCalledWith(id);
    // `{jsx, ...data, id}` — the trailing `id` key overrides the `0` that came in via `data`.
    expect(history()[0]!.id).toBe(id);
  });

  it('QUIRK §2.10: `{id: ""}` also mints a fresh id (the empty-id playground case)', () => {
    const id = toast.custom(() => h('div'), { id: '' });
    expect(typeof id).toBe('number');
    expect(history()[0]!.id).toBe(id);
  });

  it('updates in place when the id already exists', () => {
    toast.custom(() => h('div', 'one'), { id: 'c' });
    toast.custom(() => h('div', 'two'), { id: 'c' });
    expect(history()).toHaveLength(1);
  });
});

// =========================================================================================
// §2.15 exported `toast` object shape
// =========================================================================================
describe('exported `toast` object (§2.15)', () => {
  it('is simultaneously callable and carries exactly 11 own enumerable properties, in Object.assign order', () => {
    expect(typeof toast).toBe('function');
    expect(Object.keys(toast)).toEqual([
      'success',
      'info',
      'warning',
      'error',
      'custom',
      'message',
      'promise',
      'dismiss',
      'loading',
      'getHistory',
      'getToasts',
    ]);
  });

  it('exposes the very same bound arrow-function fields torn off ToastState', () => {
    expect(toast.success).toBe(ToastState.success);
    expect(toast.info).toBe(ToastState.info);
    expect(toast.warning).toBe(ToastState.warning);
    expect(toast.error).toBe(ToastState.error);
    expect(toast.custom).toBe(ToastState.custom);
    expect(toast.message).toBe(ToastState.message);
    expect(toast.promise).toBe(ToastState.promise);
    expect(toast.dismiss).toBe(ToastState.dismiss);
    expect(toast.loading).toBe(ToastState.loading);
  });

  it('deliberately does NOT expose `create` or `getActiveToasts`', () => {
    expect((toast as unknown as Record<string, unknown>).create).toBeUndefined();
    expect((toast as unknown as Record<string, unknown>).getActiveToasts).toBeUndefined();
  });

  it('torn-off methods keep their `this` binding when fully detached', () => {
    const { success, dismiss } = toast;
    const id = success('detached');
    expect(history()).toHaveLength(1);
    expect(dismiss(id)).toBe(id);
    expect(ToastState.dismissedToasts.has(id as string | number)).toBe(true);
    flushRaf();
  });

  it('getHistory() returns the live `ToastState.toasts` array by reference', () => {
    expect(toast.getHistory()).toBe(ToastState.toasts);
    toast.success('a');
    expect(toast.getHistory()).toBe(ToastState.toasts);
    expect(toast.getHistory()).toHaveLength(1);
  });

  it('getToasts() delegates to getActiveToasts() (a fresh filtered array each call)', () => {
    toast.success('a');
    const first = toast.getToasts();
    const second = toast.getToasts();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first).toEqual(ToastState.getActiveToasts());
  });
});

// =========================================================================================
// Subscriber payload shape
// =========================================================================================
describe('published payloads', () => {
  it('publishes the exact stored object on the create path (same reference)', () => {
    const c = capture();
    toast.success('a');
    c.unsubscribe();

    expect(c.events).toHaveLength(1);
    expect(c.events[0]).toBe(ToastState.toasts[0]);
  });

  it('dismiss publishes a `{id, dismiss: true}` shape distinguishable from a toast payload', () => {
    const id = toast.success('a');
    const c = capture();
    toast.dismiss(id);
    flushRaf();
    c.unsubscribe();

    expect(c.events).toHaveLength(1);
    const evt = c.events[0] as ToastToDismiss;
    expect(evt).toEqual({ id, dismiss: true });
    expect(Object.keys(evt)).toEqual(['id', 'dismiss']);
  });
});
