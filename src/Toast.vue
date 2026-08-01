<script setup lang="ts">
// Port of sonner-react's `Toast` component (index.tsx). See component-spec.md §5-§6 for the
// full spec this file implements, and state-api-spec.md for the collaborating `types.ts`/
// `state.ts`/`hooks.ts`/`assets.ts` contracts this file consumes.
import {
  cloneVNode,
  computed,
  h,
  isVNode,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type Component,
  type CSSProperties,
  type VNodeChild,
} from 'vue';
import { CloseIcon, getAsset, Loader } from './assets';
import { useIsDocumentHidden } from './hooks';
import { isAction } from './types';
import type { Action, HeightT, Position, Renderable, SwipeDirection, ToastProps, ToastTypes } from './types';

defineOptions({ name: 'Toast' });

// --- module-level constants — byte-identical per ARCHITECTURE.md / component-spec.md §1. ---
const TOAST_LIFETIME = 4000;
const GAP = 14;
const SWIPE_THRESHOLD = 45;
const TIME_BEFORE_UNMOUNT = 200;

const props = withDefaults(defineProps<ToastProps>(), {
  className: '',
  descriptionClassName: '',
  closeButtonAriaLabel: 'Close toast',
});

// --- §2.1 cn ----------------------------------------------------------------------------------
function cn(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(' ');
}

// --- §2.2 getDefaultSwipeDirections --------------------------------------------------------
function getDefaultSwipeDirections(position: string): SwipeDirection[] {
  const [y, x] = position.split('-');
  const directions: SwipeDirection[] = [];
  if (y) directions.push(y as SwipeDirection);
  if (x) directions.push(x as SwipeDirection);
  return directions;
}

// --- shared renderNode() helper (ARCHITECTURE.md line 43) -----------------------------------
// AC-7 / AC-S2: stored VNodes (toast.jsx, VNode-valued icon/action/cancel/ToastIcons.*) live in
// module-level state and can be re-rendered by more than one Toaster instance simultaneously
// (two untagged <Toaster/>s both render every toast with no toasterId). Vue VNodes carry mount
// state and cannot be mounted twice — clone unconditionally before handing back to the template.
function renderNode(value: Renderable | null | undefined): VNodeChild {
  if (value === null || value === undefined) return null;
  if (isVNode(value)) return cloneVNode(value);
  if (typeof value === 'string' || typeof value === 'number') return value;
  // Remaining case: a Vue Component reference (options object or functional component).
  return h(value as Component);
}

// Resolves the widened `Renderable | (() => Renderable)` shape by invoking the thunk once,
// immediately — never rendering the function reference itself.
function callThunk(value: Renderable | (() => Renderable) | null | undefined): Renderable | null | undefined {
  return typeof value === 'function' ? (value as () => Renderable)() : (value as Renderable | null | undefined);
}

function iconForType(
  icons: ToastProps['icons'],
  type: ToastTypes | undefined,
): Renderable | (() => Renderable) | null | undefined {
  if (!type) return undefined;
  if (type === 'success' || type === 'info' || type === 'warning' || type === 'error' || type === 'loading') {
    return icons?.[type];
  }
  return undefined;
}

function classNamesForType(
  classNames: ToastProps['classNames'],
  type: ToastTypes | undefined,
): string | undefined {
  if (!type) return undefined;
  if (
    type === 'success' ||
    type === 'error' ||
    type === 'info' ||
    type === 'warning' ||
    type === 'loading' ||
    type === 'default'
  ) {
    return classNames?.[type];
  }
  return undefined;
}

// --- §4 useIsDocumentHidden — single call at the top of the component, per state-api-spec.md
// §3.1/§3.2 and component-spec.md §4. ---------------------------------------------------------
const isDocumentHidden = useIsDocumentHidden();

// --- §5.2 local reactive state ----------------------------------------------------------------
const swipeDirection = ref<'x' | 'y' | null>(null);
const swipeOutDirection = ref<'left' | 'right' | 'up' | 'down' | null>(null);
const mounted = ref(false);
const removed = ref(false);
const swiping = ref(false);
const swipeOut = ref(false);
const isSwiped = ref(false);
const offsetBeforeRemove = ref(0);
const initialHeight = ref(0);

// --- §5.3 refs -----------------------------------------------------------------------------
const remainingTime = ref(props.toast.duration || props.duration || TOAST_LIFETIME);
const dragStartTime = ref<number | null>(null);
const toastRef = ref<HTMLLIElement | null>(null);
const closeTimerStartTimeRef = ref(0);
const lastCloseTimerStartTimeRef = ref(0);
const pointerStartRef = ref<{ x: number; y: number } | null>(null);

// --- §5.4 derived/computed values ------------------------------------------------------------
const isFront = computed(() => props.index === 0);
const isVisible = computed(() => props.index + 1 <= props.visibleToasts);
const toastType = computed(() => props.toast.type);
// NOT `!!toast.dismissible` — only an explicit `false` disables dismissal.
const dismissible = computed(() => props.toast.dismissible !== false);
const toastClassname = computed(() => props.toast.className || '');
const toastDescriptionClassname = computed(() => props.toast.descriptionClassName || '');

// Dead `|| 0` preserved for literal fidelity (component-spec.md §5.4): findIndex's `-1` is
// truthy, so this never actually changes the result. heightIndex CAN legitimately be `-1` for
// one render cycle before this toast's own mount effect (below) has registered its height.
const heightIndex = computed(() => {
  const idx = props.heights.findIndex((h) => h.toastId === props.toast.id);
  return idx || 0;
});

// `??` — an explicit per-toast `false` wins over a toaster-level `true`.
const closeButton = computed(() => props.toast.closeButton ?? props.closeButton);
// `||` — `toast.duration === 0` does NOT mean instant-dismiss; only `Infinity` is meaningful.
const duration = computed(() => props.toast.duration || props.duration || TOAST_LIFETIME);

const yPos = computed(() => props.position.split('-')[0] ?? '');
const xPos = computed(() => props.position.split('-')[1] ?? '');

const toastsHeightBefore = computed(() => {
  return props.heights.reduce((prev, curr, reducerIndex) => {
    if (reducerIndex >= heightIndex.value) return prev;
    return prev + curr.height;
  }, 0);
});

// `||`, NOT `??` — an explicit per-toast `invert={false}` cannot override a toaster-level
// `invert={true}` (component-spec.md §5.4 boxed note — not a typo, preserve exactly).
const invert = computed(() => props.toast.invert || props.invert);
const disabled = computed(() => toastType.value === 'loading');

const offset = computed(() => heightIndex.value * (props.gap ?? GAP) + toastsHeightBefore.value);

// --- §5.5.1 (AC-3: MUST be registered before the §5.5.6 timer watch below — Vue runs watchers
// in creation order, and an updated toast's new `duration` must resync `remainingTime` before
// the timer watch tears down/re-arms with it. Registration order is load-bearing here; breaking
// it silently reintroduces stale-timer bugs (Playwright test 25). Do not reorder.) -------------
watch(duration, (d) => {
  remainingTime.value = d;
});

// --- §5.5.2 + §5.5.3 fused (component-spec.md's own recommendation): mount-time height
// measurement and the double-rAF `data-mounted` flip land in the SAME deferred callback so they
// paint together, matching React's same-commit guarantee (both are passive effects flushed in
// the same post-paint pass in React). A plain single onMounted flip would run pre-paint in Vue
// and the entrance transition would silently never play — see component-spec.md §5.5.2. --------
onMounted(() => {
  const node = toastRef.value;
  if (node) {
    const height = node.getBoundingClientRect().height;
    initialHeight.value = height;
    // Updater-callback form — MUST target the full array (see boxed warning below and at the
    // setHeights call sites throughout this file). `props.heights` is already filtered to this
    // toast's position group by Toaster; writing against it directly would silently drop other
    // position groups' entries from the shared state.
    props.setHeights((h) => [
      { toastId: props.toast.id, height, position: props.toast.position as Position },
      ...h,
    ]);
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      mounted.value = true;
    });
  });
});

onUnmounted(() => {
  props.setHeights((h) => h.filter((height) => height.toastId !== props.toast.id));
});

// --- §5.5.4 layout-effect equivalent — keep height in sync with content changes. Vue's
// `flush: 'post'` runs after DOM patch but before paint, timing-equivalent to React's
// useLayoutEffect (no rAF trick needed here, contrast with §5.5.2 above). ----------------------
watch(
  [
    mounted,
    () => props.toast.title,
    () => props.toast.description,
    () => props.toast.jsx,
    () => props.toast.action,
    () => props.toast.cancel,
  ],
  () => {
    if (!mounted.value) return;
    const node = toastRef.value;
    if (!node) return;
    const originalHeight = node.style.height;
    node.style.height = 'auto';
    const newHeight = node.getBoundingClientRect().height;
    node.style.height = originalHeight;
    initialHeight.value = newHeight;

    // Read AND write against the updater-callback's own full-array parameter — never
    // `props.heights` (filtered) — mirroring React's `setHeights((heights) => ...)` where the
    // callback parameter shadows the outer (here: prop) `heights` with the FULL state array.
    props.setHeights((h) => {
      const existing = h.find((height) => height.toastId === props.toast.id);
      if (!existing) {
        return [{ toastId: props.toast.id, height: newHeight, position: props.toast.position as Position }, ...h];
      }
      return h.map((height) => (height.toastId === props.toast.id ? { ...height, height: newHeight } : height));
    });
  },
  { flush: 'post' },
);

// --- §5.5.5 deleteToast ------------------------------------------------------------------------
function deleteToast() {
  removed.value = true;
  offsetBeforeRemove.value = offset.value;
  props.setHeights((h) => h.filter((height) => height.toastId !== props.toast.id));
  setTimeout(() => {
    props.removeToast(props.toast);
  }, TIME_BEFORE_UNMOUNT);
}

// --- §5.5.6 auto-dismiss timer — pause/resume, duration precedence. Registered AFTER §5.5.1
// (AC-3, see comment above). ------------------------------------------------------------------
let timeoutId: ReturnType<typeof setTimeout> | undefined;
watch(
  [() => props.expanded, () => props.interacting, () => props.toast, isDocumentHidden],
  (_new, _old, onCleanup) => {
    // Literal three-part expression preserved for source fidelity (the 1st/3rd disjuncts are
    // the same boolean via the toastType alias — do not "clean up" into the reduced form).
    if (
      (props.toast.promise && toastType.value === 'loading') ||
      props.toast.duration === Infinity ||
      props.toast.type === 'loading'
    ) {
      return;
    }

    const pauseTimer = () => {
      if (lastCloseTimerStartTimeRef.value < closeTimerStartTimeRef.value) {
        const elapsedTime = Date.now() - closeTimerStartTimeRef.value;
        remainingTime.value = remainingTime.value - elapsedTime;
      }
      lastCloseTimerStartTimeRef.value = Date.now();
    };

    const startTimer = () => {
      if (remainingTime.value === Infinity) return;
      closeTimerStartTimeRef.value = Date.now();
      timeoutId = setTimeout(() => {
        props.toast.onAutoClose?.(props.toast);
        deleteToast();
      }, remainingTime.value);
    };

    if (props.expanded || props.interacting || isDocumentHidden.value) {
      pauseTimer();
    } else {
      startTimer();
    }

    onCleanup(() => clearTimeout(timeoutId));
  },
  { immediate: true },
);

// --- §5.5.7 react to toast.delete (programmatic dismiss) --------------------------------------
watch(
  () => props.toast.delete,
  (del) => {
    if (del) {
      deleteToast();
      props.toast.onDismiss?.(props.toast);
    }
  },
  { immediate: true },
);

// --- §5.8 event handlers on <li> --------------------------------------------------------------
function onDragEnd() {
  swiping.value = false;
  swipeDirection.value = null;
  pointerStartRef.value = null;
}

function onPointerDown(event: PointerEvent) {
  if (event.button === 2) return;
  if (disabled.value || !dismissible.value) return;
  dragStartTime.value = Date.now();
  offsetBeforeRemove.value = offset.value;
  (event.target as HTMLElement).setPointerCapture(event.pointerId);
  if ((event.target as HTMLElement).tagName === 'BUTTON') return;
  swiping.value = true;
  pointerStartRef.value = { x: event.clientX, y: event.clientY };
}

function onPointerMove(event: PointerEvent) {
  if (!pointerStartRef.value || !dismissible.value) return;
  const isHighlighted = (window.getSelection()?.toString().length ?? 0) > 0;
  if (isHighlighted) return;

  const yDelta = event.clientY - pointerStartRef.value.y;
  const xDelta = event.clientX - pointerStartRef.value.x;
  const swipeDirections = props.swipeDirections ?? getDefaultSwipeDirections(props.position);

  if (!swipeDirection.value && (Math.abs(xDelta) > 1 || Math.abs(yDelta) > 1)) {
    swipeDirection.value = Math.abs(xDelta) > Math.abs(yDelta) ? 'x' : 'y';
  }

  const swipeAmount = { x: 0, y: 0 };

  const getDampening = (delta: number) => {
    const factor = Math.abs(delta) / 20;
    return 1 / (1.5 + factor);
  };

  if (swipeDirection.value === 'y') {
    if (swipeDirections.includes('top') || swipeDirections.includes('bottom')) {
      if ((swipeDirections.includes('top') && yDelta < 0) || (swipeDirections.includes('bottom') && yDelta > 0)) {
        swipeAmount.y = yDelta;
      } else {
        const dampenedDelta = yDelta * getDampening(yDelta);
        swipeAmount.y = Math.abs(dampenedDelta) < Math.abs(yDelta) ? dampenedDelta : yDelta;
      }
    }
  } else if (swipeDirection.value === 'x') {
    if (swipeDirections.includes('left') || swipeDirections.includes('right')) {
      if ((swipeDirections.includes('left') && xDelta < 0) || (swipeDirections.includes('right') && xDelta > 0)) {
        swipeAmount.x = xDelta;
      } else {
        const dampenedDelta = xDelta * getDampening(xDelta);
        swipeAmount.x = Math.abs(dampenedDelta) < Math.abs(xDelta) ? dampenedDelta : xDelta;
      }
    }
  }

  if (Math.abs(swipeAmount.x) > 0 || Math.abs(swipeAmount.y) > 0) isSwiped.value = true;

  // Imperative, direct DOM writes — deliberately outside Vue's reactive :style binding for
  // 60fps drag performance (component-spec.md §5.8 / D11). Never route through a reactive ref.
  toastRef.value?.style.setProperty('--swipe-amount-x', `${swipeAmount.x}px`);
  toastRef.value?.style.setProperty('--swipe-amount-y', `${swipeAmount.y}px`);
}

function onPointerUp() {
  if (swipeOut.value || !dismissible.value) return;
  pointerStartRef.value = null;
  const swipeAmountX = Number(toastRef.value?.style.getPropertyValue('--swipe-amount-x').replace('px', '') || 0);
  const swipeAmountY = Number(toastRef.value?.style.getPropertyValue('--swipe-amount-y').replace('px', '') || 0);
  // AC-10: when dragStartTime is null (gesture started on a button), this intentionally
  // produces NaN — do not add a null-guard that would skip the CSS-var reset below.
  const timeTaken = Date.now() - (dragStartTime.value as number);
  const swipeAmount = swipeDirection.value === 'x' ? swipeAmountX : swipeAmountY;
  const velocity = Math.abs(swipeAmount) / timeTaken;

  // OR, not AND — either condition independently triggers dismissal.
  if (Math.abs(swipeAmount) >= SWIPE_THRESHOLD || velocity > 0.11) {
    offsetBeforeRemove.value = offset.value;
    props.toast.onDismiss?.(props.toast);
    if (swipeDirection.value === 'x') {
      swipeOutDirection.value = swipeAmountX > 0 ? 'right' : 'left';
    } else {
      swipeOutDirection.value = swipeAmountY > 0 ? 'down' : 'up';
    }
    deleteToast();
    swipeOut.value = true;
    return;
  } else {
    toastRef.value?.style.setProperty('--swipe-amount-x', '0px');
    toastRef.value?.style.setProperty('--swipe-amount-y', '0px');
  }
  isSwiped.value = false;
  swiping.value = false;
  swipeDirection.value = null;
}

// --- §5.9 icon resolution ------------------------------------------------------------------
// Selection happens on the RAW candidate (a thunk function reference is always truthy, so
// selection-by-truthiness is unaffected); only the WINNING candidate is invoked, once,
// immediately, before rendering — component-spec.md §5.9's boxed note. Do not resolve-then-
// select, that would change which candidate wins when a thunk resolves to a falsy value.
const iconCandidateRaw = computed<Renderable | (() => Renderable) | null | undefined>(() => {
  return (
    props.toast.icon ||
    iconForType(props.icons, toastType.value) ||
    getAsset(toastType.value as ToastTypes) ||
    undefined
  );
});
const icon = computed<Renderable | null | undefined>(() => callThunk(iconCandidateRaw.value));
const resolvedToastIcon = computed<Renderable | null | undefined>(() => callThunk(props.toast.icon));

const getLoadingIconNode = computed<VNodeChild>(() => {
  if (props.icons?.loading) {
    const resolved = callThunk(props.icons.loading);
    return h(
      'div',
      {
        class: cn(props.classNames?.loader, props.toast.classNames?.loader, 'sonner-loader'),
        'data-visible': String(toastType.value === 'loading'),
      },
      [renderNode(resolved)],
    );
  }
  // AC-6 / AC-S1 (CRITICAL): Loader is called as a plain function, never mounted via h(Loader,
  // {...}) or <Loader/> — mounting it as a component would merge `className`/`visible` onto
  // the root <div> as fallthrough attrs, overwriting `sonner-loading-wrapper` via
  // patchDOMProp('className', ...) and destroying every spinner style in styles.css.
  return Loader({
    visible: toastType.value === 'loading',
    className: cn(props.classNames?.loader, props.toast.classNames?.loader),
  });
});

// Container render condition — literal boolean expression, not simplified (component-spec.md
// §5.9): `(toastType || toast.icon || toast.promise) && toast.icon !== null &&
// (icons?.[toastType] !== null || toast.icon)`.
const showIconContainer = computed(() => {
  const cond1 = Boolean(toastType.value || props.toast.icon || props.toast.promise);
  const cond2 = props.toast.icon !== null;
  const cond3 = iconForType(props.icons, toastType.value) !== null || Boolean(props.toast.icon);
  return cond1 && cond2 && cond3;
});

const iconChild1 = computed<VNodeChild>(() => {
  if (props.toast.promise || (props.toast.type === 'loading' && !props.toast.icon)) {
    return props.toast.icon ? renderNode(resolvedToastIcon.value) : getLoadingIconNode.value;
  }
  return null;
});
const iconChild2 = computed<VNodeChild>(() => (props.toast.type !== 'loading' ? renderNode(icon.value) : null));

const IconChild1 = () => iconChild1.value;
const IconChild2 = () => iconChild2.value;

const iconContainerClass = computed(() => cn(props.classNames?.icon, props.toast.classNames?.icon));

// --- §5.10 content block -----------------------------------------------------------------------
const titleContent = computed<VNodeChild>(() => {
  if (props.toast.jsx) return renderNode(props.toast.jsx);
  const title = props.toast.title;
  const resolved = typeof title === 'function' ? (title as () => Renderable)() : title;
  return renderNode(resolved);
});
const descriptionContent = computed<VNodeChild>(() => {
  const description = props.toast.description;
  const resolved = typeof description === 'function' ? (description as () => Renderable)() : description;
  return renderNode(resolved);
});
const TitleContent = () => titleContent.value;
const DescriptionContent = () => descriptionContent.value;

const contentClass = computed(() => cn(props.classNames?.content, props.toast.classNames?.content));
const titleClass = computed(() => cn(props.classNames?.title, props.toast.classNames?.title));
const descriptionClass = computed(() =>
  cn(
    props.descriptionClassName,
    toastDescriptionClassname.value,
    props.classNames?.description,
    props.toast.classNames?.description,
  ),
);

// --- §6 cancel / action resolution — D2/AC-S5 strict upstream parity ---------------------------
// VNode -> passthrough render; Action object (isAction guard) -> button; Vue component / thunk
// () => Renderable (a Vue-necessity addition, since VNodes must not be created eagerly and
// reused) -> renderNode(); bare string/number -> renders NOTHING, matching upstream sonner's own
// gap (React.isValidElement is false for primitives, and isAction is false too) — this is NOT
// the three-way "always render via renderNode" resolution component-spec.md §6.3 sketched; per
// ARCHITECTURE.md D2 the orchestrator resolved the open question toward strict parity instead.
type ActionSlotResolution = { kind: 'none' } | { kind: 'action'; action: Action } | { kind: 'node'; node: Renderable };

function resolveActionSlot(value: Action | Renderable | (() => Renderable) | null | undefined): ActionSlotResolution {
  if (value === null || value === undefined) return { kind: 'none' };
  if (isVNode(value)) return { kind: 'node', node: value };
  if (isAction(value as Action | Renderable)) return { kind: 'action', action: value as Action };
  if (typeof value === 'function') return { kind: 'node', node: (value as () => Renderable)() };
  if (typeof value === 'object') return { kind: 'node', node: value as Component };
  return { kind: 'none' };
}

const cancelResolution = computed(() => resolveActionSlot(props.toast.cancel));
const actionResolution = computed(() => resolveActionSlot(props.toast.action));

const cancelNode = computed<VNodeChild>(() => {
  const r = cancelResolution.value;
  return r.kind === 'node' ? renderNode(r.node) : null;
});
const actionNode = computed<VNodeChild>(() => {
  const r = actionResolution.value;
  return r.kind === 'node' ? renderNode(r.node) : null;
});
const CancelNodeSlot = () => cancelNode.value;
const ActionNodeSlot = () => actionNode.value;

// Action.label stays plain Renderable — no thunk widening (D2).
const CancelLabelSlot = () =>
  cancelResolution.value.kind === 'action' ? renderNode(cancelResolution.value.action.label) : null;
const ActionLabelSlot = () =>
  actionResolution.value.kind === 'action' ? renderNode(actionResolution.value.action.label) : null;

// Style resolution reads toast.cancelButtonStyle / toast.actionButtonStyle (NOT the resolved
// Action object's own `actionButtonStyle` field, which this render path never consults) merged
// with the Toast-level fallback props (component-spec.md §6.4).
const cancelButtonStyleResolved = computed<CSSProperties | undefined>(
  () => props.toast.cancelButtonStyle || props.cancelButtonStyle,
);
const actionButtonStyleResolved = computed<CSSProperties | undefined>(
  () => props.toast.actionButtonStyle || props.actionButtonStyle,
);

const cancelButtonClass = computed(() => cn(props.classNames?.cancelButton, props.toast.classNames?.cancelButton));
const actionButtonClass = computed(() => cn(props.classNames?.actionButton, props.toast.classNames?.actionButton));

function onCancelClick(event: MouseEvent) {
  if (cancelResolution.value.kind !== 'action') return;
  if (!dismissible.value) return;
  cancelResolution.value.action.onClick?.(event);
  deleteToast();
}

function onActionClick(event: MouseEvent) {
  // The action button deliberately ignores `dismissible` entirely (component-spec.md §6.6) —
  // preserve, even though this is very likely unintentional upstream.
  if (actionResolution.value.kind !== 'action') return;
  actionResolution.value.action.onClick?.(event);
  if (event.defaultPrevented) return;
  deleteToast();
}

// --- §5.11 close button ------------------------------------------------------------------------
const showCloseButton = computed(() => Boolean(closeButton.value) && !props.toast.jsx && toastType.value !== 'loading');

const closeIconContent = computed<VNodeChild>(() => {
  // `??`, not `||` — an explicit `icons.close: null` still falls back to the built-in icon.
  const candidate = props.icons?.close ?? CloseIcon;
  const resolved = callThunk(candidate);
  return renderNode(resolved);
});
const CloseIconSlot = () => closeIconContent.value;

const closeButtonClass = computed(() => cn(props.classNames?.closeButton, props.toast.classNames?.closeButton));

function onCloseClick() {
  if (disabled.value || !dismissible.value) return;
  deleteToast();
  props.toast.onDismiss?.(props.toast);
}

// --- §5.7 <li> root: data-*, class, style ------------------------------------------------------
const richColorsAttr = computed(() => props.toast.richColors ?? props.defaultRichColors);
const dataStyled = computed(() => !(props.toast.jsx || props.toast.unstyled || props.unstyled));
const dataExpanded = computed(() => Boolean(props.expanded || (props.expandByDefault && mounted.value)));

const liClass = computed(() =>
  cn(
    props.className,
    toastClassname.value,
    props.classNames?.toast,
    props.toast.classNames?.toast,
    props.classNames?.default,
    classNamesForType(props.classNames, toastType.value),
    classNamesForType(props.toast.classNames, toastType.value),
  ),
);

// Spread order (D11 / component-spec.md §5.7): the five computed vars FIRST, then the
// toastOptions-level `style` prop, then `toast.style` LAST (highest precedence).
const liStyle = computed<CSSProperties>(() => {
  const base: Record<string, string | number> = {
    '--index': props.index,
    '--toasts-before': props.index,
    '--z-index': props.toasts.length - props.index,
    '--offset': `${removed.value ? offsetBeforeRemove.value : offset.value}px`,
    '--initial-height': props.expandByDefault ? 'auto' : `${initialHeight.value}px`,
  };
  return { ...base, ...(props.style ?? {}), ...(props.toast.style ?? {}) } as CSSProperties;
});
</script>

<template>
  <li
    tabindex="0"
    data-sonner-toast=""
    :data-rich-colors="richColorsAttr"
    :data-styled="dataStyled"
    :data-mounted="mounted"
    :data-promise="Boolean(props.toast.promise)"
    :data-swiped="isSwiped"
    :data-removed="removed"
    :data-visible="isVisible"
    :data-y-position="yPos"
    :data-x-position="xPos"
    :data-index="props.index"
    :data-front="isFront"
    :data-swiping="swiping"
    :data-dismissible="dismissible"
    :data-type="toastType"
    :data-invert="invert"
    :data-swipe-out="swipeOut"
    :data-swipe-direction="swipeOutDirection"
    :data-expanded="dataExpanded"
    :data-testid="props.toast.testId"
    :class="liClass"
    :style="liStyle"
    ref="toastRef"
    @dragend="onDragEnd"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointermove="onPointerMove"
  >
    <button
      v-if="showCloseButton"
      :aria-label="props.closeButtonAriaLabel"
      :data-disabled="disabled"
      data-close-button="true"
      :class="closeButtonClass"
      @click="onCloseClick"
    >
      <CloseIconSlot />
    </button>

    <div v-if="showIconContainer" data-icon="" :class="iconContainerClass">
      <IconChild1 />
      <IconChild2 />
    </div>

    <div data-content="" :class="contentClass">
      <div data-title="" :class="titleClass">
        <TitleContent />
      </div>
      <div v-if="props.toast.description" data-description="" :class="descriptionClass">
        <DescriptionContent />
      </div>
    </div>

    <template v-if="cancelResolution.kind === 'action'">
      <button
        data-button
        data-cancel
        :style="cancelButtonStyleResolved"
        :class="cancelButtonClass"
        @click="onCancelClick"
      >
        <CancelLabelSlot />
      </button>
    </template>
    <template v-else-if="cancelResolution.kind === 'node'">
      <CancelNodeSlot />
    </template>

    <template v-if="actionResolution.kind === 'action'">
      <button
        data-button
        data-action
        :style="actionButtonStyleResolved"
        :class="actionButtonClass"
        @click="onActionClick"
      >
        <ActionLabelSlot />
      </button>
    </template>
    <template v-else-if="actionResolution.kind === 'node'">
      <ActionNodeSlot />
    </template>
  </li>
</template>
