/**
 * Shared harness for the sonner-vue Vitest unit suite.
 *
 * NOTE ON DETERMINISM: `ToastState` is a module singleton (state-api-spec.md §2.12) and the
 * module-level `toastsCounter` NEVER resets (§2.1) — not even between tests, since Vitest
 * shares one module registry per test file. Therefore:
 *   - every test file calls `resetToastState()` in `beforeEach` (resets the three public
 *     `Observer` fields in place — this is test-side surgery on the exported singleton, NOT an
 *     edit to `src/`);
 *   - no assertion may depend on an ABSOLUTE minted id value. Assert relative facts instead
 *     (`typeof id === 'number'`, `secondId === firstId + 1`, `id !== previousId`).
 */
import { vi } from 'vitest';
import { defineComponent, h, type VNode } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { ToastState } from '../../src/state';
import type { ToastT, ToastToDismiss } from '../../src/types';

export type Published = ToastT | ToastToDismiss;

/** Reset the three mutable `Observer` fields (state-api-spec.md §2.2) between tests. */
export function resetToastState(): void {
  ToastState.subscribers.length = 0;
  ToastState.toasts = [];
  ToastState.dismissedToasts.clear();
}

// ---------------------------------------------------------------------------------------
// requestAnimationFrame control (state-api-spec.md AC-S4: `Observer.dismiss(id)` calls bare
// `requestAnimationFrame`; the library must NOT contain a fallback, so the test harness owns
// the stub). jsdom does supply rAF, but a queue-and-flush stub makes the deferral itself
// observable — which is the actual parity requirement in §2.7.
// ---------------------------------------------------------------------------------------
let rafQueue: FrameRequestCallback[] = [];

export function installRafStub(): void {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
}

export function pendingFrames(): number {
  return rafQueue.length;
}

export function flushRaf(): void {
  const queued = rafQueue;
  rafQueue = [];
  for (const cb of queued) cb(0);
}

export function restoreRafStub(): void {
  rafQueue = [];
  vi.unstubAllGlobals();
}

// ---------------------------------------------------------------------------------------
// Subscriber capture
// ---------------------------------------------------------------------------------------

export interface Capture {
  /** Live references to the exact objects handed to subscribers. */
  events: Published[];
  /** Shallow snapshots taken at publish time (immune to any later mutation). */
  snapshots: Published[];
  unsubscribe: () => void;
}

/** Subscribe and record everything `Observer.publish` / `dismiss` fans out. */
export function capture(): Capture {
  const events: Published[] = [];
  const snapshots: Published[] = [];
  const unsubscribe = ToastState.subscribe((t) => {
    events.push(t);
    snapshots.push({ ...(t as object) } as Published);
  });
  return { events, snapshots, unsubscribe };
}

/** Only the toast-shaped (non-dismiss) publishes. */
export function toastEvents(c: Capture): ToastT[] {
  return c.events.filter((e) => !(e as ToastToDismiss).dismiss) as ToastT[];
}

/** Only the `{id, dismiss: true}` publishes. */
export function dismissEvents(c: Capture): ToastToDismiss[] {
  return c.events.filter((e) => (e as ToastToDismiss).dismiss === true) as ToastToDismiss[];
}

// ---------------------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------------------

/** Yield to the macrotask queue (the `setTimeout(fn)` deferral used by `useSonner`). */
export const nextMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A promise plus its externalised settlement functions. */
export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Wait until a `toast.promise()` handle's whole `.then/.catch/.finally` chain has run.
 * `unwrap()`'s promise settles only after `originalPromise` (the full chain, including
 * `.finally`) has settled — state-api-spec.md §2.9 step 7 — so awaiting it is the exact
 * synchronisation point for "all toast side-effects are done".
 */
export async function settle(handle: unknown): Promise<void> {
  if (!handle || typeof (handle as { unwrap?: unknown }).unwrap !== 'function') return;
  try {
    await (handle as { unwrap: () => Promise<unknown> }).unwrap();
  } catch {
    /* rejection paths are expected; the assertions live in the tests */
  }
}

// ---------------------------------------------------------------------------------------
// Vue harnesses
// ---------------------------------------------------------------------------------------

/** Mount a throwaway component whose `setup()` runs `fn`, exposing whatever `fn` returns. */
export function mountSetup<T>(fn: () => T): { result: T; wrapper: VueWrapper } {
  let result!: T;
  const wrapper = mount(
    defineComponent({
      setup() {
        result = fn();
        return () => h('div');
      },
    }),
  );
  return { result, wrapper };
}

/** Mount a throwaway component whose render function is `factory`. */
export function renderVNode(factory: () => VNode | VNode[]): VueWrapper {
  return mount(defineComponent({ render: () => factory() }));
}
