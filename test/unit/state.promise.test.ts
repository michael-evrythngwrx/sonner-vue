/**
 * `src/state.ts` — the full `toast.promise()` branch matrix (state-api-spec.md §2.9, steps
 * 0-8, plus AC-S3).
 *
 * The 36 Playwright specs exercise only two promise paths (a plain resolve and a plain
 * `Error` rejection). Everything else here — the `Response`-shaped branch, the resolved-Error
 * branch, extended-result objects, `description` carry-over, `shouldDismiss`, `finally`
 * ordering, `unwrap()`, and the boxed return value — is unique to this file
 * (test-contract.md §10).
 *
 * SYNCHRONISATION: `unwrap()`'s promise settles only after the whole
 * `.then/.catch/.finally` chain has run (§2.9 step 7), so `await settle(handle)` is the exact
 * "all side effects done" barrier. See helpers.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { ToastState, toast } from '../../src/state';
import type { ToastT } from '../../src/types';
import {
  capture,
  deferred,
  dismissEvents,
  flushRaf,
  installRafStub,
  pendingFrames,
  resetToastState,
  restoreRafStub,
  settle,
} from './helpers';

type PromiseHandle = { unwrap: () => Promise<unknown> };

const history = () => ToastState.toasts as ToastT[];
const only = () => {
  expect(history()).toHaveLength(1);
  return history()[0]!;
};

// `toast.promise` is typed against the public `PromiseData` contract; these tests deliberately
// feed it upstream-legal shapes that the narrowed port types do not always model (raw
// `Response`-alikes, `null` handler results). Cast at the call site, never in `src/`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const promiseOf = (p: unknown, data?: unknown): PromiseHandle =>
  (toast.promise as unknown as (p: unknown, d?: unknown) => PromiseHandle)(p, data);

beforeEach(() => {
  resetToastState();
  installRafStub();
});

afterEach(() => {
  restoreRafStub();
  resetToastState();
});

// =========================================================================================
// §2.9 step 0-2: guard, loading toast, promise normalisation
// =========================================================================================
describe('promise() setup (§2.9 steps 0-2)', () => {
  it('step 0: returns undefined and creates nothing when `data` is omitted entirely', async () => {
    const handle = promiseOf(Promise.resolve('v'));
    expect(handle).toBeUndefined();
    expect(history()).toHaveLength(0);
    await Promise.resolve();
    expect(history()).toHaveLength(0);
  });

  it('step 0: `data = {}` passes the guard (the check is on `data` itself, not its fields)', async () => {
    const handle = promiseOf(Promise.resolve('v'), {});
    expect(typeof handle).toBe('object');
    expect(typeof handle.unwrap).toBe('function');
    await settle(handle);
    // No loading, no success, no error configured -> not a single toast is ever created.
    expect(history()).toHaveLength(0);
  });

  it('step 1: creates a `type: "loading"` toast whose title is `data.loading`', async () => {
    const handle = promiseOf(Promise.resolve('v'), { loading: 'Loading...' });

    const loadingToast = only();
    expect(loadingToast.type).toBe('loading');
    expect(loadingToast.title).toBe('Loading...');
    expect(loadingToast.dismissible).toBe(true);
    await settle(handle);
    flushRaf();
  });

  it('step 1: the loading toast carries the original promise on `.promise`', async () => {
    const p = Promise.resolve('v');
    const handle = promiseOf(p, { loading: 'L' });
    expect(only().promise).toBe(p);
    await settle(handle);
    flushRaf();
  });

  it('step 1: a promise FACTORY is stored verbatim on `.promise` and invoked exactly once, synchronously', async () => {
    const factory = vi.fn(() => Promise.resolve('v'));
    const handle = promiseOf(factory, { loading: 'L' });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(only().promise).toBe(factory);
    await settle(handle);
    expect(factory).toHaveBeenCalledTimes(1);
    flushRaf();
  });

  it('step 1: a non-function `description` is passed through to the loading toast verbatim', async () => {
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L', description: 'static description' });
    expect(only().description).toBe('static description');
    await settle(handle);
    flushRaf();
  });

  it('step 1: a FUNCTION `description` leaves the loading toast`s description undefined', async () => {
    const description = vi.fn(() => 'computed');
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L', description });

    expect(only().description).toBeUndefined();
    expect(description).not.toHaveBeenCalled();
    await settle(handle);
    flushRaf();
  });

  it('step 1: the whole `data` object is spread in, so `success`/`error`/`finally`/`loading` land on the ToastT as inert extras', async () => {
    const successValue = 'S';
    const errorValue = 'E';
    const finallyFn = () => {};
    const handle = promiseOf(Promise.resolve('v'), {
      loading: 'L',
      success: successValue,
      error: errorValue,
      finally: finallyFn,
    });

    const loadingToast = only() as ToastT & Record<string, unknown>;
    expect(loadingToast.loading).toBe('L');
    expect(loadingToast.success).toBe(successValue);
    expect(loadingToast.error).toBe(errorValue);
    expect(loadingToast.finally).toBe(finallyFn);
    await settle(handle);
    flushRaf();
  });

  it('step 1: no loading toast is created when `data.loading` is undefined', async () => {
    const handle = promiseOf(Promise.resolve('v'), { success: 'Done' });
    expect(history()).toHaveLength(0);
    await settle(handle);
    expect(history()).toHaveLength(1);
    expect(only().type).toBe('success');
  });

  it('step 1: honours an explicit `id` for the loading toast', async () => {
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L', id: 'pid' });
    expect(only().id).toBe('pid');
    await settle(handle);
    flushRaf();
  });
});

// =========================================================================================
// §2.9 step 8: the boxed return value + AC-S3
// =========================================================================================
describe('promise() return value (§2.9 step 8 / AC-S3)', () => {
  it('returns a PLAIN `{unwrap}` object (no boxing) when no loading toast was created', async () => {
    const handle = promiseOf(Promise.resolve('v'), { success: 'Done' });

    expect(typeof handle).toBe('object');
    expect(handle instanceof Number).toBe(false);
    expect(handle instanceof String).toBe(false);
    expect(Object.keys(handle)).toEqual(['unwrap']);
    await settle(handle);
  });

  it('QUIRK §2.9 step 8: with a loading toast it returns a BOXED Number (typeof "object", not "number")', async () => {
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L' });
    const rawId = only().id as number;

    expect(typeof handle).toBe('object');
    expect(handle instanceof Number).toBe(true);
    expect(Object.prototype.toString.call(handle)).toBe('[object Number]');
    expect((handle as unknown as Number).valueOf()).toBe(rawId);
    expect(Number(handle)).toBe(rawId);
    expect(String(handle)).toBe(String(rawId));
    expect(`${handle as unknown as string}`).toBe(`${rawId}`);
    // eslint-disable-next-line eqeqeq
    expect((handle as unknown as number) == rawId).toBe(true);
    expect((handle as unknown as number) === rawId).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(handle, 'unwrap')).toBe(true);
    expect(typeof handle.unwrap).toBe('function');

    await settle(handle);
    flushRaf();
  });

  it('QUIRK §2.9 step 8: a string id boxes into a String wrapper', async () => {
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L', id: 'sid' });

    expect(typeof handle).toBe('object');
    expect(handle instanceof String).toBe(true);
    expect(String(handle)).toBe('sid');
    expect((handle as unknown as string) === 'sid').toBe(false);

    await settle(handle);
    flushRaf();
  });

  it('AC-S3: the boxed id is NOT a valid `create()` id — feeding it back mints a fresh toast', async () => {
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L' });
    const rawId = only().id as number;

    const reusedId = toast.success('reuse attempt', { id: handle as unknown as number });

    // `typeof boxed === 'object'` matches neither the 'number' nor the 'string' branch.
    expect(typeof reusedId).toBe('number');
    expect(reusedId).not.toBe(rawId);
    expect(history()).toHaveLength(2);

    await settle(handle);
    flushRaf();
  });

  it('AC-S3: `dismiss(boxedId)` stores the WRAPPER, so `dismissedToasts.has(rawId)` stays false and getToasts() still lists it', async () => {
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L', success: 'Done' });
    const rawId = only().id as number;
    await settle(handle);

    toast.dismiss(handle as unknown as number);

    expect(ToastState.dismissedToasts.size).toBe(1);
    expect(ToastState.dismissedToasts.has(rawId)).toBe(false);
    expect(toast.getToasts()).toHaveLength(1);
    flushRaf();
  });

  it('`unwrap` builds a FRESH promise on every call', async () => {
    const handle = promiseOf(Promise.resolve('v'), {});
    const a = handle.unwrap();
    const b = handle.unwrap();
    expect(a).not.toBe(b);
    await Promise.all([a, b]);
  });
});

// =========================================================================================
// §2.9 step 4 branch 4 — the normal success path
// =========================================================================================
describe('promise() success branch (§2.9 step 4, branch 4)', () => {
  it('`success` as a string replaces the loading toast IN PLACE (same id, same array length)', async () => {
    const handle = promiseOf(Promise.resolve('value'), { loading: 'L', success: 'Done' });
    const id = only().id;

    await settle(handle);

    const updated = only();
    expect(updated.id).toBe(id);
    expect(updated.type).toBe('success');
    expect(updated.title).toBe('Done');
  });

  it('`success` as a function is called exactly once with the resolved value and its result is awaited', async () => {
    const success = vi.fn(async (value: string) => `Got ${value}`);
    const handle = promiseOf(Promise.resolve('payload'), { loading: 'L', success });

    await settle(handle);

    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('payload');
    expect(only().title).toBe('Got payload');
    expect(only().type).toBe('success');
  });

  it('`success` as a PromiseIExtendedResult object spreads every field onto the toast', async () => {
    const handle = promiseOf(Promise.resolve('v'), {
      loading: 'L',
      success: { message: 'Extended', description: 'from result', duration: 9000, className: 'x' },
    });

    await settle(handle);

    const updated = only();
    expect(updated.title).toBe('Extended');
    expect(updated.description).toBe('from result');
    expect(updated.duration).toBe(9000);
    expect(updated.className).toBe('x');
    expect(updated.type).toBe('success');
  });

  it('the extended result`s own `description` OVERRIDES the promise-level one (spread order, §2.9 sub-flow step 5)', async () => {
    const handle = promiseOf(Promise.resolve('v'), {
      loading: 'L',
      description: 'promise-level',
      success: { message: 'M', description: 'outcome-level' },
    });

    await settle(handle);

    expect(only().description).toBe('outcome-level');
  });

  it('a promise-level `description` function is called with the resolved value and carries over to the success toast', async () => {
    const description = vi.fn((value: string) => `desc for ${value}`);
    const handle = promiseOf(Promise.resolve('payload'), { loading: 'L', success: 'Done', description });

    await settle(handle);

    expect(description).toHaveBeenCalledTimes(1);
    expect(description).toHaveBeenCalledWith('payload');
    expect(only().description).toBe('desc for payload');
  });

  it('a non-function promise-level `description` carries over unchanged', async () => {
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L', success: 'Done', description: 'static' });
    await settle(handle);
    expect(only().description).toBe('static');
  });

  it('QUIRK §2.9 sub-flow step 3: a handler resolving to `null` is an "extended result" — spreading null yields NO message', async () => {
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L', success: null });

    await settle(handle);

    const updated = only();
    expect(updated.type).toBe('success');
    expect(updated.title).toBeUndefined();
  });

  it('without a loading toast the success outcome creates a BRAND-NEW toast with a fresh id', async () => {
    const handle = promiseOf(Promise.resolve('v'), { success: 'Done' });
    await settle(handle);

    const created = only();
    expect(typeof created.id).toBe('number');
    expect(created.type).toBe('success');
    expect(created.title).toBe('Done');
    expect(created.dismissible).toBe(true);
  });

  it('sets `shouldDismiss = false`, so the loading toast is never auto-dismissed', async () => {
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L', success: 'Done' });
    await settle(handle);

    expect(pendingFrames()).toBe(0);
    expect(ToastState.dismissedToasts.size).toBe(0);
  });
});

// =========================================================================================
// §2.9 step 4 branch 1 — VNode response
// =========================================================================================
describe('promise() VNode-response branch (§2.9 step 4, branch 1)', () => {
  it('renders the resolved VNode as a `type: "default"` toast and IGNORES data.success', async () => {
    const vnode = h('div', 'rendered');
    const success = vi.fn(() => 'never used');
    const handle = promiseOf(Promise.resolve(vnode), { loading: 'L', success });

    await settle(handle);

    const updated = only();
    expect(updated.type).toBe('default');
    expect(updated.title).toBe(vnode);
    expect(success).not.toHaveBeenCalled();
    expect(pendingFrames()).toBe(0);
  });

  it('creates a fresh default toast when there is no loading toast', async () => {
    const vnode = h('span', 'x');
    const handle = promiseOf(Promise.resolve(vnode), { success: 'ignored' });
    await settle(handle);

    expect(only().type).toBe('default');
    expect(only().title).toBe(vnode);
  });
});

// =========================================================================================
// §2.9 step 4 branch 2 — HTTP Response-shaped resolution
// =========================================================================================
describe('promise() HTTP-not-ok branch (§2.9 step 4, branch 2)', () => {
  const notOk = { ok: false, status: 404 };

  it('treats a duck-typed Response with `ok: false` as an ERROR even though the promise RESOLVED', async () => {
    const error = vi.fn((message: string) => message);
    const success = vi.fn(() => 'never');
    const handle = promiseOf(Promise.resolve(notOk), { loading: 'L', success, error });

    await settle(handle);

    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('HTTP error! status: 404');
    const updated = only();
    expect(updated.type).toBe('error');
    expect(updated.title).toBe('HTTP error! status: 404');
  });

  it('passes the same `HTTP error! status: N` string to a function `description`', async () => {
    const description = vi.fn((message: string) => `desc: ${message}`);
    const handle = promiseOf(Promise.resolve({ ok: false, status: 500 }), { loading: 'L', error: 'Failed', description });

    await settle(handle);

    expect(description).toHaveBeenCalledWith('HTTP error! status: 500');
    expect(only().description).toBe('desc: HTTP error! status: 500');
    expect(only().title).toBe('Failed');
  });

  it('QUIRK §2.9 step 4: creates an error toast even with NO `data.error` configured (title ends up undefined)', async () => {
    const handle = promiseOf(Promise.resolve(notOk), { loading: 'L' });

    await settle(handle);

    const updated = only();
    expect(updated.type).toBe('error');
    expect(updated.title).toBeUndefined();
    // shouldDismiss was cleared by the branch, so no auto-dismiss frame is queued.
    expect(pendingFrames()).toBe(0);
  });

  it('accepts an extended-result object from `error`', async () => {
    const handle = promiseOf(Promise.resolve(notOk), {
      loading: 'L',
      error: { message: 'Boom', description: 'server said no' },
    });

    await settle(handle);

    expect(only().title).toBe('Boom');
    expect(only().description).toBe('server said no');
  });

  it('a Response-shaped value with `ok: true` falls THROUGH to the success branch', async () => {
    const response = { ok: true, status: 200 };
    const success = vi.fn(() => 'All good');
    const handle = promiseOf(Promise.resolve(response), { loading: 'L', success });

    await settle(handle);

    expect(success).toHaveBeenCalledWith(response);
    expect(only().type).toBe('success');
    expect(only().title).toBe('All good');
  });

  it('a partially Response-shaped value (no numeric `status`) is NOT treated as a Response', async () => {
    const success = vi.fn(() => 'ok');
    const handle = promiseOf(Promise.resolve({ ok: false }), { loading: 'L', success });

    await settle(handle);

    expect(success).toHaveBeenCalledTimes(1);
    expect(only().type).toBe('success');
  });
});

// =========================================================================================
// §2.9 step 4 branch 3 — resolved Error instance
// =========================================================================================
describe('promise() resolved-Error branch (§2.9 step 4, branch 3)', () => {
  it('treats a RESOLVED Error instance as an error outcome and skips `data.success`', async () => {
    const err = new Error('boom');
    const error = vi.fn((e: Error) => `Caught ${e.message}`);
    const success = vi.fn(() => 'never');
    const handle = promiseOf(Promise.resolve(err), { loading: 'L', success, error });

    await settle(handle);

    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(err);
    expect(only().type).toBe('error');
    expect(only().title).toBe('Caught boom');
  });

  it('passes the Error instance itself to a function `description`', async () => {
    const err = new Error('boom');
    const description = vi.fn((e: Error) => `desc ${e.message}`);
    const handle = promiseOf(Promise.resolve(err), { loading: 'L', error: 'Failed', description });

    await settle(handle);

    expect(description).toHaveBeenCalledWith(err);
    expect(only().description).toBe('desc boom');
  });

  it('QUIRK §2.9 step 4: creates an error toast even with NO `data.error` configured', async () => {
    const handle = promiseOf(Promise.resolve(new Error('boom')), { loading: 'L' });

    await settle(handle);

    expect(only().type).toBe('error');
    expect(only().title).toBeUndefined();
    expect(pendingFrames()).toBe(0);
  });

  it('`unwrap()` still RESOLVES (not rejects) — the promise itself never rejected', async () => {
    const err = new Error('boom');
    const handle = promiseOf(Promise.resolve(err), { loading: 'L', error: 'Failed' });

    await expect(handle.unwrap()).resolves.toBe(err);
  });
});

// =========================================================================================
// §2.9 step 5 — the .catch() branch
// =========================================================================================
describe('promise() rejection branch (§2.9 step 5)', () => {
  it('`error` as a string replaces the loading toast with a `type: "error"` toast', async () => {
    const handle = promiseOf(Promise.reject(new Error('nope')), { loading: 'L', error: 'Failed' });
    const id = only().id;

    await settle(handle);

    const updated = only();
    expect(updated.id).toBe(id);
    expect(updated.type).toBe('error');
    expect(updated.title).toBe('Failed');
  });

  it('`error` as a function receives the rejection reason', async () => {
    const reason = new Error('nope');
    const error = vi.fn((e: Error) => `Failed: ${e.message}`);
    const handle = promiseOf(Promise.reject(reason), { loading: 'L', error });

    await settle(handle);

    expect(error).toHaveBeenCalledWith(reason);
    expect(only().title).toBe('Failed: nope');
  });

  it('a non-Error rejection reason is passed through verbatim', async () => {
    const error = vi.fn((e: unknown) => `Failed: ${String(e)}`);
    const handle = promiseOf(Promise.reject('plain string reason'), { loading: 'L', error });

    await settle(handle);

    expect(error).toHaveBeenCalledWith('plain string reason');
  });

  it('a function `description` receives the rejection reason too', async () => {
    const reason = new Error('nope');
    const description = vi.fn((e: Error) => `desc ${e.message}`);
    const handle = promiseOf(Promise.reject(reason), { loading: 'L', error: 'Failed', description });

    await settle(handle);

    expect(description).toHaveBeenCalledWith(reason);
    expect(only().description).toBe('desc nope');
  });

  it('an extended-result `error` object overrides the promise-level description', async () => {
    const handle = promiseOf(Promise.reject(new Error('nope')), {
      loading: 'L',
      description: 'promise-level',
      error: { message: 'M', description: 'outcome-level' },
    });

    await settle(handle);

    expect(only().title).toBe('M');
    expect(only().description).toBe('outcome-level');
  });

  it('QUIRK §2.9 step 5: with NO `data.error`, the rejection creates NO toast and silently dismisses the loading toast', async () => {
    const c = capture();
    const handle = promiseOf(Promise.reject(new Error('nope')), { loading: 'L' });
    const id = only().id;

    await settle(handle);

    // Only the original loading toast exists, still `type: 'loading'`.
    expect(history()).toHaveLength(1);
    expect(only().type).toBe('loading');
    // `shouldDismiss` stayed true -> `.finally` called `dismiss(id)`.
    expect(ToastState.dismissedToasts.has(id as number)).toBe(true);
    expect(pendingFrames()).toBe(1);
    flushRaf();
    expect(dismissEvents(c)).toEqual([{ id, dismiss: true }]);
    c.unsubscribe();
  });

  it('with NO `data.error` and NO loading toast, nothing happens at all', async () => {
    const c = capture();
    const handle = promiseOf(Promise.reject(new Error('nope')), {});

    await settle(handle);

    expect(history()).toHaveLength(0);
    expect(ToastState.dismissedToasts.size).toBe(0);
    expect(pendingFrames()).toBe(0);
    expect(c.events).toHaveLength(0);
    c.unsubscribe();
  });

  it('creates a fresh error toast when there was no loading toast', async () => {
    const handle = promiseOf(Promise.reject(new Error('nope')), { error: 'Failed' });
    await settle(handle);

    expect(only().type).toBe('error');
    expect(only().title).toBe('Failed');
    expect(typeof only().id).toBe('number');
  });
});

// =========================================================================================
// §2.9 step 4 branch 5 / step 6 — shouldDismiss + finally
// =========================================================================================
describe('promise() shouldDismiss + finally (§2.9 steps 4.5 and 6)', () => {
  it('QUIRK: a plain resolve with NO `data.success` matches no branch — the loading toast is auto-dismissed with no replacement', async () => {
    const c = capture();
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L' });
    const id = only().id;

    await settle(handle);

    expect(history()).toHaveLength(1);
    expect(only().type).toBe('loading'); // never replaced
    expect(ToastState.dismissedToasts.has(id as number)).toBe(true);
    expect(pendingFrames()).toBe(1);
    flushRaf();
    expect(dismissEvents(c)).toEqual([{ id, dismiss: true }]);
    c.unsubscribe();
  });

  it('a plain resolve with no loading toast and no handlers dismisses nothing', async () => {
    const handle = promiseOf(Promise.resolve('v'), {});
    await settle(handle);
    expect(pendingFrames()).toBe(0);
    expect(ToastState.dismissedToasts.size).toBe(0);
  });

  it('`data.finally` runs exactly once on the resolve path, AFTER the outcome toast has been published', async () => {
    const order: string[] = [];
    ToastState.subscribe((t) => order.push(`publish:${(t as ToastT).type ?? 'dismiss'}`));
    const finallyFn = vi.fn(() => {
      order.push('finally');
    });

    const handle = promiseOf(Promise.resolve('v'), { loading: 'L', success: 'Done', finally: finallyFn });
    await settle(handle);

    expect(finallyFn).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['publish:loading', 'publish:success', 'finally']);
  });

  it('`data.finally` runs exactly once on the reject path', async () => {
    const finallyFn = vi.fn();
    const handle = promiseOf(Promise.reject(new Error('nope')), { loading: 'L', error: 'Failed', finally: finallyFn });
    await settle(handle);
    expect(finallyFn).toHaveBeenCalledTimes(1);
  });

  it('`data.finally` runs even when no branch matched (the silent-dismiss case) — AFTER the dismiss', async () => {
    let dismissedInsideFinally: boolean | undefined;
    const handle = promiseOf(Promise.resolve('v'), {
      loading: 'L',
      finally: () => {
        dismissedInsideFinally = ToastState.dismissedToasts.size === 1;
      },
    });

    await settle(handle);

    expect(dismissedInsideFinally).toBe(true);
    flushRaf();
  });

  it('`data.finally` is optional — its absence is a no-op (`data.finally?.()`)', async () => {
    const handle = promiseOf(Promise.resolve('v'), { loading: 'L', success: 'Done' });
    await expect(settle(handle)).resolves.toBeUndefined();
  });
});

// =========================================================================================
// §2.9 step 7 — unwrap()
// =========================================================================================
describe('promise() unwrap() (§2.9 step 7)', () => {
  it('resolves with the ORIGINAL resolved value, even though a success toast replaced the loading one', async () => {
    const value = { data: 42 };
    const handle = promiseOf(Promise.resolve(value), { loading: 'L', success: 'Done' });

    await expect(handle.unwrap()).resolves.toBe(value);
  });

  it('rejects with the ORIGINAL rejection reason (the internal .catch never swallows it from unwrap)', async () => {
    const reason = new Error('nope');
    const handle = promiseOf(Promise.reject(reason), { loading: 'L', error: 'Failed' });

    await expect(handle.unwrap()).rejects.toBe(reason);
    flushRaf();
  });

  it('rejects with the original reason even when no `error` handler was configured', async () => {
    const reason = new Error('nope');
    const handle = promiseOf(Promise.reject(reason), { loading: 'L' });

    await expect(handle.unwrap()).rejects.toBe(reason);
    flushRaf();
  });

  it('works with no loading toast (the `{unwrap}` shape) — this is the e2e "promise rejection" path', async () => {
    const reason = new Error('nope');
    const handle = promiseOf(Promise.reject(reason), {});
    await expect(handle.unwrap()).rejects.toBe(reason);
  });

  it('unwraps a promise FACTORY`s resolution (§2.9 step 2 normalisation)', async () => {
    const handle = promiseOf(() => Promise.resolve('from factory'), { loading: 'L', success: 'Done' });
    await expect(handle.unwrap()).resolves.toBe('from factory');
  });

  it('unwraps a promise FACTORY`s rejection', async () => {
    const reason = new Error('factory blew up');
    const handle = promiseOf(() => Promise.reject(reason), { loading: 'L', error: 'Failed' });
    await expect(handle.unwrap()).rejects.toBe(reason);
    flushRaf();
  });

  it('is still callable AFTER the chain has settled and returns the same settlement', async () => {
    const handle = promiseOf(Promise.resolve('late'), { loading: 'L', success: 'Done' });
    await settle(handle);

    await expect(handle.unwrap()).resolves.toBe('late');
    await expect(handle.unwrap()).resolves.toBe('late');
  });

  it('waits for the full chain: the outcome toast already exists by the time unwrap() settles', async () => {
    const d = deferred<string>();
    const handle = promiseOf(d.promise, { loading: 'L', success: (v: string) => `Got ${v}` });

    expect(only().type).toBe('loading');
    d.resolve('payload');
    await handle.unwrap();

    expect(only().type).toBe('success');
    expect(only().title).toBe('Got payload');
  });
});
