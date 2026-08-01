import { onMounted, onUnmounted, ref, type Ref } from 'vue';
import { ToastState } from './state';
import type { ToastT, ToastToDismiss } from './types';

// Port of sonner-react's hooks.tsx `useIsDocumentHidden` (state-api-spec.md §3).
// Mapping rationale: `useState` -> `ref()` (initial value computed once at composable-call
// time, same timing as React's hook call). `useEffect(fn, [])` (mount-only, with cleanup) ->
// `onMounted` for the setup half + `onUnmounted` for the teardown half. Event name
// ('visibilitychange'), target (`document`, not `window`), and "re-read `document.hidden`,
// don't use the event payload" are all preserved exactly. No SSR guard — matches upstream
// (state-api-spec.md AC-S4): this hook is only ever reached from Toast, which never renders
// server-side.
export function useIsDocumentHidden(): Ref<boolean> {
  const isDocumentHidden = ref(document.hidden);

  const callback = () => {
    isDocumentHidden.value = document.hidden;
  };

  onMounted(() => {
    document.addEventListener('visibilitychange', callback);
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', callback);
  });

  return isDocumentHidden;
}

// `useSonner` is defined in React at index.tsx (not hooks.tsx), but component-spec.md §7
// relocates it into src/hooks.ts alongside `useIsDocumentHidden` (per ARCHITECTURE.md's file
// layout, which lists both composables under src/hooks.ts). It is a standalone composable a
// consumer can call directly (e.g. to build a fully custom toast renderer) — it does not feed
// Toaster/Toast, and Toaster does not call it; it is a completely independent subscriber to
// ToastState.
//
// Subscribes once (mount/unmount), unlike Toaster's own analogous subscribe effect. Vue
// mapping applies the same `setTimeout`-without-`flushSync` simplification argued in
// component-spec.md §8.4.2: Vue's per-macrotask microtask-flush model doesn't need an
// explicit flush-forcing API the way React 18's automatic batching does.
export function useSonner(): { toasts: Ref<ToastT[]> } {
  const activeToasts = ref<ToastT[]>([]);
  let unsubscribe: (() => void) | undefined;

  onMounted(() => {
    unsubscribe = ToastState.subscribe((toast) => {
      if ((toast as ToastToDismiss).dismiss) {
        // Dismiss branch: removes the matching toast from activeToasts entirely (.filter),
        // deferred one macrotask out (setTimeout). useSonner has no exit animation to run, so
        // it just drops the entry immediately once the macrotask fires.
        setTimeout(() => {
          activeToasts.value = activeToasts.value.filter((t) => t.id !== toast.id);
        });
        return;
      }
      // Add/update branch: existing toast (by id) gets {...old, ...new} merged in place
      // (array position preserved); new toast is prepended ([toast, ...toasts]).
      setTimeout(() => {
        const idx = activeToasts.value.findIndex((t) => t.id === toast.id);
        if (idx !== -1) {
          activeToasts.value = [
            ...activeToasts.value.slice(0, idx),
            { ...activeToasts.value[idx], ...toast },
            ...activeToasts.value.slice(idx + 1),
          ];
        } else {
          activeToasts.value = [toast as ToastT, ...activeToasts.value];
        }
      });
    });
  });

  onUnmounted(() => unsubscribe?.());

  // Returns { toasts: activeToasts } — an object wrapper, not the array directly (matches the
  // public API shape `const { toasts } = useSonner()`). Note: caller reads `.toasts.value`,
  // one extra layer of Ref-unwrapping vs React — an unavoidable, expected framework
  // difference, not a parity bug.
  return { toasts: activeToasts };
}
