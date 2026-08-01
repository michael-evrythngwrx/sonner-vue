import { ref, type Ref } from 'vue';
import type { ToastT } from './types';

// STUB — placeholder composables so the package compiles and links.
// Real port lands per ARCHITECTURE.md ("src/hooks.ts") and component-spec.md.

export function useIsDocumentHidden(): Ref<boolean> {
  return ref(false);
}

export function useSonner(): Ref<ToastT[]> {
  return ref([]);
}
