<script setup lang="ts">
// Port of sonner-react's `Toaster` component (index.tsx). See ARCHITECTURE.md and
// component-spec.md §8 for the full spec this file implements. D1: no <Teleport> — this
// component renders in place, exactly where the consumer mounts it. D3: consumers reach the
// root <section> via a template ref's `.$el` — no wrapper/forwardRef emulation is provided.
import { computed, onMounted, onUnmounted, ref, watch, type CSSProperties } from 'vue';
import Toast from './Toast.vue';
import { ToastState } from './state';
import type { HeightT, Position, ToasterProps, ToastT, ToastToDismiss } from './types';

// Module-level constants — byte-identical per ARCHITECTURE.md / component-spec.md §1.
const VISIBLE_TOASTS_AMOUNT = 3;
const VIEWPORT_OFFSET = '24px';
const MOBILE_VIEWPORT_OFFSET = '16px';
const TOAST_WIDTH = 356;
const GAP = 14;

// `invert`/`richColors` get an EXPLICIT `undefined` default — not merely "no entry" — per
// component-spec.md's Orchestrator corrections §OC-3. Vue's Boolean-prop runtime casting
// resolves an ABSENT optional boolean prop to `false` unless the prop already has an own
// `default` key in its resolved options (even one whose value is `undefined`); with no entry
// here at all, an unset `<Toaster invert>`/`<Toaster richColors>` would silently become `false`
// instead of `undefined`, which then propagates into `Toast` and renders `data-invert="false"`/
// `data-rich-colors="false"` where React (no such casting) renders neither attribute at all.
// Giving these two an explicit `undefined` default suppresses the cast and lets `props.invert`/
// `props.richColors` genuinely be `undefined` when the consumer never sets them, matching
// upstream's own un-defaulted `invert,`/`richColors,` destructuring in `index.tsx`.
const props = withDefaults(defineProps<ToasterProps>(), {
  theme: 'light',
  position: 'bottom-right',
  hotkey: () => ['altKey', 'KeyT'],
  gap: GAP,
  visibleToasts: VISIBLE_TOASTS_AMOUNT,
  containerAriaLabel: 'Notifications',
  invert: undefined,
  richColors: undefined,
});

// --- §2 helper functions -----------------------------------------------------------------

// §2.3 getDocumentDirection — SSR-safe, never returns the literal 'auto'.
function getDocumentDirection(): ToasterProps['dir'] {
  if (typeof window === 'undefined') return 'ltr';
  if (typeof document === 'undefined') return 'ltr';
  const dirAttribute = document.documentElement.getAttribute('dir');
  if (dirAttribute === 'auto' || !dirAttribute) {
    return window.getComputedStyle(document.documentElement).direction as ToasterProps['dir'];
  }
  return dirAttribute as ToasterProps['dir'];
}

// §2.4 assignOffset — always returns all 8 keys; the `offset: null` crash (typeof null ===
// 'object') is preserved verbatim, do not add a null guard (see component-spec.md §2.4).
function assignOffset(
  defaultOffset: ToasterProps['offset'],
  mobileOffset: ToasterProps['mobileOffset'],
): CSSProperties {
  const styles: Record<string, string> = {};
  ([defaultOffset, mobileOffset] as const).forEach((offset, index) => {
    const isMobile = index === 1;
    const prefix = isMobile ? '--mobile-offset' : '--offset';
    const defaultValue = isMobile ? MOBILE_VIEWPORT_OFFSET : VIEWPORT_OFFSET;

    function assignAll(value: string | number) {
      (['top', 'right', 'bottom', 'left'] as const).forEach((key) => {
        styles[`${prefix}-${key}`] = typeof value === 'number' ? `${value}px` : value;
      });
    }

    if (typeof offset === 'number' || typeof offset === 'string') {
      assignAll(offset);
    } else if (typeof offset === 'object') {
      (['top', 'right', 'bottom', 'left'] as const).forEach((key) => {
        // Intentionally unguarded against `offset === null` — see boxed note above.
        const value = (offset as Record<string, string | number | undefined>)[key];
        if (value === undefined) {
          styles[`${prefix}-${key}`] = defaultValue;
        } else {
          styles[`${prefix}-${key}`] = typeof value === 'number' ? `${value}px` : value;
        }
      });
    } else {
      assignAll(defaultValue);
    }
  });
  return styles as CSSProperties;
}

function splitPosition(position: Position): [string, string] {
  const [y, x] = position.split('-');
  return [y ?? '', x ?? ''];
}

// --- §8.2 state ----------------------------------------------------------------------------

const toasts = ref<ToastT[]>([]);
const heights = ref<HeightT[]>([]);
const expanded = ref(false);
const interacting = ref(false);

function computeActualTheme(theme: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  if (typeof window !== 'undefined') {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}
const actualTheme = ref<'light' | 'dark'>(computeActualTheme(props.theme));

// --- §8.3 refs -------------------------------------------------------------------------------

// Shared across every rendered <ol> (one per position group) — deliberately reassigned on each
// v-for iteration so only the LAST rendered position group's DOM node ends up stored, mirroring
// React's overwrite-by-last-render `ref={listRef}` quirk. See component-spec.md §8.3 / AC-2.
const listRef = ref<HTMLOListElement | null>(null);
function setListRef(el: Element | { $el?: unknown } | null) {
  listRef.value = (el as HTMLOListElement | null) ?? null;
}

const lastFocusedElementRef = ref<HTMLElement | null>(null);
const isFocusWithinRef = ref(false);

// --- setHeights — the RAW, unfiltered setter handed down to every <Toast> (state-api-spec.md
// §1.4 / component-spec.md §5.5.3's boxed warning: writes always target the FULL array). -------

function setHeights(updater: HeightT[] | ((prev: HeightT[]) => HeightT[])) {
  heights.value = typeof updater === 'function' ? updater(heights.value) : updater;
}

// --- §8.4.1 removeToast ---------------------------------------------------------------------

function removeToast(toastToRemove: ToastT) {
  if (!toasts.value.find((t) => t.id === toastToRemove.id)?.delete) {
    ToastState.dismiss(toastToRemove.id);
  }
  toasts.value = toasts.value.filter(({ id }) => id !== toastToRemove.id);
}

// --- §8.4.2 main ToastState.subscribe effect — D4: subscribe-once, not the vestigial
// [toasts]-dependent resubscribe React performs (see ARCHITECTURE.md D4 / component-spec.md
// §8.4.2's own recommendation). -----------------------------------------------------------

let unsubscribeToastState: (() => void) | undefined;
onMounted(() => {
  unsubscribeToastState = ToastState.subscribe((toast) => {
    if ((toast as ToastToDismiss).dismiss) {
      // Marks `delete: true` (stays in the array) rather than removing — Toast's own §5.5.7
      // effect observes this flip and runs the exit-animation sequence.
      requestAnimationFrame(() => {
        toasts.value = toasts.value.map((t) => (t.id === toast.id ? { ...t, delete: true } : t));
      });
      return;
    }
    // Deferred one macrotask out. No flushSync-equivalent is needed in Vue — see
    // component-spec.md §8.4.2's full reasoning (each callback already defers via its own
    // setTimeout, and Vue's microtask-flush model settles before the next macrotask runs).
    setTimeout(() => {
      const idx = toasts.value.findIndex((t) => t.id === toast.id);
      if (idx !== -1) {
        toasts.value = [
          ...toasts.value.slice(0, idx),
          { ...toasts.value[idx], ...toast },
          ...toasts.value.slice(idx + 1),
        ];
      } else {
        toasts.value = [toast as ToastT, ...toasts.value];
      }
    });
  });
});
onUnmounted(() => unsubscribeToastState?.());

// --- §8.4.3 theme effect — deliberately NO cleanup (matches sonner v2.0.7's own
// never-removed matchMedia listener; do not "fix" by adding removeEventListener). ------------

watch(
  () => props.theme,
  (theme) => {
    if (theme !== 'system') {
      actualTheme.value = theme;
      return;
    }
    if (theme === 'system') {
      if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        actualTheme.value = 'dark';
      } else {
        actualTheme.value = 'light';
      }
    }
    if (typeof window === 'undefined') return;
    const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    try {
      darkMediaQuery.addEventListener('change', ({ matches }) => {
        actualTheme.value = matches ? 'dark' : 'light';
      });
    } catch (error) {
      // Legacy Safari < 14 fallback — dead code in evergreen browsers, kept for fidelity.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (darkMediaQuery as any).addListener(({ matches }: { matches: boolean }) => {
        try {
          actualTheme.value = matches ? 'dark' : 'light';
        } catch (e) {
          console.error(e);
        }
      });
    }
  },
  { immediate: true },
);

// --- §8.4.4 auto-collapse effect — must fire ONLY on `toasts` change (AC-T4), never on an
// `expanded`-driven interval, or test 12's pause-on-hover would immediately un-pause. --------

watch(
  toasts,
  (t) => {
    if (t.length <= 1) expanded.value = false;
  },
  { immediate: true },
);

// --- §8.4.5 global keydown effect (hotkey + Escape) ------------------------------------------

watch(
  () => props.hotkey,
  (hotkey, _prev, onCleanup) => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isHotkeyPressed = hotkey.length > 0 && hotkey.every((key) => (event as unknown as Record<string, unknown>)[key] || event.code === key);
      if (isHotkeyPressed) {
        expanded.value = true;
        listRef.value?.focus();
      }
      if (event.code === 'Escape' && (document.activeElement === listRef.value || listRef.value?.contains(document.activeElement))) {
        expanded.value = false;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  },
  { immediate: true },
);

// --- §8.4.6 / AC-2 (CRITICAL, Playwright test 20) unmount focus-restore effect --------------
// listRef's <ol> unmounts whenever `filteredToasts` becomes empty (§8.7's render guard), while
// Toaster itself stays mounted — this watch's cleanup (fired on the next `null` transition, or
// on scope disposal) is what restores focus. A plain `onUnmounted` does NOT cover this and
// silently breaks Playwright test 20 — see component-spec.md AC-2. Do not replace this with
// onUnmounted, and do not add a second onUnmounted doing the same thing (double-fire).
watch(
  listRef,
  (el, _prevEl, onCleanup) => {
    if (el) {
      onCleanup(() => {
        if (lastFocusedElementRef.value) {
          lastFocusedElementRef.value.focus({ preventScroll: true });
          lastFocusedElementRef.value = null;
          isFocusWithinRef.value = false;
        }
      });
    }
  },
  { flush: 'post' },
);

// --- §8.5 focus / mouse / pointer handlers on each <ol> --------------------------------------
// AC-1 (CRITICAL, Playwright test 20): these bind to @focusin/@focusout in the template, NOT
// @focus/@blur — native focus/blur do not bubble, but React's onFocus/onBlur are implemented on
// top of the bubbling focusin/focusout, so a handler on the <ol> must observe descendant
// (button) focus too.

function onOlFocusIn(event: FocusEvent) {
  const isNotDismissible = event.target instanceof HTMLElement && event.target.dataset.dismissible === 'false';
  if (isNotDismissible) return;
  if (!isFocusWithinRef.value) {
    isFocusWithinRef.value = true;
    lastFocusedElementRef.value = event.relatedTarget as HTMLElement | null;
  }
}

function onOlFocusOut(event: FocusEvent) {
  if (isFocusWithinRef.value && !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
    isFocusWithinRef.value = false;
    if (lastFocusedElementRef.value) {
      lastFocusedElementRef.value.focus({ preventScroll: true });
      lastFocusedElementRef.value = null;
    }
  }
}

function onOlMouseEnter() {
  expanded.value = true;
}
function onOlMouseMove() {
  expanded.value = true;
}
function onOlMouseLeave() {
  if (!interacting.value) expanded.value = false;
}
function onOlDragEnd() {
  expanded.value = false;
}
function onOlPointerDown(event: PointerEvent) {
  const isNotDismissible = event.target instanceof HTMLElement && event.target.dataset.dismissible === 'false';
  if (isNotDismissible) return;
  interacting.value = true;
}
function onOlPointerUp() {
  interacting.value = false;
}

// --- §8.6 dir resolution — a plain function (not a computed()) so it re-evaluates on every
// render, matching React's every-render default-parameter re-evaluation (a computed() here
// would only re-run when props.dir itself changes, under-tracking document.dir flips that
// happen alongside unrelated re-renders — see deviations in the structured output). ----------

function resolvedDir(): ToasterProps['dir'] {
  return props.dir === 'auto' ? getDocumentDirection() : (props.dir ?? getDocumentDirection());
}

// --- §8.7 possiblePositions / filteredToasts --------------------------------------------------

// `id` scopes which toasts this Toaster renders — exact upstream branching semantics
// (sonner src/index.tsx lines 617-622, see component-spec.md OC-1): a Toaster WITH an id
// renders ONLY toasts whose toasterId matches it; a Toaster WITHOUT an id renders ONLY
// untagged toasts. Do NOT collapse this back into a single `!t.toasterId || t.toasterId ===
// props.id` filter — that would make an id-less Toaster also render OTHER Toasters' scoped
// toasts, which upstream never does.
const filteredToasts = computed(() => {
  if (props.id) {
    return toasts.value.filter((toast) => toast.toasterId === props.id);
  }
  return toasts.value.filter((toast) => !toast.toasterId);
});

const possiblePositions = computed<Position[]>(() => {
  const fromToasts = filteredToasts.value.filter((t) => t.position).map((t) => t.position as Position);
  return Array.from(new Set<Position>([props.position, ...fromToasts]));
});

function toastsForGroup(position: Position, groupIndex: number): ToastT[] {
  return filteredToasts.value.filter((t) => (!t.position && groupIndex === 0) || t.position === position);
}

// --- §8.7 <ol> inline style — --front-toast-height is deliberately cross-position-coupled
// (reads heights[0] from the FULL unfiltered array, identical across every simultaneously
// rendered <ol>) — preserve, do not scope per-position. Spread order: the three base vars, then
// the consumer's `style` prop, then assignOffset()'s output LAST so it always wins (§2.4 / D11).

const olStyle = computed<CSSProperties>(() => ({
  '--front-toast-height': `${heights.value[0]?.height || 0}px`,
  '--width': `${TOAST_WIDTH}px`,
  '--gap': `${props.gap}px`,
  ...(props.style ?? {}),
  ...assignOffset(props.offset, props.mobileOffset),
}));

// --- aria-label ------------------------------------------------------------------------------

const hotkeyLabel = computed(() => props.hotkey.join('+').replace(/Key/g, '').replace(/Digit/g, ''));
const ariaLabel = computed(() => props.customAriaLabel ?? `${props.containerAriaLabel} ${hotkeyLabel.value}`);
</script>

<template>
  <section
    :aria-label="ariaLabel"
    tabindex="-1"
    aria-live="polite"
    aria-relevant="additions text"
    aria-atomic="false"
    data-react-aria-top-layer="true"
  >
    <template v-if="filteredToasts.length > 0">
      <ol
        v-for="(position, index) in possiblePositions"
        :key="position"
        :ref="setListRef"
        :dir="resolvedDir()"
        tabindex="-1"
        :class="props.className"
        data-sonner-toaster="true"
        :data-sonner-theme="actualTheme"
        :data-y-position="splitPosition(position)[0]"
        :data-x-position="splitPosition(position)[1]"
        :style="olStyle"
        @focusin="onOlFocusIn"
        @focusout="onOlFocusOut"
        @mouseenter="onOlMouseEnter"
        @mousemove="onOlMouseMove"
        @mouseleave="onOlMouseLeave"
        @dragend="onOlDragEnd"
        @pointerdown="onOlPointerDown"
        @pointerup="onOlPointerUp"
      >
        <!-- OC-3 boolean-forwarding sweep verdicts (component-spec.md Orchestrator corrections):
             - `:invert` is a RAW forward, no `?? false`. `props.invert` is `undefined` when the
               consumer never sets it (see the explicit `undefined` default above), and must stay
               `undefined` all the way into Toast's `data-invert` binding to match React's
               `invert={invert}` (undefined -> attribute omitted). Do NOT reintroduce a `??`/`||`
               default on this binding.
             - `:closeButton`'s trailing `?? false` is intentionally KEPT: ToastProps.closeButton
               is a required `boolean` (matching upstream's own required declaration), and Toast.vue
               only ever consumes it through `Boolean(closeButton.value)`, never a raw data-*
               binding — `false` vs `undefined` is unobservable in the rendered DOM here.
             - `:expandByDefault`'s trailing `?? false` is likewise kept for the same reason:
               ToastProps.expandByDefault is required `boolean`, and Toast.vue only reads it
               through `Boolean(... && mounted.value)` (data-expanded) or a ternary
               (`--initial-height`), never a raw attribute binding. -->
        <Toast
          v-for="(toast, toastIndex) in toastsForGroup(position, index)"
          :key="toast.id"
          :icons="props.icons"
          :index="toastIndex"
          :toast="toast"
          :defaultRichColors="props.richColors"
          :duration="props.toastOptions?.duration ?? props.duration"
          :className="props.toastOptions?.className"
          :descriptionClassName="props.toastOptions?.descriptionClassName"
          :invert="props.invert"
          :visibleToasts="props.visibleToasts"
          :closeButton="props.toastOptions?.closeButton ?? props.closeButton ?? false"
          :interacting="interacting"
          :position="position"
          :style="props.toastOptions?.style"
          :unstyled="props.toastOptions?.unstyled"
          :classNames="props.toastOptions?.classNames"
          :cancelButtonStyle="props.toastOptions?.cancelButtonStyle"
          :actionButtonStyle="props.toastOptions?.actionButtonStyle"
          :closeButtonAriaLabel="props.toastOptions?.closeButtonAriaLabel"
          :removeToast="removeToast"
          :toasts="filteredToasts.filter((t) => t.position == toast.position)"
          :heights="heights.filter((h) => h.position == toast.position)"
          :setHeights="setHeights"
          :expandByDefault="props.expand ?? false"
          :gap="props.gap"
          :expanded="expanded"
          :swipeDirections="props.swipeDirections"
        />
      </ol>
    </template>
  </section>
</template>
