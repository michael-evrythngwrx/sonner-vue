# Spec: `Toaster` + `Toast` components (`src/index.tsx`, 889 lines) + consumption of `hooks.tsx`

Source of truth: `sonner-react/src/index.tsx` (v2.0.7). Line numbers below refer to that
file as read. Companion specs already cover `types.ts`, `state.ts`, `assets.tsx`, and
`hooks.tsx`'s `useIsDocumentHidden` in **`specs/state-api-spec.md`** — this spec does not
re-derive those, it references them and covers everything else in `index.tsx`: the
`Toast` component, the `Toaster` component, the module-level constants/helpers, and the
`useSonner` hook (which despite living in `index.tsx` in React, is targeted at
`src/hooks.ts` per ARCHITECTURE.md — see §7).

Target Vue files: `src/Toaster.vue`, `src/Toast.vue`, and the `useSonner` export inside
`src/hooks.ts`.

**Empirically verified in this session** (not just recalled): React's `renderToStaticMarkup`
and Vue 3's real DOM `patchAttr` path (tested via `createApp().mount()` in jsdom) were both
run against a `data-*`-attribute-heavy vnode. Both frameworks behave **identically**:
`true`/`false` values are stringified to the literal attribute values `"true"`/`"false"`;
`null`/`undefined` values omit the attribute entirely; `''` sets an empty-string attribute.
This removes what would otherwise be the single biggest DOM-parity risk in this port — see
§9.1 for the full proof and its consequences. No special Vue handling is needed: binding
`:data-mounted="mounted"` (a plain boolean ref) in a Vue template produces byte-identical
output to React's `data-mounted={mounted}`.

---

## 1. Module-level constants (exact values, byte-identical per ARCHITECTURE.md)

```ts
const VISIBLE_TOASTS_AMOUNT = 3;       // default ToasterProps.visibleToasts
const VIEWPORT_OFFSET = '24px';        // default --offset-* fallback (desktop)
const MOBILE_VIEWPORT_OFFSET = '16px'; // default --mobile-offset-* fallback
const TOAST_LIFETIME = 4000;           // ms, final fallback for toast auto-dismiss duration
const TOAST_WIDTH = 356;               // px, --width on the <ol>
const GAP = 14;                        // px, default ToasterProps.gap, also --gap
const SWIPE_THRESHOLD = 45;            // px, swipe-to-dismiss distance threshold
const TIME_BEFORE_UNMOUNT = 200;       // ms, exit-animation duration before DOM removal
```

Where each is used:
- `VISIBLE_TOASTS_AMOUNT` → `Toaster`'s `visibleToasts` prop default → passed to every
  `Toast` → `isVisible = index + 1 <= visibleToasts` → `data-visible`.
- `VIEWPORT_OFFSET` / `MOBILE_VIEWPORT_OFFSET` → `assignOffset()`'s per-key fallback when
  `offset`/`mobileOffset` prop is unset or partially set (object form, missing key).
- `TOAST_LIFETIME` → final fallback in the duration-resolution chain (`toast.duration ||
  durationFromToaster || TOAST_LIFETIME`), used both for `Toast`'s initial `remainingTime`
  ref value and the memoized `duration`.
- `TOAST_WIDTH` → literally `${TOAST_WIDTH}px` written to `--width` on the `<ol>` — **not**
  configurable via any prop.
- `GAP` → `Toaster`'s `gap` prop default; flows to `--gap` on the `<ol>` and into the
  per-toast offset formula `heightIndex * gap + toastsHeightBefore`.
- `SWIPE_THRESHOLD` → swipe-dismiss distance check in `onPointerUp` (§6).
- `TIME_BEFORE_UNMOUNT` → the `setTimeout` delay in `deleteToast()` between `removed=true`
  (exit animation starts) and calling `removeToast(toast)` (actual array splice / DOM
  unmount). Must equal the CSS exit-transition duration (owned by the styles slice) — the
  comment in source literally says "Equal to exit animation duration".

---

## 2. Helper functions

### 2.1 `cn(...classes)`
```ts
function cn(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
```
Straight port. Falsy entries (`undefined`, `''`, `null` if passed despite the type) are
dropped, remaining joined with a single space. Used everywhere classnames are merged.

### 2.2 `getDefaultSwipeDirections(position)`
```ts
function getDefaultSwipeDirections(position: string): SwipeDirection[] {
  const [y, x] = position.split('-');
  const directions: SwipeDirection[] = [];
  if (y) directions.push(y as SwipeDirection);
  if (x) directions.push(x as SwipeDirection);
  return directions;
}
```
Called with the **group's** `position` string (e.g. `'bottom-right'`) when
`props.swipeDirections` is not supplied. `'bottom-right'.split('-')` → `y='bottom'`,
`x='right'` → returns `['bottom', 'right']`. Order is always `[y, x]`. For a position with
no dash (not a real value in the `Position` union, defensive only) `x` would be `undefined`
and only `[y]` is returned.

### 2.3 `getDocumentDirection()`
```ts
function getDocumentDirection(): ToasterProps['dir'] {
  if (typeof window === 'undefined') return 'ltr';
  if (typeof document === 'undefined') return 'ltr';
  const dirAttribute = document.documentElement.getAttribute('dir');
  if (dirAttribute === 'auto' || !dirAttribute) {
    return window.getComputedStyle(document.documentElement).direction as ToasterProps['dir'];
  }
  return dirAttribute as ToasterProps['dir'];
}
```
- SSR-safe (`window`/`document` guards) — always falls back to `'ltr'`.
- **Never returns the literal string `'auto'`** — if `<html dir="auto">` or no `dir`
  attribute at all, it resolves to the browser's *computed* direction (`'ltr'`/`'rtl'`) via
  `getComputedStyle`, not the raw attribute.
- Called in **two different places** with different timing implications (see §8.1 dir
  handling below).
- Vue: identical function, no framework-specific change needed (pure DOM read).

### 2.4 `assignOffset(defaultOffset, mobileOffset)`
```ts
function assignOffset(defaultOffset: ToasterProps['offset'], mobileOffset: ToasterProps['mobileOffset']) {
  const styles = {} as React.CSSProperties;
  [defaultOffset, mobileOffset].forEach((offset, index) => {
    const isMobile = index === 1;
    const prefix = isMobile ? '--mobile-offset' : '--offset';
    const defaultValue = isMobile ? MOBILE_VIEWPORT_OFFSET : VIEWPORT_OFFSET;

    function assignAll(offset: string | number) {
      ['top', 'right', 'bottom', 'left'].forEach((key) => {
        styles[`${prefix}-${key}`] = typeof offset === 'number' ? `${offset}px` : offset;
      });
    }

    if (typeof offset === 'number' || typeof offset === 'string') {
      assignAll(offset);
    } else if (typeof offset === 'object') {
      ['top', 'right', 'bottom', 'left'].forEach((key) => {
        if (offset[key] === undefined) {
          styles[`${prefix}-${key}`] = defaultValue;
        } else {
          styles[`${prefix}-${key}`] = typeof offset[key] === 'number' ? `${offset[key]}px` : offset[key];
        }
      });
    } else {
      assignAll(defaultValue);
    }
  });
  return styles;
}
```
Produces **8 CSS custom properties** unconditionally: `--offset-top`, `--offset-right`,
`--offset-bottom`, `--offset-left`, `--mobile-offset-top`, `--mobile-offset-right`,
`--mobile-offset-bottom`, `--mobile-offset-left`.

Resolution per side, per the branch taken:
1. `offset` (or `mobileOffset`) is a `number` or `string` → **that single value** (suffixed
   `px` if number, used raw if string) is assigned to **all four sides**.
2. `offset` is an `object` (includes plain `{top,right,bottom,left}` objects) → **per-key**:
   if `offset[key] === undefined`, use the type's default (`'24px'` desktop / `'16px'`
   mobile); else use the value (numbers get `px` suffix, strings used raw).
3. Otherwise (i.e. `offset === undefined`, the normal unset case) → all four sides get the
   type's default value.

**Latent crash preserved verbatim, do not "fix":** `typeof null === 'object'` in
JavaScript. If a caller explicitly passes `offset: null` (not `undefined`), branch 2 is
taken and `offset[key]` on `null` throws a `TypeError` at render time. `undefined` (the
normal unset state, and TypeScript's actual optional-prop default) is safe and hits branch
3. Port this literally — do not add a `offset !== null` guard that source doesn't have.

**Precedence vs. the `style` prop:** on the `<ol>`, `assignOffset(offset, mobileOffset)` is
spread **last**, after the caller's `style` prop:
```
style={{ '--front-toast-height': ..., '--width': ..., '--gap': ..., ...style, ...assignOffset(offset, mobileOffset) }}
```
Because `assignOffset` *always* returns a value for all 8 keys (even the "unset" case
returns the default, not `undefined`), a consumer's `style` prop can **never** override
`--offset-*`/`--mobile-offset-*` — those 8 vars are always Toaster-computed, only settable
via the dedicated `offset`/`mobileOffset` props.

---

## 3. Types recap (owned by `state-api-spec.md` §1 — referenced, not redefined here)

Only the fields this spec's logic touches, for quick reference (full inventory + the
`Renderable`-widening decision live in `state-api-spec.md` §1.1/§1.5):

- `ToastT`: `id`, `toasterId`, `title`, `type`, `icon`, `jsx`, `richColors`, `invert`,
  `closeButton`, `dismissible`, `description`, `duration`, `delete`, `action`, `cancel`,
  `onDismiss`, `onAutoClose`, `promise`, `cancelButtonStyle`, `actionButtonStyle`, `style`,
  `unstyled`, `className`, `classNames`, `descriptionClassName`, `position`, `testId`.
- `HeightT`: `{ height: number; toastId: number|string; position: Position }`.
- `Position` = `'top-left'|'top-right'|'bottom-left'|'bottom-right'|'top-center'|'bottom-center'`.
- `SwipeDirection` = `'top'|'right'|'bottom'|'left'`.
- `Action`: `{ label: Renderable; onClick: (event: MouseEvent) => void; actionButtonStyle?: CSSProperties }`.
- `isAction(x)`: `x.label !== undefined` (a plain property-existence check, **not** a type
  guard against being a VNode — see §6.9 for why this matters).
- `ToasterProps`: see §8.1 for full destructure + defaults.
- `ToastProps`: the internal props `Toast` receives from `Toaster` — see §8.8 for the full
  pass-down table.

**Cross-slice decision this spec depends on and must apply consistently:**
`state-api-spec.md` §1.5 records that ARCHITECTURE.md directs `icon`, `action`, `cancel`,
and `ToastIcons.*` (all currently plain `Renderable` / `Action | Renderable` in React) to
be widened to also accept `() => Renderable`, even though **no code in `index.tsx`
actually calls these as functions** (only `title`/`description` get a
`typeof x === 'function' ? x() : x` check in the render). That other spec flags this as
contract-directed and unresolved-in-detail; this spec's §6.8/§6.9 render logic **applies**
that decision (thunks are invoked once, immediately, before rendering) and documents the
consequence for the `action`/`cancel` discriminant precisely, since applying the widening
there changes an observable behavior (see the boxed note in §6.9). Flagged again in
`openQuestions` — the decision to widen isn't this spec's to make, but the two specs must
agree on what widening *implies*, so the mechanics are spelled out here.

---

## 4. `useIsDocumentHidden` — consumption only

Full behavior + Vue port already specified in `state-api-spec.md` §3.1/§3.2. `Toast`
consumes it as a single call at the top of the component: `const isDocumentHidden =
useIsDocumentHidden();` (a plain boolean in React, a `Ref<boolean>` in Vue — read
`.value` at every use site, notably inside the timer effect's dependency list, §5.6).

---

## 5. `Toast` component — full spec

### 5.1 Props (destructured, `index.tsx` lines 65–91)

```ts
const {
  invert: ToasterInvert,   // Toaster's own `invert` prop, aliased
  toast,
  unstyled,                // from toastOptions?.unstyled
  interacting,             // Toaster's `interacting` state
  setHeights,              // Toaster's raw setState setter — writes the FULL heights array
  visibleToasts,
  heights,                 // PRE-FILTERED to this toast's position group (see §8.6)
  index,
  toasts,                  // PRE-FILTERED to toasts sharing this toast's own `.position`
  expanded,                // Toaster's `expanded` state
  removeToast,             // Toaster's callback, final unmount trigger
  defaultRichColors,       // Toaster's `richColors` prop
  closeButton: closeButtonFromToaster, // toastOptions?.closeButton ?? Toaster.closeButton
  style,                   // toastOptions?.style (NOT Toaster's own top-level `style`!)
  cancelButtonStyle,       // toastOptions?.cancelButtonStyle
  actionButtonStyle,       // toastOptions?.actionButtonStyle
  className = '',          // toastOptions?.className (NOT Toaster's own top-level `className`!)
  descriptionClassName = '', // toastOptions?.descriptionClassName
  duration: durationFromToaster, // toastOptions?.duration ?? Toaster.duration
  position,                // the GROUP's position (the <ol> this toast is rendered under), not necessarily toast.position
  gap,                     // Toaster's `gap` prop
  expandByDefault,         // Toaster's `expand` prop
  classNames,              // toastOptions?.classNames
  icons,                   // Toaster's `icons` prop, unfiltered
  closeButtonAriaLabel = 'Close toast', // toastOptions?.closeButtonAriaLabel, default here
} = props;
```

**`props.swipeDirections` is read directly off `props` mid-render (line 368), not
destructured at the top.** It is `Toaster`'s own top-level `swipeDirections` prop, passed
straight through with no default.

### 5.2 Local reactive state (React `useState`)
| name | initial | Vue mapping |
|---|---|---|
| `swipeDirection` | `null` (`'x' \| 'y' \| null`) | `ref<'x'\|'y'\|null>(null)` |
| `swipeOutDirection` | `null` (`'left'\|'right'\|'up'\|'down'\|null`) | `ref<...>(null)` |
| `mounted` | `false` | `ref(false)` — **timing trap, see §5.5.2** |
| `removed` | `false` | `ref(false)` |
| `swiping` | `false` | `ref(false)` |
| `swipeOut` | `false` | `ref(false)` |
| `isSwiped` | `false` | `ref(false)` |
| `offsetBeforeRemove` | `0` | `ref(0)` |
| `initialHeight` | `0` | `ref(0)` |

### 5.3 Refs (React `useRef`)
| name | initial | purpose | Vue mapping |
|---|---|---|---|
| `remainingTime` | `toast.duration \|\| durationFromToaster \|\| TOAST_LIFETIME` | mutable countdown, decremented on pause | plain `ref<number>` (not reactive-UI-facing, but fine as a ref) |
| `dragStartTime` | `null` (`Date \| null`) | swipe-gesture timestamp | `ref<number \| null>` (store `Date.now()` numbers directly in Vue, avoid `Date` object ceremony) |
| `toastRef` | `null` (`HTMLLIElement`) | the `<li>` DOM node | `ref<HTMLLIElement \| null>` / `useTemplateRef` |
| `closeTimerStartTimeRef` | `0` | timer pause/resume bookkeeping | `ref(0)` (non-UI) |
| `offset` | `0` | imperative cache of the computed offset — **can be a plain `computed()` in Vue, see §5.4** | `computed<number>` recommended |
| `lastCloseTimerStartTimeRef` | `0` | timer pause/resume bookkeeping | `ref(0)` |
| `pointerStartRef` | `null` (`{x,y} \| null`) | swipe gesture origin | `ref<{x:number,y:number}\|null>` |

### 5.4 Derived/computed values

```ts
const isFront = index === 0;
const isVisible = index + 1 <= visibleToasts;
const toastType = toast.type;
const dismissible = toast.dismissible !== false;   // NOT `!!toast.dismissible` — only an explicit `false` disables it
const toastClassname = toast.className || '';
const toastDescriptionClassname = toast.descriptionClassName || '';

const heightIndex = useMemo(
  () => heights.findIndex((h) => h.toastId === toast.id) || 0,
  [heights, toast.id],
);
```
**`|| 0` is dead code, preserve it anyway for literal fidelity — do not silently drop it,
but be aware it does nothing.** `Array.prototype.findIndex` returns `-1` (not found) or a
`>= 0` index. `-1` is truthy in JS, so `-1 || 0` evaluates to `-1`, unchanged. The `|| 0`
only "fires" when `findIndex` already returned `0`, which is already `0`. **Net effect:
`heightIndex` can legitimately be `-1`** — this happens for one render cycle, before this
toast's own mount effect has pushed its entry into the shared `heights` array (see §5.5.1).
When `heightIndex === -1`, the `toastsHeightBefore` reduce below sees every entry's
`reducerIndex >= -1` (always true) and accumulates `0`, and `offset` becomes
`-1 * gap + 0 = -gap` for that one frame. This self-corrects on the next render once the
mount effect has run. Vue: `computed(() => heights.value.findIndex(h => h.toastId === toast.value.id))` — keep the `|| 0` as a comment/no-op if you want literal parity, or drop it with a code comment citing this note; behavior is identical either way.

```ts
const closeButton = useMemo(() => toast.closeButton ?? closeButtonFromToaster, [...]);
const duration = useMemo(() => toast.duration || durationFromToaster || TOAST_LIFETIME, [...]);
```
`closeButton` uses `??` (explicit per-toast `false` wins over a toaster-level `true`).
`duration` uses `||` — **`toast.duration === 0` does NOT mean "instant dismiss"**, it falls
through to `durationFromToaster` or `TOAST_LIFETIME`. Only `Infinity` is a meaningful
sentinel (truthy, so it survives `||`), explicitly checked later to mean "never
auto-dismiss".

```ts
const [y, x] = position.split('-');   // position = the GROUP position, e.g. 'bottom-right' → y='bottom', x='right'

const toastsHeightBefore = useMemo(() => {
  return heights.reduce((prev, curr, reducerIndex) => {
    if (reducerIndex >= heightIndex) return prev;
    return prev + curr.height;
  }, 0);
}, [heights, heightIndex]);

const invert = toast.invert || ToasterInvert;   // `||`, NOT `??` — see boxed note below
const disabled = toastType === 'loading';

offset.current = useMemo(() => heightIndex * gap + toastsHeightBefore, [heightIndex, toastsHeightBefore]);
```

> **Asymmetry to preserve:** `richColors` resolution (`toast.richColors ?? defaultRichColors`)
> uses `??`, so an explicit per-toast `richColors={false}` correctly overrides a
> toaster-level `richColors={true}`. `invert` resolution uses `||`, so an explicit
> per-toast `invert={false}` **cannot** override a toaster-level `invert={true}` (`false ||
> true` → `true`). This is not a typo to "fix" — port both operators exactly as written.

`heights` in all of the above is the **prop** (already filtered to this toast's position
group by `Toaster`, see §8.6) — reads are scoped, but as noted in §5.5.1, **writes via
`setHeights` go to the full, unfiltered array**. This single-writer/filtered-reader split
is a real architectural hazard when `Toast` becomes its own Vue SFC — see the boxed
warning in §5.5.1.

### 5.5 Effects, in source order

#### 5.5.1 Effect: sync `remainingTime` when `duration` changes
```ts
useEffect(() => { remainingTime.current = duration; }, [duration]);
```
Runs once after mount (redundant with the ref's own initializer, which used the identical
formula) and again any time the memoized `duration` value changes — e.g. an existing toast
being updated via a second `toast(...)`/`toast.success(...)` call with a different
`duration`. **This resets the remaining countdown to the full new duration; it does not
pro-rate or continue a partial countdown.**

Vue: `watch(duration, (d) => { remainingTime.value = d })`. `immediate: true` is optional —
the `ref`'s own initializer already computes the same value, so an immediate first run is
a harmless no-op. Do not use `deep`/object-compare — `duration` is a primitive number.

#### 5.5.2 Effect: flip `mounted` to trigger the entry transition — **TIMING TRAP #1**
```ts
useEffect(() => {
  // Trigger enter animation without using CSS animation
  setMounted(true);
}, []);
```
Empty-deps `useEffect` (not `useLayoutEffect`). React's passive effects run **after the
browser has painted** the initial commit. Sequence in React:
1. Initial render commits `data-mounted="false"` (and whatever "closed" position styles
   the CSS derives from that) to the DOM.
2. Browser paints that "closed" frame.
3. The passive effect fires (post-paint), calls `setMounted(true)`.
4. React re-renders, commits `data-mounted="true"`.
5. Browser paints again — because there were two genuinely separate painted frames with
   different attribute values, the CSS `transition` on the toast's transform/opacity
   animates between them. This *is* the entrance animation; there is no CSS `@keyframes`
   entry animation, it's a plain state-driven `transition`.

**Vue has no built-in "after next paint" hook.** `onMounted` in Vue runs synchronously as
part of the initial mount call stack — if you do `onMounted(() => { mounted.value = true })`
directly, the resulting reactive update is queued on Vue's microtask-based scheduler,
which **drains before the browser gets a chance to paint**. The practical risk: the
browser may only ever paint the *already-mounted* (`data-mounted="true"`) frame, and the
entry transition silently never plays.

**Required Vue implementation** — defer the flip past an actual paint boundary:
```ts
onMounted(() => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { mounted.value = true; });
  });
});
```
A single `requestAnimationFrame` callback fires *before* the upcoming paint, reflecting
work already queued — using it alone risks coalescing with the initial mount's own paint
prep in some engines. The **double-rAF** idiom (schedule the flip from *inside* a first rAF
callback) is the standard robust pattern for "wait for one committed paint, then change
state" and is what this port should use. Flag this prominently to the implementer: getting
this wrong produces toasts that "pop in" with no slide/fade instead of animating in —a
visually obvious regression that Playwright's animation-dependent assertions (if any) or a
manual smoke test will catch.

**Synchronize with §5.5.3's mount-time height measurement.** In React, `setMounted(true)`
and the mount-time `setHeights`/`setInitialHeight` calls (§5.5.3) are two *separate*
`useEffect`s, but both are passive effects flushed in the same post-paint pass, so their
resulting state updates land in the **same** subsequent React commit — i.e. `data-mounted`
flips to `true` and `--initial-height` gets its real measured value **in the same
re-paint**. If the Vue port defers these two concerns through different mechanisms (one
via double-rAF, the other via plain `onMounted`), they can land in *different* Vue flush
cycles / different painted frames, which could desync the entry animation from the
height-driven layout math. **Recommendation: perform the height measurement (§5.5.3) and
the `mounted.value = true` flip together, inside the same deferred callback**, e.g.:
```ts
onMounted(() => {
  const node = toastRef.value!;
  const height = node.getBoundingClientRect().height;
  initialHeight.value = height;
  setHeights([{ toastId: toast.value.id, height, position: toast.value.position }, ...heights.value]); // full array, not the filtered prop — see warning below
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { mounted.value = true; });
  });
});
onUnmounted(() => {
  setHeights(heights.value.filter((h) => h.toastId !== toast.value.id));
});
```
(This combines §5.5.2 and §5.5.3 into one block per the recommendation above; §5.5.3 is
also documented standalone below since React keeps them as two effects.)

#### 5.5.3 Effect: mount-time height measurement + `heights` array registration
```ts
useEffect(() => {
  const toastNode = toastRef.current;
  if (toastNode) {
    const height = toastNode.getBoundingClientRect().height;
    setInitialHeight(height);
    setHeights((h) => [{ toastId: toast.id, height, position: toast.position }, ...h]);
    return () => setHeights((h) => h.filter((height) => height.toastId !== toast.id));
  }
}, [setHeights, toast.id]);
```
- Deps are effectively "run once on mount, clean up on unmount" (`setHeights` is a stable
  setState function; `toast.id` never changes for a given component instance since React
  keys the `<Toast>` by `toast.id`).
- **Prepends** the new entry to the *front* of the heights array (`[newEntry, ...h]`).
- Cleanup **filters** the entry out by `toastId` on unmount.

> **Critical architectural hazard for the Vue SFC split.** `heights` as *read* by this
> component (`props.heights`) is already filtered to this toast's position group by
> `Toaster` (§8.6). But `setHeights` — passed down unchanged as the raw state setter — must
> mutate `Toaster`'s **full, unfiltered** `heights` array, not a locally-scoped copy of the
> filtered prop. If `Toast.vue` naively does `heights.value = [...]` on its own filtered
> prop, entries for *other* position groups get silently dropped from the shared state.
> **Required pattern:** `Toaster.vue` owns a single `heights = ref<HeightT[]>([])`, computes
> a filtered slice per group to pass down as a read prop, and passes an update function
> (e.g. `setHeights: (updater: HeightT[] | ((prev: HeightT[]) => HeightT[])) => void`,
> mirroring React's dual sync-value-or-updater-function `setState` signature, or two
> emits) down to each `Toast.vue` instance. `Toast.vue` must call that function against the
> **full** array it receives via the updater-function form (`setHeights(h => [...])`), never
> assume its local `heights` prop is authoritative for writes.

Vue mapping: `onMounted` (setup half) + `onUnmounted` (cleanup half) — ordinary mount/unmount
pairing, no timing trap here (unlike §5.5.2, this measurement's *own* timing doesn't need
to be paint-deferred — only the *externally visible* `data-mounted` flip does). See §5.5.2
for the recommendation to fuse this with the mount flag flip in one deferred callback if
that path is taken; if kept separate, this measurement itself is safe in a plain
`onMounted`.

#### 5.5.4 Effect: layout effect — keep height in sync with content changes
```ts
useLayoutEffect(() => {
  if (!mounted) return;
  const toastNode = toastRef.current;
  const originalHeight = toastNode.style.height;
  toastNode.style.height = 'auto';
  const newHeight = toastNode.getBoundingClientRect().height;
  toastNode.style.height = originalHeight;

  setInitialHeight(newHeight);

  setHeights((heights) => {
    const alreadyExists = heights.find((h) => h.toastId === toast.id);
    if (!alreadyExists) {
      return [{ toastId: toast.id, height: newHeight, position: toast.position }, ...heights];
    } else {
      return heights.map((h) => (h.toastId === toast.id ? { ...h, height: newHeight } : h));
    }
  });
}, [mounted, toast.title, toast.description, setHeights, toast.id, toast.jsx, toast.action, toast.cancel]);
```
- Guarded on `mounted` — no-ops entirely until `mounted` is `true` (so it fires once right
  after the §5.5.2 flip, and again on every listed content change thereafter).
- **Measurement trick:** temporarily force `style.height = 'auto'` to get the *natural*
  content height (bypassing any explicit inline height the mount/removal animation logic
  may have set), read `getBoundingClientRect().height`, then restore the original inline
  `style.height` string exactly (not cleared — whatever it was, even `''`).
- **Write semantics differ from §5.5.3's mount effect:** here, if an entry already exists
  for this `toast.id` (the normal case, since §5.5.3 already inserted it before `mounted`
  could become `true`), it's updated **in place** via `.map()` — array order/position is
  preserved. Only falls back to prepend-a-new-entry if somehow no entry exists yet.
- Dependency list: `mounted`, `toast.title`, `toast.description`, `setHeights` (stable),
  `toast.id` (stable), `toast.jsx`, `toast.action`, `toast.cancel`. Notably **not**
  `toast.icon`, `toast.classNames`, custom `className`, etc. — content changes to those
  fields won't trigger a re-measurement even if they visually affect height.

**Vue mapping — TIMING TRAP #2 (the good kind, no extra work needed):** React's
`useLayoutEffect` runs synchronously after DOM mutation but **before** the browser paints
(it blocks paint). Vue's `watch(..., { flush: 'post' })` callbacks run after Vue has
patched the DOM, scheduled via the same pre-paint microtask flush Vue always uses — this is
timing-equivalent to `useLayoutEffect`, **not** to plain `useEffect`. No rAF/setTimeout
trick is needed here (contrast with §5.5.2). Recommended Vue port:
```ts
watch(
  [mounted, () => toast.value.title, () => toast.value.description, () => toast.value.jsx, () => toast.value.action, () => toast.value.cancel],
  () => {
    if (!mounted.value) return;
    const node = toastRef.value!;
    const originalHeight = node.style.height;
    node.style.height = 'auto';
    const newHeight = node.getBoundingClientRect().height;
    node.style.height = originalHeight;
    initialHeight.value = newHeight;
    const existing = heights.value.find((h) => h.toastId === toast.value.id);
    if (!existing) {
      setHeights([{ toastId: toast.value.id, height: newHeight, position: toast.value.position }, ...heights.value]);
    } else {
      setHeights(heights.value.map((h) => (h.toastId === toast.value.id ? { ...h, height: newHeight } : h)));
    }
  },
  { flush: 'post' },
);
```

#### 5.5.5 `deleteToast` callback
```ts
const deleteToast = useCallback(() => {
  setRemoved(true);
  setOffsetBeforeRemove(offset.current);
  setHeights((h) => h.filter((height) => height.toastId !== toast.id));
  setTimeout(() => { removeToast(toast); }, TIME_BEFORE_UNMOUNT);
}, [toast, removeToast, setHeights, offset]);
```
Order matters:
1. `removed = true` (drives `data-removed="true"`, CSS exit transform kicks in).
2. `offsetBeforeRemove = offset.current` — **freezes** the toast's `--offset` value at
   exactly this moment; while `removed === true` the `--offset` var stops tracking the
   live `offset` computed value (see §5.6 style object), so the exiting toast doesn't
   visually snap around as siblings re-flow to fill the gap during the 200ms exit.
3. Removes this toast's entry from the shared `heights` array **immediately** (not after
   the 200ms delay) — this is what causes *other* toasts to immediately start animating
   into the freed space while this one is still visually present and exiting.
4. After `TIME_BEFORE_UNMOUNT` (200ms) elapses, calls `removeToast(toast)` — this is what
   actually splices the toast out of `Toaster`'s `toasts` array, unmounting the `<li>`.

Vue: a plain function (per ARCHITECTURE.md's `useCallback` → plain function mapping) closed
over the current `toast`/`removeToast`/`setHeights`/`offset` — no memoization ceremony
needed since Vue doesn't re-create closures on every render as a performance concern.

#### 5.5.6 Effect: the auto-dismiss timer — pause/resume, duration precedence
```ts
useEffect(() => {
  if ((toast.promise && toastType === 'loading') || toast.duration === Infinity || toast.type === 'loading') return;
  let timeoutId: NodeJS.Timeout;

  const pauseTimer = () => {
    if (lastCloseTimerStartTimeRef.current < closeTimerStartTimeRef.current) {
      const elapsedTime = new Date().getTime() - closeTimerStartTimeRef.current;
      remainingTime.current = remainingTime.current - elapsedTime;
    }
    lastCloseTimerStartTimeRef.current = new Date().getTime();
  };

  const startTimer = () => {
    if (remainingTime.current === Infinity) return;
    closeTimerStartTimeRef.current = new Date().getTime();
    timeoutId = setTimeout(() => {
      toast.onAutoClose?.(toast);
      deleteToast();
    }, remainingTime.current);
  };

  if (expanded || interacting || isDocumentHidden) {
    pauseTimer();
  } else {
    startTimer();
  }

  return () => clearTimeout(timeoutId);
}, [expanded, interacting, toast, toastType, isDocumentHidden, deleteToast]);
```

**Skip condition** (entire effect no-ops, no timer ever starts, no pause/resume tracking
happens at all): `(toast.promise && toastType === 'loading') || toast.duration === Infinity
|| toast.type === 'loading'`. Since `toastType` is a local `const toastType = toast.type`
alias, the first and third disjuncts (`toastType === 'loading'` / `toast.type ===
'loading'`) are literally the same boolean; the first disjunct's `toast.promise &&` clause
is therefore redundant given the third disjunct alone — port the **literal three-part
expression** for source fidelity (a future edit to one might diverge from the other; don't
"clean it up" into the logically-equivalent `toastType === 'loading' || toast.duration ===
Infinity`, even though that's what it reduces to). **Practical summary: loading-type toasts
never auto-dismiss via this timer (they wait for the promise to resolve into a
success/error/default type, at which point this effect re-runs since `toast`/`toastType`
changed and the skip condition no longer holds); any toast with `duration: Infinity` never
auto-dismisses.**

**`Infinity` handling has two layers:** the effect-level skip (`toast.duration ===
Infinity`, checking the *raw* per-toast field, not the resolved `duration` memo) and,
separately, inside `startTimer()`, `if (remainingTime.current === Infinity) return;` — this
second check exists because `setTimeout(fn, Infinity)` behaves as `setTimeout(fn, 0)`
in JS (fires "immediately"), which would make an Infinite-duration toast disappear right
away — the source code comment calls this out explicitly. This second check matters when
`remainingTime.current` becomes `Infinity` via the resolved `duration` memo (`toast.duration
|| durationFromToaster || TOAST_LIFETIME`) even if `toast.duration` itself wasn't the
literal value that made it `Infinity` (e.g. `durationFromToaster === Infinity`, which the
outer skip condition does *not* check since it only inspects `toast.duration`). **Port
both checks, they are not redundant with each other.**

**Effect re-runs (full teardown + setup) on ANY of:** `expanded`, `interacting`, `toast`
(new object reference — happens on every update to this toast via a fresh `toast(...)`
call, since `Toaster`'s subscribe handler always does `{...oldToast, ...newData}`, a new
reference), `toastType` (redundant given `toast` already captures it, but listed
separately), `isDocumentHidden`, `deleteToast` (stable via `useCallback`, effectively
constant). Each re-run: `clearTimeout` on the previous pending timeout (cleanup), then
immediately re-evaluate `expanded || interacting || isDocumentHidden` and call
`pauseTimer()` or `startTimer()` fresh.

**`pauseTimer()` double-counting guard — must be ported exactly, not simplified:**
```
if (lastCloseTimerStartTimeRef.current < closeTimerStartTimeRef.current) {
  elapsedTime = now - closeTimerStartTimeRef.current;
  remainingTime.current -= elapsedTime;
}
lastCloseTimerStartTimeRef.current = now;
```
The subtraction only happens if the *previous pause's end-timestamp* is still behind the
*most recent active-timer's start-timestamp* — i.e. only decrement `remainingTime` once
per active-timer run, even if `pauseTimer()` gets invoked multiple times in a row without
an intervening `startTimer()` (e.g. several re-renders while `expanded` stays `true`).
Without this guard, `remainingTime` would be decremented repeatedly for the same already-
accounted-for pause. Vue: two plain `ref<number>`s (`closeTimerStartTimeRef`,
`lastCloseTimerStartTimeRef`), same comparison, same assignment order.

**Vue mapping — this is a `watch`, not `onMounted`, because it must tear down and re-arm on
every listed dependency change:**
```ts
let timeoutId: ReturnType<typeof setTimeout> | undefined;

watch(
  [expanded, interacting, () => toast.value, isDocumentHidden],
  () => {
    if ((toast.value.promise && toast.value.type === 'loading') || toast.value.duration === Infinity || toast.value.type === 'loading') {
      return; // no timer this cycle
    }
    const pauseTimer = () => { /* exact logic above */ };
    const startTimer = () => { /* exact logic above, sets timeoutId */ };
    if (expanded.value || interacting.value || isDocumentHidden.value) pauseTimer();
    else startTimer();
  },
  { immediate: true },
);
onWatcherCleanup(() => clearTimeout(timeoutId)); // or an onCleanup param inside the watch callback itself
onUnmounted(() => clearTimeout(timeoutId));
```
Use `() => toast.value` (reference identity) as the third watch source — do **not** use
`{ deep: true }` on it; React's dependency comparison is by object reference (`Object.is`),
and `Toaster`'s update path always creates a fresh object on any change, so shallow/
reference watching is the correct equivalent. Prefer Vue 3.5+'s `onWatcherCleanup()` called
*inside* the watch callback (runs before each re-invocation *and* on unwatch) over a
separate `onUnmounted`, to mirror React's per-effect-run cleanup semantics exactly — a
cleanup that fires before the *next* run, not just at the very end.

#### 5.5.7 Effect: react to `toast.delete` (programmatic dismiss)
```ts
useEffect(() => {
  if (toast.delete) {
    deleteToast();
    toast.onDismiss?.(toast);
  }
}, [deleteToast, toast.delete]);
```
Fires whenever `toast.delete` transitions to (or is already) truthy. `toast.delete` is set
by `Toaster`'s own `ToastState.subscribe` handler in response to `ToastState.dismiss(id)`
(§8.4.1 branch 1) — i.e. this is the path for `toast.dismiss(id)` calls, `toast.promise`'s
`finally`-driven auto-dismiss of a still-loading toast, etc. Order: `deleteToast()` first
(starts the exit sequence), **then** `toast.onDismiss?.(toast)`. Vue: `watch(() =>
toast.value.delete, (del) => { if (del) { deleteToast(); toast.value.onDismiss?.(toast.value); } })`.

### 5.6 `onDismiss` / `onAutoClose` — exactly when each fires (consolidated)

| Trigger | Callback fired | Where |
|---|---|---|
| Timer expires naturally (no interaction, not paused) | `toast.onAutoClose?.(toast)` then `deleteToast()` | §5.5.6 `startTimer`'s `setTimeout` body |
| Close button clicked (and not disabled/non-dismissible) | `deleteToast()` then `toast.onDismiss?.(toast)` | §6.6 |
| Cancel button clicked (and dismissible) | `toast.cancel.onClick?.(event)` then unconditionally `deleteToast()` — **no `onDismiss` call here** | §6.9 |
| Action button clicked, `event.defaultPrevented` false | `toast.action.onClick?.(event)` then `deleteToast()` — **no `onDismiss` call here either** | §6.9 |
| Swipe-dismissed past threshold | `toast.onDismiss?.(toast)` then `deleteToast()` | §6.2 |
| Programmatic `toast.dismiss(id)` / promise settling a still-loading toast | `deleteToast()` then `toast.onDismiss?.(toast)` | §5.5.7 |

**Only the close-button and swipe and programmatic-dismiss paths call `toast.onDismiss`.**
Cancel and action button clicks do **not** call `onDismiss` — only their own
`Action.onClick` (if provided) and then an unconditional/conditional `deleteToast()`. This
is easy to get wrong by assuming "any user-dismiss path calls onDismiss" — it doesn't.
`onAutoClose` fires **only** from the natural-timer-expiry path, nowhere else.

### 5.7 Render tree — `<li>` root

```html
<li
  tabIndex={0}
  data-sonner-toast=""
  data-rich-colors={toast.richColors ?? defaultRichColors}      <!-- OMITTED entirely if both undefined -->
  data-styled={!Boolean(toast.jsx || toast.unstyled || unstyled)}
  data-mounted={mounted}
  data-promise={Boolean(toast.promise)}
  data-swiped={isSwiped}
  data-removed={removed}
  data-visible={isVisible}
  data-y-position={y}
  data-x-position={x}
  data-index={index}
  data-front={isFront}
  data-swiping={swiping}
  data-dismissible={dismissible}
  data-type={toastType}                                          <!-- OMITTED if toast.type is undefined (bare message toasts) -->
  data-invert={invert}
  data-swipe-out={swipeOut}
  data-swipe-direction={swipeOutDirection}                       <!-- OMITTED while null -->
  data-expanded={Boolean(expanded || (expandByDefault && mounted))}
  data-testid={toast.testId}                                     <!-- OMITTED if undefined -->
  class="{cn(className, toastClassname, classNames?.toast, toast?.classNames?.toast, classNames?.default, classNames?.[toastType], toast?.classNames?.[toastType])}"
  style="--index: {index}; --toasts-before: {index}; --z-index: {toasts.length - index}; --offset: {(removed ? offsetBeforeRemove : offset)}px; --initial-height: {expandByDefault ? 'auto' : `${initialHeight}px`}; {...style}; {...toast.style}"
  onDragEnd={...} onPointerDown={...} onPointerUp={...} onPointerMove={...}
>
  ...children (§5.8–5.11, in this exact order)...
</li>
```

**`className` slot precedence chain (all merged via `cn()`, order matters for CSS
specificity ties but not for correctness since these are additive classes):**
1. `className` — from `toastOptions?.className` (Toaster-level, **not** Toaster's own
   top-level `className`, which only reaches the `<ol>`).
2. `toastClassname` — `toast.className` (per-toast).
3. `classNames?.toast` — `toastOptions.classNames.toast` slot.
4. `toast?.classNames?.toast` — per-toast override of the same slot.
5. `classNames?.default` — `toastOptions.classNames.default`. **Applied unconditionally to
   every toast regardless of its actual type**, despite the name suggesting it's only for
   type-less/"default" toasts. Do not make this conditional on `toastType` — that would be
   a behavior change from source.
6. `classNames?.[toastType]` — the type-specific slot (`success`/`error`/`info`/`warning`/
   `loading`/`default`/`action`), dynamic key lookup, `undefined`-safe (no-op if
   `toastType` is undefined or the key isn't configured).
7. `toast?.classNames?.[toastType]` — per-toast override of the same type-specific slot.

**`style` merge order:** the five computed CSS custom properties first, then the
`toastOptions?.style` object (`style` prop, spread), then `toast.style` (spread last,
highest precedence — a caller's per-toast `style` can override even the internal
`--index`/`--offset`/etc. vars if they explicitly set those keys, which is unusual but not
prevented).

**`--index` and `--toasts-before` are both set to the literal same value (`index`) — this
is not a typo, both custom properties exist in the DOM simultaneously with identical
values.** Preserve both.

**`--z-index` uses `toasts.length`**, where `toasts` is *this Toast's own* `toasts` prop —
which `Toaster` computes as `filteredToasts.filter(t => t.position == toast.position)`
(the count of toasts sharing **this specific toast's own `.position` field**, using loose
`==` so `undefined == undefined` matches too) — **not** the group/`<ol>`'s toast count in
general (though for a toast with `.position` unset that lands in the default group, these
are normally the same count).

### 5.8 Event handlers on `<li>`

#### `onDragEnd`
```ts
() => {
  setSwiping(false);
  setSwipeDirection(null);
  pointerStartRef.current = null;
}
```
Native HTML5 `dragend` (distinct from Pointer Events) — a defensive fallback for gestures
the browser turns into a native drag (e.g. starting a drag over selectable text/an image).
Does **not** reset `--swipe-amount-x/y` or `isSwiped`.

#### `onPointerDown`
```ts
(event) => {
  if (event.button === 2) return;                     // ignore right-click
  if (disabled || !dismissible) return;                // disabled = loading type
  dragStartTime.current = new Date();
  setOffsetBeforeRemove(offset.current);
  (event.target as HTMLElement).setPointerCapture(event.pointerId);
  if ((event.target as HTMLElement).tagName === 'BUTTON') return;  // don't arm swipe from a button
  setSwiping(true);
  pointerStartRef.current = { x: event.clientX, y: event.clientY };
}
```
Note pointer capture is set **before** the button-tagName early return — i.e. it's called
even when the press originated on a nested `<button>` (close/cancel/action), it's just
inert in that case because `pointerStartRef.current` never gets set, and `onPointerMove`'s
first guard (`if (!pointerStartRef.current...) return;`) makes swipe tracking dormant for
that gesture.

#### `onPointerMove`
```ts
(event) => {
  if (!pointerStartRef.current || !dismissible) return;
  const isHighlighted = window.getSelection()?.toString().length > 0;
  if (isHighlighted) return;   // don't hijack text-selection drags

  const yDelta = event.clientY - pointerStartRef.current.y;
  const xDelta = event.clientX - pointerStartRef.current.x;
  const swipeDirections = props.swipeDirections ?? getDefaultSwipeDirections(position);

  if (!swipeDirection && (Math.abs(xDelta) > 1 || Math.abs(yDelta) > 1)) {
    setSwipeDirection(Math.abs(xDelta) > Math.abs(yDelta) ? 'x' : 'y');   // locked once set, only unlocked by onPointerUp/onDragEnd
  }

  let swipeAmount = { x: 0, y: 0 };   // fresh object every call — the non-active axis is ALWAYS 0

  const getDampening = (delta: number) => {
    const factor = Math.abs(delta) / 20;
    return 1 / (1.5 + factor);
  };

  if (swipeDirection === 'y') {
    if (swipeDirections.includes('top') || swipeDirections.includes('bottom')) {
      if ((swipeDirections.includes('top') && yDelta < 0) || (swipeDirections.includes('bottom') && yDelta > 0)) {
        swipeAmount.y = yDelta;   // full, undampened movement in an allowed direction
      } else {
        const dampenedDelta = yDelta * getDampening(yDelta);
        swipeAmount.y = Math.abs(dampenedDelta) < Math.abs(yDelta) ? dampenedDelta : yDelta;
      }
    }
    // else: y-axis not swipeable at all per swipeDirections → swipeAmount.y stays 0, not even dampened
  } else if (swipeDirection === 'x') {
    if (swipeDirections.includes('left') || swipeDirections.includes('right')) {
      if ((swipeDirections.includes('left') && xDelta < 0) || (swipeDirections.includes('right') && xDelta > 0)) {
        swipeAmount.x = xDelta;
      } else {
        const dampenedDelta = xDelta * getDampening(xDelta);
        swipeAmount.x = Math.abs(dampenedDelta) < Math.abs(xDelta) ? dampenedDelta : xDelta;
      }
    }
  }

  if (Math.abs(swipeAmount.x) > 0 || Math.abs(swipeAmount.y) > 0) setIsSwiped(true);

  toastRef.current?.style.setProperty('--swipe-amount-x', `${swipeAmount.x}px`);
  toastRef.current?.style.setProperty('--swipe-amount-y', `${swipeAmount.y}px`);
}
```
- `swipeDirections` (plural, local var) resolves from `props.swipeDirections` (the
  `Toaster`-level prop, no default) or else `getDefaultSwipeDirections(position)` — the
  **group** position (`y`/`x` from `<ol>`'s position), giving e.g. `['bottom', 'right']`
  for the default position.
- **Dampening formula:** `getDampening(delta) = 1 / (1.5 + |delta| / 20)`. At `delta = 0`:
  `1/1.5 ≈ 0.667`. As `|delta|` grows, the factor shrinks toward 0 asymptotically — larger
  drags in a disallowed direction get progressively *more* resistance, not less (classic
  rubber-band feel). The `Math.abs(dampenedDelta) < Math.abs(delta) ? dampenedDelta : delta`
  guard exists purely to avoid a visible "jump" the instant dampening kicks in (if the
  dampened value would somehow be *larger* in magnitude than the raw delta — not possible
  given the formula's range `(0, 0.667]` at realistic deltas, but the guard is defensive).
- **Both `--swipe-amount-x` and `--swipe-amount-y` are written on every single
  `pointermove` event, unconditionally** — the inactive axis is always explicitly reset to
  `'0px'`, not left alone.
- **These two CSS custom properties are set imperatively via `element.style.setProperty`,
  not through a reactive style binding.** This is deliberate for 60fps drag performance
  (avoiding a full Vue re-render per pointer-move event). **Vue port must do the same**:
  keep a template ref to the `<li>` and call `toastRef.value?.style.setProperty(...)`
  directly inside the handler — do **not** route `--swipe-amount-x/y` through the
  reactive `style` binding object (§5.7's style object) at all; they live entirely outside
  Vue's reactivity, exactly as in React.

#### `onPointerUp`
```ts
() => {
  if (swipeOut || !dismissible) return;
  pointerStartRef.current = null;
  const swipeAmountX = Number(toastRef.current?.style.getPropertyValue('--swipe-amount-x').replace('px', '') || 0);
  const swipeAmountY = Number(toastRef.current?.style.getPropertyValue('--swipe-amount-y').replace('px', '') || 0);
  const timeTaken = new Date().getTime() - dragStartTime.current?.getTime();
  const swipeAmount = swipeDirection === 'x' ? swipeAmountX : swipeAmountY;
  const velocity = Math.abs(swipeAmount) / timeTaken;

  if (Math.abs(swipeAmount) >= SWIPE_THRESHOLD || velocity > 0.11) {
    setOffsetBeforeRemove(offset.current);
    toast.onDismiss?.(toast);
    if (swipeDirection === 'x') {
      setSwipeOutDirection(swipeAmountX > 0 ? 'right' : 'left');
    } else {
      setSwipeOutDirection(swipeAmountY > 0 ? 'down' : 'up');
    }
    deleteToast();
    setSwipeOut(true);
    return;
  } else {
    toastRef.current?.style.setProperty('--swipe-amount-x', `0px`);
    toastRef.current?.style.setProperty('--swipe-amount-y', `0px`);
  }
  setIsSwiped(false);
  setSwiping(false);
  setSwipeDirection(null);
}
```
**Threshold condition is `Math.abs(swipeAmount) >= SWIPE_THRESHOLD || velocity > 0.11` — an
OR, not an AND. Either a large-enough absolute drag distance (≥ 45px) *or* a fast-enough
flick (velocity > 0.11 px/ms) independently triggers dismissal.** Get this exactly right —
do not require both.

- No guard on `event.target`/where the gesture started — this handler runs its full logic
  even for a gesture that began on a button (where swipe was never actually armed); in
  that case the CSS vars read back as `0` (default via `|| 0` on the parse), giving
  `swipeAmount = 0` and (typically) `velocity` near 0, so it falls into the `else` branch
  harmlessly (resets vars that were already `0px`-ish, resets already-false flags).
- On dismiss: `offsetBeforeRemove` is set **again** here (redundant with what `deleteToast`
  itself will also set moments later, but ordering-wise this call happens with the *current*
  `offset.current`, immediately, before `deleteToast()` runs) — then `toast.onDismiss` is
  called, then `swipeOutDirection` is set based on the sign of the raw (undampened, from the
  CSS var) amount, **then** `deleteToast()`, **then** `setSwipeOut(true)`. Note
  `setSwipeOut(true)` happens *after* `deleteToast()`, not before.
- On non-dismiss: CSS vars are explicitly reset to `'0px'` (imperative, same
  `setProperty` pattern as pointermove — snaps the toast back via CSS transition), then the
  three swipe-tracking states reset (`isSwiped`, `swiping`, `swipeDirection`).
- **No click-suppression logic was found anywhere in this file for "the click that follows
  a swipe."** There is no `event.preventDefault()`/`stopPropagation()` call tied to swipe
  state, and no code that conditionally ignores a subsequent `click` event based on
  `isSwiped`/`swipeDirection`. If any such suppression exists, it would have to be
  implemented purely in CSS (e.g. `pointer-events` toggling) — out of this slice's scope
  (owned by `styles-spec.md`). **Flagged in openQuestions** so the CSS slice / an
  implementer doesn't assume JS handles this.

Vue mapping for all four handlers: plain `@dragend`/`@pointerdown`/`@pointerup`/
`@pointermove` bindings on the `<li>`, closures over the same `ref`s. Native `PointerEvent`
objects pass through unchanged in Vue (no synthetic event wrapper), so `event.button`,
`event.clientX/Y`, `event.pointerId`, `.setPointerCapture()`, etc. all work identically.

### 5.9 Icon resolution and the `data-icon` container

```ts
function getLoadingIcon() {
  if (icons?.loading) {
    return (
      <div className={cn(classNames?.loader, toast?.classNames?.loader, 'sonner-loader')} data-visible={toastType === 'loading'}>
        {icons.loading}
      </div>
    );
  }
  return <Loader className={cn(classNames?.loader, toast?.classNames?.loader)} visible={toastType === 'loading'} />;
}

const icon = toast.icon || icons?.[toastType] || getAsset(toastType);
```

**Class name asymmetry — preserve exactly:**
- Custom-icon path (`icons.loading` provided): wrapper `<div>` gets classes
  `cn(classNames?.loader, toast?.classNames?.loader, 'sonner-loader')` — note the literal
  extra class `'sonner-loader'` (singular, no "-ing-wrapper") appended.
- Built-in `<Loader>` path: its *own* internal root `<div>` (see `assets.tsx`/asset spec)
  is hardcoded to class `sonner-loading-wrapper`, receiving only `cn(classNames?.loader,
  toast?.classNames?.loader)` as an *additional* className prop (no `'sonner-loader'`
  literal). `styles.css` has **separate selectors** for `.sonner-loader[data-visible=...]`
  and `.sonner-loading-wrapper[data-visible=...]` — these are two genuinely different
  classes targeting two different code paths, not a naming inconsistency to unify.

**`icon` resolution precedence:** `toast.icon || icons?.[toastType] || getAsset(toastType)`
— per-toast override first, then toaster-level `icons` prop keyed by this toast's type,
then the built-in default (from `assets.ts` — `getAsset` returns the success/info/warning/
error SVG for those four types, `null` for everything else including `undefined`,
`'normal'`, `'action'`, `'loading'`, `'default'`).

**Renderable-widening consequence (per §3 cross-reference):** since `icon` and `icons.*`
are contract-widened to accept `() => Renderable`, the *selection* among `toast.icon` /
`icons?.[toastType]` / `getAsset(toastType)` must happen on the **raw candidate** (a
function reference is always truthy, so selection-by-truthiness is unaffected), and only
the **winning** candidate gets invoked if it's a function, immediately, once, synchronously,
before rendering:
```ts
const iconCandidate = toast.icon || icons?.[toastType] || getAsset(toastType);
const icon = typeof iconCandidate === 'function' && !isVNode(iconCandidate) ? iconCandidate() : iconCandidate;
```
(The `!isVNode(...)` guard is precautionary — Vue VNodes are plain objects, never
functions, so it's technically redundant, but documents intent against ever mis-detecting a
functional-component reference as a thunk-to-call versus a component to render as-is; this
distinction doesn't actually arise for `icon`/`icons.*` since those are never handed a raw
component reference in source usage, only rendered content or thunks.) Same treatment for
`icons?.close` (§6.6) and `icons?.loading` inside `getLoadingIcon()`.

**Container render condition (port the literal boolean expression, do not simplify):**
```ts
(toastType || toast.icon || toast.promise) && toast.icon !== null && (icons?.[toastType] !== null || toast.icon)
```
- `toastType || toast.icon || toast.promise`: true if the toast has a `type` string, OR a
  custom `icon`, OR is a `promise`-driven toast.
- `toast.icon !== null`: an explicit per-toast `icon: null` suppresses the container
  entirely, regardless of type/promise — **note this is `!== null`, distinct from
  `undefined`** (an unset `icon` is `undefined`, which does *not* trip this guard;
  `undefined !== null` is `true`).
- `icons?.[toastType] !== null || toast.icon`: if the toaster-level `icons` prop
  *explicitly* sets `icons[type] = null` (suppressing the default icon for that type) *and*
  there's no per-toast `icon` override, skip the container. A truthy `toast.icon` always
  wins regardless of `icons[type]` being `null`.

**Container contents — two children, both conditionally rendered, order matters:**
```html
<div data-icon="" class="{cn(classNames?.icon, toast?.classNames?.icon)}">
  {/* child 1 */}
  {toast.promise || (toast.type === 'loading' && !toast.icon) ? (toast.icon || getLoadingIcon()) : null}
  {/* child 2 */}
  {toast.type !== 'loading' ? icon : null}
</div>
```
**Critically: once a toast was created via `toast.promise(...)`, `toast.promise` remains
truthy on the toast object for its *entire* lifecycle**, including after it transitions to
`'success'`/`'error'`/`'default'` — because `state.ts`'s `create()` update path merges
`{...existingToast, ...newPartialData}`, and the success/error re-`create()` calls never
explicitly pass a `promise` key, so the original truthy `promise` reference/function
survives the merge untouched (see `state-api-spec.md` for the full merge mechanics). This
means:
- **During `'loading'`:** child 1 renders (via `toast.promise` truthy) → shows
  `toast.icon || getLoadingIcon()` (the spinner, typically). Child 2 is `null` (type ===
  'loading' suppresses it).
- **After resolving to `'success'`/`'error'`/etc.:** child 1 **still renders** (since
  `toast.promise` is still truthy!) — it shows the spinner again (or `toast.icon` if the
  resolved toast set one), but the spinner `<div>`'s own `data-visible={toastType ===
  'loading'}` is now `false`. Child 2 **also** now renders (`type !== 'loading'`), showing
  the resolved-type `icon` (e.g. the checkmark). **Both nodes exist in the DOM
  simultaneously** for a resolved promise toast — the spinner is hidden via
  `data-visible="false"` (a CSS concern, presumably an opacity/display crossfade owned by
  the styles slice), not unmounted. **Do not conditionally `v-if` the spinner out of
  existence once resolved — it must stay mounted with `data-visible` toggling, to allow a
  CSS crossfade between spinner and resolved icon.**
- For a **non-promise, non-loading** toast (e.g. plain `toast.success(...)` called
  directly, not via `.promise()`): `toast.promise` is falsy and `toast.type !== 'loading'`,
  so child 1's condition `toast.promise || (type==='loading' && !icon)` is false → child 1
  renders `null`. Only child 2 renders (the resolved icon). No spinner node exists in the
  DOM at all for these.

### 5.10 Content block

```html
<div data-content="" class="{cn(classNames?.content, toast?.classNames?.content)}">
  <div data-title="" class="{cn(classNames?.title, toast?.classNames?.title)}">
    {toast.jsx ? toast.jsx : (typeof toast.title === 'function' ? toast.title() : toast.title)}
  </div>
  {toast.description ? (
    <div data-description="" class="{cn(descriptionClassName, toastDescriptionClassname, classNames?.description, toast?.classNames?.description)}">
      {typeof toast.description === 'function' ? toast.description() : toast.description}
    </div>
  ) : null}
</div>
```
- `data-title` div is **always rendered** (may be empty if `toast.title`/`toast.jsx` are
  both unset) — no conditional guard around it.
- `data-description` div is rendered **only if `toast.description` is truthy** (title has
  no such guard, description does).
- `descriptionClassName` (prop, from `toastOptions?.descriptionClassName`) merges before
  `toastDescriptionClassname` (`toast.descriptionClassName`), before the `classNames?`
  slots — same left-to-right `cn()` order pattern as everywhere else.
- Title/description support the function-thunk form **in source already** (this is the one
  place React itself does `typeof x === 'function' ? x() : x` — no contract-widening
  needed here, it's native behavior). `toast.jsx` (from `toast.custom(...)`) always wins
  over `toast.title` when present, entirely replacing the title slot's content.

### 5.11 Close button

Rendered iff: `closeButton && !toast.jsx && toastType !== 'loading'`.
```html
<button
  aria-label="{closeButtonAriaLabel}"           <!-- default 'Close toast', from toastOptions?.closeButtonAriaLabel only — no per-toast field exists -->
  data-disabled={disabled}                       <!-- disabled = toastType === 'loading' — ALWAYS FALSE here in practice, see note below -->
  data-close-button
  class="{cn(classNames?.closeButton, toast?.classNames?.closeButton)}"
  onClick={disabled || !dismissible ? () => {} : () => { deleteToast(); toast.onDismiss?.(toast); }}
>
  {icons?.close ?? CloseIcon}
</button>
```
**`data-disabled` is dead-but-must-preserve:** because the button's own render guard
already excludes `toastType === 'loading'`, and `disabled` is defined as exactly that same
condition, `data-disabled="true"` can **never** actually appear on this button in the live
DOM — port the attribute binding literally anyway (compute it from `disabled`), don't
special-case it away.

`icons?.close ?? CloseIcon` uses **`??`, not `||`** — an explicit `icons.close = null`
still falls back to the built-in `CloseIcon` (both `null` and `undefined` are "nullish").
There's no way to render an empty close button via this prop; only override its content.
Apply the same one-shot thunk-invocation as icon (§5.9) before this fallback chain, per the
`ToastIcons` widening.

`closeButtonAriaLabel` resolution: `Toast`'s own destructure default (`= 'Close toast'`)
applies whenever the incoming prop is `undefined`. The incoming prop is
`toastOptions?.closeButtonAriaLabel` — there is **no top-level `ToasterProps` field** for
this and **no per-toast `ToastT` field** either; the only override point is
`toastOptions.closeButtonAriaLabel`.

---

## 6. Cancel and action buttons — the discriminant, and the asymmetries

### 6.1 Source logic
```tsx
{React.isValidElement(toast.cancel) ? toast.cancel : toast.cancel && isAction(toast.cancel) ? (
  <button data-button data-cancel style={toast.cancelButtonStyle || cancelButtonStyle}
    onClick={(event) => {
      if (!isAction(toast.cancel)) return;
      if (!dismissible) return;
      toast.cancel.onClick?.(event);
      deleteToast();
    }}
    className={cn(classNames?.cancelButton, toast?.classNames?.cancelButton)}
  >{toast.cancel.label}</button>
) : null}

{React.isValidElement(toast.action) ? toast.action : toast.action && isAction(toast.action) ? (
  <button data-button data-action style={toast.actionButtonStyle || actionButtonStyle}
    onClick={(event) => {
      if (!isAction(toast.action)) return;
      toast.action.onClick?.(event);
      if (event.defaultPrevented) return;
      deleteToast();
    }}
    className={cn(classNames?.actionButton, toast?.classNames?.actionButton)}
  >{toast.action.label}</button>
) : null}
```

### 6.2 `isAction(x)` and the "bare string renders nothing" gap in source

`isAction(x) = x.label !== undefined`. Combined with `React.isValidElement(x)`, source
supports exactly two shapes: a rendered React element (pass through as-is) or an
`Action`-shaped object (render internal button). **A bare string/number passed as
`cancel`/`action` matches neither branch and silently renders nothing** — `isValidElement`
is false for primitives, and `isAction` is false too (`'foo'.label === undefined`). This is
a real gap in the shipped React library's type-vs-implementation, not an intentional
feature.

### 6.3 Deliberate deviation applied here (cross-referenced from `state-api-spec.md` §1.5)

`state-api-spec.md` §1.5 records that ARCHITECTURE.md directs `action`/`cancel` to be typed
`Action | Renderable | (() => Renderable)`. Applying that type honestly means the render
logic needs a **third** branch for "a `Renderable` that is neither an `Action` object nor a
`VNode`" (raw strings/numbers) — otherwise the widened type would silently promise
behavior (render a string as a cancel button's neighbor) that the component wouldn't
deliver, reproducing the exact React gap in §6.2 even though the type no longer describes
it.

**This spec's resolution — applied consistently, not re-decided per call site:**
```ts
function resolveActionSlot(value: Action | Renderable | (() => Renderable) | undefined | null) {
  if (value == null) return { kind: 'none' } as const;
  const resolved = typeof value === 'function' && !isVNode(value) ? value() : value;
  if (resolved != null && typeof resolved === 'object' && !isVNode(resolved) && 'label' in resolved && (resolved as Action).label !== undefined) {
    return { kind: 'action', action: resolved as Action } as const;
  }
  return { kind: 'node', node: resolved as Renderable } as const;   // VNode OR string/number — renderNode() handles both
}
```
- `kind: 'action'` → render the internal `<button data-button data-cancel|data-action>`.
- `kind: 'node'` → render via the shared `renderNode()` helper (passthrough for VNodes,
  text-node rendering for strings/numbers) — **this is where behavior intentionally
  diverges from source**, which would render nothing for a bare string. Document this
  divergence in the changelog/README since it's a user-visible behavior improvement over
  upstream sonner for this one edge case.
- **This divergence is recorded again in `openQuestions`** below — it's a direct
  consequence of a type decision this spec doesn't own, so final sign-off belongs to the
  orchestrator, not this document.

### 6.4 Style precedence
`style={toast.cancelButtonStyle || cancelButtonStyle}` / `toast.actionButtonStyle ||
actionButtonStyle` — `||`, per-toast wins if truthy (style objects are always truthy when
present, so this behaves like `??` in practice for this specific type, but port the literal
operator). `cancelButtonStyle`/`actionButtonStyle` (the toaster-level fallback) come
**only** from `toastOptions.cancelButtonStyle`/`toastOptions.actionButtonStyle` — no direct
top-level `ToasterProps` fields for these.

### 6.5 `data-button` / `data-cancel` / `data-action` — bare JSX attribute stringification

These are written bare in JSX (`data-button`, no `={...}`), which is React sugar for
`={true}`. **Empirically verified this session** (see §9.1): React's custom-attribute path
stringifies `true` to the literal string `"true"` — it does **not** use the empty-string-
for-`true` convention reserved for recognized HTML boolean attributes (`disabled`,
`checked`, etc.). So these render as `data-button="true" data-cancel="true"` (or
`data-action="true"`), not `data-button=""`. Vue 3's real DOM attribute patcher was also
verified this session to behave identically for `data-*` names (they aren't in Vue's
internal "special boolean attribute" list either) — so `:data-button="true"` /
`data-button="true"` as a static attribute in the Vue template produces the same
`data-button="true"` output with zero special handling required. (CSS only ever uses
presence-selectors — `[data-button]`, `[data-cancel]` — for these, so this distinction is
inert for styling purposes, but matters if any DOM-snapshot-diffing test asserts exact
attribute values.)

### 6.6 THE asymmetries — cancel vs. action vs. close, `dismissible` handling

| | checks `dismissible`? | checks `event.defaultPrevented`? | calls `toast.onDismiss`? |
|---|---|---|---|
| Close button | yes (`disabled \|\| !dismissible` → no-op onClick) | n/a | yes |
| Cancel button | **yes** (`if (!dismissible) return;`, inside the handler, after `isAction` check) | **no** | **no** |
| Action button | **no dismissible check at all** | **yes** (`if (event.defaultPrevented) return;`) | **no** |

**The action button ignores `toast.dismissible === false` entirely** — it will always fire
its `onClick` and (barring `preventDefault()`) always call `deleteToast()`, even on a
non-dismissible toast. This is very likely unintentional upstream but must be preserved —
Playwright tests may assert on it. The cancel button *does* respect `dismissible`, but only
as a guard inside the click handler (the button itself still renders and is clickable/
focusable even when non-dismissible; only the dismiss-triggering side effect is skipped).
Native `event.defaultPrevented` reads through unchanged in Vue (real `MouseEvent`, no
synthetic wrapper) — no special handling needed for that check.

---

## 7. `useSonner` — target `src/hooks.ts` per ARCHITECTURE.md

Defined in React at `index.tsx` lines 552–591, **not** in `hooks.tsx`. Per
`state-api-spec.md` §3.3, the Vue port relocates this into `src/hooks.ts` alongside
`useIsDocumentHidden`. It is a **standalone composable a consumer can call directly**
(e.g. to build a fully custom toast renderer) — it does not feed `Toaster`/`Toast` and
`Toaster` does not call it; it is a completely independent subscriber to `ToastState`.

```ts
function useSonner() {
  const [activeToasts, setActiveToasts] = React.useState<ToastT[]>([]);

  React.useEffect(() => {
    return ToastState.subscribe((toast) => {
      if ((toast as ToastToDismiss).dismiss) {
        setTimeout(() => {
          ReactDOM.flushSync(() => {
            setActiveToasts((toasts) => toasts.filter((t) => t.id !== toast.id));
          });
        });
        return;
      }
      setTimeout(() => {
        ReactDOM.flushSync(() => {
          setActiveToasts((toasts) => {
            const indexOfExistingToast = toasts.findIndex((t) => t.id === toast.id);
            if (indexOfExistingToast !== -1) {
              return [...toasts.slice(0, indexOfExistingToast), { ...toasts[indexOfExistingToast], ...toast }, ...toasts.slice(indexOfExistingToast + 1)];
            }
            return [toast, ...toasts];
          });
        });
      });
    });
  }, []);   // mount-once, unlike Toaster's own analogous effect (§8.4.1) which resubscribes on every `toasts` change

  return { toasts: activeToasts };
}
```
- Subscribes **once**, empty deps — cleanly `onMounted`/`onUnmounted` in Vue, no `watch`
  needed (contrast with `Toaster`'s own near-identical subscribe effect, which has `[toasts]`
  deps — see §8.4.1's note on why that's almost certainly vestigial, evidenced by this
  sibling implementation of the same pattern using `[]`).
  - **Dismiss branch**: on `{id, dismiss:true}`, **removes** the matching toast from
    `activeToasts` entirely (`.filter`), deferred one macrotask out (`setTimeout`) then
    force-flushed (`flushSync`). Contrast with `Toaster`'s own analogous branch, which
    *marks* `.delete = true` instead of removing (§8.4.1) — `useSonner` has no exit
    animation to run, so it just drops the entry immediately once the macrotask fires.
  - **Add/update branch**: identical merge-or-prepend shape to `Toaster`'s own (§8.4.1
    branch 2) — existing toast (by id) gets `{...old, ...new}` merged in place (array
    position preserved); new toast is prepended (`[toast, ...toasts]`).
- Returns `{ toasts: activeToasts }` — an object wrapper, not the array directly (matches
  the public API shape `const { toasts } = useSonner()`).
- **Independent instance per call** — if both a `<Toaster/>` and a separate `useSonner()`
  call exist in the same app, each gets its own `ToastState.subscribe` registration and its
  own local `activeToasts` array; they do not share state (they both mirror the same
  underlying `ToastState`, but as two independent read-projections).
- Relationship to `Observer.getActiveToasts()`/`toast.getToasts()` (owned by
  `state-api-spec.md` §2.11): **not called by `useSonner` at all.** `useSonner` builds its
  own reactive local copy via the subscribe stream from scratch; `getActiveToasts()` is a
  synchronous point-in-time snapshot method on the `Observer` singleton, used by
  `toast.getToasts()`, unrelated to this hook's reactive state. Don't conflate the two when
  porting — `useSonner`'s `activeToasts` and `toast.getToasts()`'s result are computed via
  entirely different code paths and are not guaranteed to be in sync at every instant
  (the hook's `setTimeout`-deferred updates mean there's a window where they could differ).

**Vue mapping — apply the same `setTimeout`-without-`flushSync` simplification argued in
§8.4.1**, since the underlying reasoning (Vue's per-macrotask microtask-flush model doesn't
need an explicit flush-forcing API the way React 18's automatic batching does) applies
identically here:
```ts
// src/hooks.ts
export function useSonner() {
  const activeToasts = ref<ToastT[]>([]);
  let unsubscribe: (() => void) | undefined;

  onMounted(() => {
    unsubscribe = ToastState.subscribe((toast) => {
      if ((toast as ToastToDismiss).dismiss) {
        setTimeout(() => {
          activeToasts.value = activeToasts.value.filter((t) => t.id !== toast.id);
        });
        return;
      }
      setTimeout(() => {
        const idx = activeToasts.value.findIndex((t) => t.id === toast.id);
        if (idx !== -1) {
          activeToasts.value = [...activeToasts.value.slice(0, idx), { ...activeToasts.value[idx], ...toast }, ...activeToasts.value.slice(idx + 1)];
        } else {
          activeToasts.value = [toast as ToastT, ...activeToasts.value];
        }
      });
    });
  });
  onUnmounted(() => unsubscribe?.());

  return { toasts: activeToasts };   // note: caller reads `.toasts.value`, one extra layer of Ref-unwrapping vs React
}
```
Flag for the consumer-facing docs: `const { toasts } = useSonner()` in Vue yields `toasts`
as a `Ref<ToastT[]>` (must be accessed as `toasts.value` or auto-unwrapped in a template),
not a plain array as in React — an unavoidable, expected framework difference, not a
parity bug.

---

## 8. `Toaster` component — full spec

### 8.1 Props (destructured, lines 594–615) — full defaults table

| prop | default | notes |
|---|---|---|
| `id` | — (`undefined`) | scopes which toasts this Toaster renders, see §8.2 |
| `invert` | — | → `Toast`'s `invert` (aliased `ToasterInvert`) |
| `position` | `'bottom-right'` | default group position |
| `hotkey` | `['altKey', 'KeyT']` | **new array literal every render if relying on this default** — React-specific churn concern, see §8.4.3 boxed note |
| `expand` | — (`undefined`) | → `Toast`'s `expandByDefault` |
| `closeButton` | — | → `Toast`'s `closeButtonFromToaster` (via `toastOptions?.closeButton ?? closeButton`) |
| `className` | — | **only reaches the `<ol>`**, never the `<li>` |
| `offset` | — | → `assignOffset` |
| `mobileOffset` | — | → `assignOffset` |
| `theme` | `'light'` | drives `actualTheme` |
| `richColors` | — | → `Toast`'s `defaultRichColors` |
| `duration` | — | → `Toast`'s `durationFromToaster` (via `toastOptions?.duration ?? duration`) |
| `style` | — | **only reaches the `<ol>`**, never the `<li>` |
| `visibleToasts` | `VISIBLE_TOASTS_AMOUNT` (3) | → `Toast`'s `visibleToasts` |
| `toastOptions` | — | object; every field of it flows to `Toast` individually, see §8.8 |
| `dir` | `getDocumentDirection()` | default-param, re-evaluated every render if prop unset — see §8.6 dir handling |
| `gap` | `GAP` (14) | → `Toast`'s `gap`, and `<ol>`'s `--gap` |
| `icons` | — | → `Toast`'s `icons`, unfiltered |
| `customAriaLabel` | — | overrides the computed aria-label entirely if set |
| `containerAriaLabel` | `'Notifications'` | combined with `hotkeyLabel` for the default aria-label |

### 8.2 State
| name | initial | Vue mapping |
|---|---|---|
| `toasts` | `[]` (`ToastT[]`) | `ref<ToastT[]>([])` |
| `heights` | `[]` (`HeightT[]`) | `ref<HeightT[]>([])` — the single shared source of truth, see §5.5.3's boxed warning |
| `expanded` | `false` | `ref(false)` |
| `interacting` | `false` | `ref(false)` |
| `actualTheme` | computed once, see below | `ref<'light'\|'dark'>` |

`actualTheme` initial value:
```ts
theme !== 'system'
  ? theme
  : typeof window !== 'undefined'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : 'light';
```
SSR-safe fallback to `'light'` when `window` is undefined and `theme === 'system'`.

### 8.3 Refs
- `listRef` (`HTMLOListElement`) — **shared across every rendered `<ol>`** (one per
  position group). Because it's the *same* ref object assigned via `ref={listRef}` on
  each mapped `<ol>`, only the **last-rendered** position group's DOM node ends up stored
  in `listRef.current` — earlier groups' assignments get overwritten by later ones in the
  same render pass. **This is a real, observable quirk to preserve, not fix:** the hotkey
  handler's `listRef.current?.focus()`, the Escape-key's `document.activeElement ===
  listRef.current` check, and the unmount-focus-restore effect's `if (listRef.current)`
  guard **only ever functionally engage the last position group in `possiblePositions`**
  when more than one position is simultaneously active. **This does NOT affect
  `onFocus`/`onBlur`/`onMouseEnter`/`onMouseMove`/`onMouseLeave`/`onDragEnd`/
  `onPointerDown`/`onPointerUp`** — those are ordinary JSX event props bound independently
  to *each* rendered `<ol>` element regardless of the shared-ref quirk; every position
  group's own mouse/focus/pointer interactions work correctly and independently. Only
  code paths that read `listRef.current` are affected.
  - Vue mapping: a Vue template ref used inside `v-for` naturally becomes an **array** of
    all matched elements (`useTemplateRef` + `v-for` populates a ref array, or manual
    `ref="listRef"` inside `v-for` populates `instance.$refs.listRef` as an array) —
    **this is a different default behavior than React's single-overwritten-ref quirk.** To
    reproduce React's exact "only the last one wins" behavior, do **not** rely on Vue's
    automatic array-collection; instead bind each `<ol>`'s ref via a callback
    (`:ref="(el) => { listRef.value = el }"`, invoked once per rendered `<ol>` in loop
    order) so the final call in iteration order is what remains in `listRef.value`,
    mirroring React's overwrite-by-last-render behavior exactly.
- `lastFocusedElementRef` (`HTMLElement | null`)
- `isFocusWithinRef` (`boolean`, initial `false`)

### 8.4 Effects, callbacks, in source order

#### 8.4.1 `removeToast` callback
```ts
const removeToast = useCallback((toastToRemove: ToastT) => {
  setToasts((toasts) => {
    if (!toasts.find((toast) => toast.id === toastToRemove.id)?.delete) {
      ToastState.dismiss(toastToRemove.id);
    }
    return toasts.filter(({ id }) => id !== toastToRemove.id);
  });
}, []);
```
Reads the toast's *current* `.delete` flag (via the functional-setState form, guaranteeing
freshness) to decide whether `ToastState.dismiss(id)` still needs to be called: if `.delete`
is already `true`, it means this removal was triggered via the `toast.delete` effect path
(§5.5.7), which only happens after `ToastState.dismiss` already ran upstream (adding to
`dismissedToasts`, publishing `{id, dismiss:true}`) — calling it again here would be a
redundant/duplicate publish to all subscribers. If `.delete` is *not* already true (natural
timer expiry, swipe dismiss, close/cancel/action button click — none of those set
`.delete` on the toast object, they call `deleteToast()` directly), this is the **first**
notification to `ToastState`, so it must fire here to keep `Observer.dismissedToasts` (and
any other subscriber, e.g. a separate `useSonner()` call elsewhere) in sync. Regardless of
branch, the toast is unconditionally spliced out of `Toaster`'s own `toasts` array,
unmounting the `<li>`.

Vue: plain function, no `useCallback`-equivalent memoization needed.

#### 8.4.2 Main `ToastState.subscribe` effect
```ts
useEffect(() => {
  return ToastState.subscribe((toast) => {
    if ((toast as ToastToDismiss).dismiss) {
      requestAnimationFrame(() => {
        setToasts((toasts) => toasts.map((t) => (t.id === toast.id ? { ...t, delete: true } : t)));
      });
      return;
    }
    setTimeout(() => {
      ReactDOM.flushSync(() => {
        setToasts((toasts) => {
          const indexOfExistingToast = toasts.findIndex((t) => t.id === toast.id);
          if (indexOfExistingToast !== -1) {
            return [...toasts.slice(0, indexOfExistingToast), { ...toasts[indexOfExistingToast], ...toast }, ...toasts.slice(indexOfExistingToast + 1)];
          }
          return [toast, ...toasts];
        });
      });
    });
  });
}, [toasts]);
```
**Dismiss branch differs from `useSonner`'s (§7): here the toast is *marked* `delete: true`
via `.map()` (stays in the array), not removed — because `Toast`'s own effect (§5.5.7)
needs to observe `toast.delete` flipping true to kick off `deleteToast()`'s exit-animation
sequence.** Deferred via `requestAnimationFrame` (not `setTimeout`+`flushSync` — no
force-sync-commit needed here, just "run on the next frame, letting other pending
synchronous updates settle first" per the source comment "Prevent batching of other state
updates").

**Add/update branch**: deferred via bare `setTimeout(fn)` (0ms) wrapped in
`ReactDOM.flushSync(...)`. `flushSync` forces React to apply this state update and
re-render **synchronously**, bypassing React 18's automatic batching — without it,
multiple toasts fired in a tight synchronous loop (e.g. `for (...) toast(...)`) could have
their subscription callbacks' `setTimeout`s all queued in the same macrotask-processing
pass and their resulting `setState` calls **batched into one combined re-render**, which
would break the per-toast "not yet mounted → mounted" entrance-animation sequencing this
whole file is built around (each toast needs its own distinct "before" paint).

**Vue mapping — no `flushSync`-equivalent needed, this is a genuine simplification, not
just a syntactic translation:** Vue's reactivity scheduler flushes pending updates via a
microtask (promise-based `nextTick` queue). Because each subscription callback here is
*already* wrapped in its own `setTimeout(fn, 0)`, and JS guarantees that **all pending
microtasks drain completely before the next macrotask begins**, by the time any *second*
`setTimeout` callback (for a second toast fired in the same synchronous loop) actually
runs, Vue will have *already* flushed and committed the *first* toast's DOM update — no
special forcing API is required. (React needs `flushSync` here specifically because React
18's automatic batching persists updates across microtask boundaries in a way plain
`setTimeout`-deferral alone doesn't escape; Vue's scheduler has no equivalent
cross-macrotask batching to escape from.) **Recommended Vue implementation:**
```ts
watch(toasts, () => {} ) // OR, simpler and recommended — see next paragraph
```
Given the `[toasts]` dependency causes this whole effect to tear down and re-subscribe to
`ToastState` on every single toast add/update/remove — and given the closure body never
actually reads the outer `toasts` variable directly (only via the functional-`setState`
form, which always receives the current value regardless of closure staleness) — **this
dependency is almost certainly vestigial**, further evidenced by `useSonner`'s nearly
identical sibling implementation (§7) using `[]` (subscribe once) for the same pattern.
**Recommendation: implement as a single `onMounted`/`onUnmounted` subscribe-once pair in
Vue**, not a `watch`-driven resubscribe-on-every-change. The only theoretical behavioral
difference this could produce is subscriber-list-*ordering* churn inside `ToastState`
(each React resubscribe moves this listener to the end of `Observer.subscribers`), which
only matters if multiple simultaneous subscribers' *relative* callback-invocation order is
externally observable — not the case for a single `<Toaster/>` instance, and not something
any of sonner's own tests are likely to assert on. Flagged here explicitly as a considered
simplification, not a silent behavior change: if strict literal fidelity is later required,
swap the `onMounted`/`onUnmounted` pair for a `watch(toasts, (fn), {...})`-driven
re-subscribe with the same setup/cleanup body.

Merge/prepend semantics (identical shape to `useSonner`'s add/update branch, §7): existing
toast (found by id) → `{...old, ...new}` spliced in at the **same array index** (position
preserved); new toast → **prepended** to the front (`[toast, ...toasts]`, so index 0 is
always the most-recently-added-or-updated toast in `Toaster`'s own array — this newest-
first ordering is what makes `index === 0` mean "front toast" throughout the rest of the
file).

#### 8.4.3 Theme effect
```ts
useEffect(() => {
  if (theme !== 'system') {
    setActualTheme(theme);
    return;
  }
  if (theme === 'system') {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setActualTheme('dark');
    } else {
      setActualTheme('light');
    }
  }
  if (typeof window === 'undefined') return;
  const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  try {
    darkMediaQuery.addEventListener('change', ({ matches }) => {
      setActualTheme(matches ? 'dark' : 'light');
    });
  } catch (error) {
    darkMediaQuery.addListener(({ matches }) => {
      try {
        setActualTheme(matches ? 'dark' : 'light');
      } catch (e) {
        console.error(e);
      }
    });
  }
}, [theme]);
```
- `theme !== 'system'` → sync `actualTheme` to the literal prop value and **return early**
  — no listener is attached/kept for non-`'system'` themes (any previously-attached
  listener from a prior `'system'` run is **not** cleaned up by this early return either,
  see next point).
- **No cleanup function is returned from this effect at all.** Every time this effect
  re-runs with `theme === 'system'` (i.e. every time the `theme` prop changes and lands on
  `'system'` again, or — less commonly — every remount), a **new** `'change'` listener is
  attached to a **new** `MediaQueryList` object via `window.matchMedia(...)` (a fresh
  object each call, not cached), and the old listener(s) on old `MediaQueryList` objects
  are simply leaked/orphaned (though harmless in practice since old `MediaQueryList`
  objects become unreferenced and garbage-collectable once nothing holds them — the
  *listener* itself only leaks if something still holds a reference to that specific
  `MediaQueryList` instance, which nothing does after the effect re-runs). **This is a
  genuine bug/oversight in sonner (no `removeEventListener` cleanup), but per
  ARCHITECTURE.md's "identical behavior" hard requirement, port it as-is — do not add a
  cleanup function that source doesn't have.** This is exactly the kind of thing a
  well-meaning implementer instinctively "fixes"; flagging prominently so nobody does.
- Legacy fallback: `try { addEventListener } catch { addListener }` for Safari < 14, with
  an inner `try/catch` around the `addListener` callback body logging via
  `console.error(e)`. Port verbatim, including the nested try/catch and the `console.error`
  call — this is dead code in any evergreen browser but must be structurally present for
  fidelity (harmless either way since `addEventListener` exists everywhere sonner targets
  today).

Vue mapping: `watch(() => props.theme, (theme) => { ...identical body... }, { immediate: true })`. Given the "no cleanup" instruction above, this is a rare case where a Vue `watch` should **not** use `onWatcherCleanup`/return a cleanup function — deliberately, to match source. Note this explicitly in the implementation with a comment citing this spec section, so a future contributor doesn't "helpfully" add the missing `removeEventListener`.

#### 8.4.4 Auto-collapse effect
```ts
useEffect(() => {
  if (toasts.length <= 1) setExpanded(false);
}, [toasts]);
```
Runs on every `toasts` (Toaster's own state) change; forces `expanded` back to `false`
whenever the toast count drops to 0 or 1. Vue: `watch(toasts, (t) => { if (t.length <= 1) expanded.value = false; })`.

#### 8.4.5 Global keydown effect (hotkey + Escape)
```ts
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    const isHotkeyPressed = hotkey.length > 0 && hotkey.every((key) => (event as any)[key] || event.code === key);
    if (isHotkeyPressed) {
      setExpanded(true);
      listRef.current?.focus();
    }
    if (event.code === 'Escape' && (document.activeElement === listRef.current || listRef.current?.contains(document.activeElement))) {
      setExpanded(false);
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [hotkey]);
```
- `hotkey.every((key) => event[key] || event.code === key)` — for each string in the
  `hotkey` array, satisfied if either the KeyboardEvent's same-named boolean property is
  truthy (dynamic property access — in practice only `altKey`/`ctrlKey`/`shiftKey`/
  `metaKey` exist as real boolean props on `KeyboardEvent`) **or** `event.code` literally
  equals that string. `.every(...)` requires **all** entries to match the **same** event —
  since `event.code` can only equal one value per event, a `hotkey` array with two
  different `code`-style entries (e.g. `['KeyA', 'KeyB']`) could never both match on a
  single keydown and would be permanently unusable — not a bug to fix, just a real design
  constraint of this matching scheme, worth documenting.
  - Default `hotkey.join('+').replace(/Key/g,'').replace(/Digit/g,'')` (see `hotkeyLabel`,
    §8.6) for `['altKey','KeyT']` → `'altKey+KeyT'` → strip `'Key'` (both occurrences,
    including the one inside `'altKey'` itself) → `'alt+T'`. So default `hotkeyLabel =
    'alt+T'`, and default aria-label = `'Notifications alt+T'`.
- On hotkey match: `setExpanded(true)` **and** focuses `listRef.current` — subject to the
  shared-ref-only-last-position-wins quirk (§8.3).
- Escape: collapses **only if** focus is currently on or within the (last-position-group's)
  list — checked via `document.activeElement`.

> **Vue-specific note on `hotkey`'s referential stability (a real, documented positive
> divergence, not something to work around):** React's default-parameter `hotkey =
> ['altKey', 'KeyT']` creates a **new array literal on every single render** when the
> caller doesn't pass the prop explicitly — meaning the `useEffect(..., [hotkey])` above
> tears down and re-attaches the global `keydown` listener on *every* re-render of
> `Toaster` (any state change: toasts added, theme flipped, `expanded` toggled, etc.), not
> just when the hotkey conceptually changes. Vue's prop-default mechanism (a factory
> function passed to `withDefaults`/`defineProps`) is documented to **cache** the
> factory-produced default value **per component instance**, reusing the same array
> reference across re-renders unless the prop is explicitly supplied and changes. This
> means a Vue `watch(() => props.hotkey, setupListener, {immediate:true})` will **not**
> exhibit React's tear-down/re-attach-every-render churn — it naturally behaves as if the
> effect had a stable, real dependency. The **externally observable** behavior (a working
> global hotkey listener) is identical either way; this is flagged purely so the
> implementer understands *why* a literal `watch`-based port won't churn the way the React
> version does, and doesn't mistake that for a missed-parity bug.

Vue mapping: `onMounted` + `onUnmounted` for a single stable listener is the simplest
correct port (given the above, a `watch` isn't even necessary for correctness unless the
app dynamically changes `hotkey` at runtime post-mount, in which case a `watch(() =>
props.hotkey, ..., {immediate:true})` with cleanup is the fully-faithful choice).

#### 8.4.6 Unmount focus-restore effect
```ts
useEffect(() => {
  if (listRef.current) {
    return () => {
      if (lastFocusedElementRef.current) {
        lastFocusedElementRef.current.focus({ preventScroll: true });
        lastFocusedElementRef.current = null;
        isFocusWithinRef.current = false;
      }
    };
  }
}, [listRef.current]);
```
Dependency on a ref's `.current` value doesn't retrigger on mutation the way real reactive
state would in React (ref writes don't cause re-renders); this only conditionally
registers/re-registers based on whatever `listRef.current` happened to be *at render time*
when compared against the previous render's captured value. In practice, the only
externally-meaningful moment this fires is **`Toaster` unmounting entirely** while focus
was left inside the list (as opposed to §5.8's `onBlur` handler, which handles focus simply
*moving away* while `Toaster` stays mounted). **Vue simplification recommended:** a plain
`onUnmounted(() => { if (lastFocusedElementRef.value) { lastFocusedElementRef.value.focus({preventScroll:true}); lastFocusedElementRef.value = null; isFocusWithinRef.value = false; } })` reproduces the only observable real-world effect of this pattern without replicating React's fragile per-render conditional-cleanup-registration mechanic (which has no clean Vue equivalent and no behavioral payoff worth chasing).

### 8.5 Focus handlers on each `<ol>` (bound per-element, unaffected by the shared-`listRef` quirk)

```ts
onBlur={(event) => {
  if (isFocusWithinRef.current && !event.currentTarget.contains(event.relatedTarget)) {
    isFocusWithinRef.current = false;
    if (lastFocusedElementRef.current) {
      lastFocusedElementRef.current.focus({ preventScroll: true });
      lastFocusedElementRef.current = null;
    }
  }
}}
onFocus={(event) => {
  const isNotDismissible = event.target instanceof HTMLElement && event.target.dataset.dismissible === 'false';
  if (isNotDismissible) return;
  if (!isFocusWithinRef.current) {
    isFocusWithinRef.current = true;
    lastFocusedElementRef.current = event.relatedTarget as HTMLElement;
  }
}}
```
- `onFocus`: reads `event.target.dataset.dismissible` — the DOM `data-dismissible`
  attribute (confirmed always literally `"true"`/`"false"` per §9.1) off whichever element
  *within the list* actually received focus (the `<li>` itself, tabIndex 0, or a nested
  button). If that element is explicitly non-dismissible, **skip** capturing
  `lastFocusedElementRef`/flipping `isFocusWithinRef` — focusing into a non-dismissible
  toast is deliberately not treated as "entering" the list for restore-focus purposes.
  `isFocusWithinRef` gates so only the **first** focus-entry-from-outside captures
  `event.relatedTarget` (the element that had focus immediately prior) — subsequent
  Tab-driven focus moves *within* the list don't keep overwriting it.
- `onBlur`: only restores focus if we were tracked as focus-within **and** the element
  gaining focus (`event.relatedTarget`) is **not** contained within this `<ol>`
  (`event.currentTarget`) — i.e. focus is genuinely leaving the list, not just moving
  between two elements both inside it.

Also bound per-`<ol>`:
```ts
onMouseEnter={() => setExpanded(true)}
onMouseMove={() => setExpanded(true)}
onMouseLeave={() => { if (!interacting) setExpanded(false); }}
onDragEnd={() => setExpanded(false)}
onPointerDown={(event) => {
  const isNotDismissible = event.target instanceof HTMLElement && event.target.dataset.dismissible === 'false';
  if (isNotDismissible) return;
  setInteracting(true);
}}
onPointerUp={() => setInteracting(false)}
```
`onMouseLeave`'s guard (`if (!interacting)`) is what prevents the list from collapsing
mid-swipe-gesture (swiping a toast counts as `interacting`, set via the `<ol>`'s own
`onPointerDown` — note: **not** gated on which specific element inside was pressed beyond
the `dismissible` dataset check, so pressing down anywhere dismissible-tagged inside the
list, including a toast's own body for a swipe, sets `interacting = true` toaster-wide,
keeping the whole list expanded for the gesture's duration regardless of mouse movement).

### 8.6 `dir` resolution — two distinct evaluation points

1. **Destructure-time default:** `dir = getDocumentDirection()` as a default parameter —
   this expression **re-evaluates on every render** in which the caller does not pass a
   `dir` prop explicitly (JS default parameters re-run per invocation, not once). Because
   `getDocumentDirection()` never returns the literal `'auto'` (§2.3), this path always
   yields a concrete `'ltr'`/`'rtl'`.
2. **Render-time ternary on the `<ol>`:** `dir={dir === 'auto' ? getDocumentDirection() : dir}`
   — this branch is **only ever taken when the caller explicitly passed `dir="auto"`** as a
   `Toaster` prop (bypassing the default parameter, whose own output is never literally
   `'auto'`). In that case it re-resolves fresh, per render, to a concrete direction.

Net effect: absent an explicit `dir` prop, direction tracks the live document direction
freshly on every `Toaster` re-render (a side-effect of the unmemoized default-parameter
re-evaluation, not a deliberate reactive subscription — there's no `MutationObserver` on
`<html dir>` anywhere). Vue mapping: replicate with a `computed(() => props.dir === 'auto' ? getDocumentDirection() : (props.dir ?? getDocumentDirection()))` — since Vue `computed()` re-evaluates on every access when its render-tracked dependencies invalidate (and here there technically are none reactive, so it behaves more like "recomputed whenever the owning component re-renders for any reason," matching React's every-render-refresh characteristic close enough); do not cache/memoize this away into a one-time value, that would be a fidelity regression (document direction changes wouldn't be picked up).

### 8.7 Full render tree

```html
<section
  aria-label="{customAriaLabel ?? `${containerAriaLabel} ${hotkeyLabel}`}"
  tabIndex={-1}
  aria-live="polite"
  aria-relevant="additions text"
  aria-atomic="false"
  data-react-aria-top-layer
>
  <!-- for each position in possiblePositions: -->
  <ol
    key="{position}"
    dir="{dir === 'auto' ? getDocumentDirection() : dir}"
    tabIndex={-1}
    class="{className}"
    data-sonner-toaster
    data-sonner-theme="{actualTheme}"
    data-y-position="{y}"
    data-x-position="{x}"
    style="--front-toast-height: {heights[0]?.height || 0}px; --width: {TOAST_WIDTH}px; --gap: {gap}px; {...style}; {...assignOffset(offset, mobileOffset)}"
    onBlur onFocus onMouseEnter onMouseMove onMouseLeave onDragEnd onPointerDown onPointerUp
  >
    <!-- for each toast in filteredToasts where (!toast.position && index===0) || toast.position===position: -->
    <Toast key="{toast.id}" .../>
  </ol>
</section>
```

**`possiblePositions` computation:**
```ts
const possiblePositions = useMemo(() => {
  return Array.from(new Set([position].concat(filteredToasts.filter((t) => t.position).map((t) => t.position))));
}, [filteredToasts, position]);
```
`Toaster`'s own default `position` is always first (index 0) in the resulting array (it's
unshifted into the `Set`-source before any toast-derived positions), followed by every
*distinct* explicit `.position` value currently present among `filteredToasts`, in first-
encountered order. A position disappears from this list once no toast in `filteredToasts`
carries it anymore (recomputed fresh every render from the current array) — **except**
`Toaster`'s own default `position`, which is unconditionally always present regardless of
whether any toast currently uses it.

**Per-position render guard — a real, surprising cross-position coupling, preserve exactly:**
```ts
{possiblePositions.map((position, index) => {
  const [y, x] = position.split('-');
  if (!filteredToasts.length) return null;
  return <ol>...</ol>;
})}
```
The guard checks `filteredToasts.length` **globally** (any position, any count), **not**
whether *this specific* position currently has any toasts. Consequence: **as long as at
least one toast exists anywhere (in any position), `Toaster`'s own default position group
always renders its `<ol>` — even if zero toasts currently belong to that default position**,
because the default `position` is always index 0 of `possiblePositions` per the derivation
above. E.g.: an app with toasts *only* ever fired at `'top-left'` will still have an empty
`<ol data-sonner-toaster data-y-position="bottom" data-x-position="right">` (assuming
default `'bottom-right'`) sitting in the DOM with zero `<li>` children, for as long as any
toast exists anywhere. **This is not something to "fix" by scoping the guard per-position**
— a naive-but-reasonable-looking correction would break DOM parity with source.

Inner toast filter for a given `<ol>`: `filteredToasts.filter((toast) => (!toast.position &&
index === 0) || toast.position === position)` — untagged (`.position` unset) toasts are
bucketed into whichever position group is at `possiblePositions` index 0 (always the
default `position`, per above), *not* into every group or by any other rule. Tagged toasts
go strictly to their own matching group.

**`--front-toast-height` — cross-position coupling, preserve exactly:**
`${heights[0]?.height || 0}px` reads `heights[0]` from `Toaster`'s **full, unfiltered**
`heights` state — **not** the per-position-filtered subset. Every rendered `<ol>` (for
every position group) gets this **same global value**, computed from whichever toast
currently happens to occupy index 0 of the shared array (generally, per the prepend-on-
mount pattern, the most recently mounted toast *across the whole Toaster*, regardless of
which position it belongs to). **If multiple position groups are simultaneously active
(e.g. toasts at both `'top-left'` and `'bottom-right'`), both `<ol>`s' `--front-toast-height`
are driven by the same cross-position value.** This looks like a bug (one would expect
each position group to size itself off its own front toast) but must be ported as-is —
flag prominently, do not scope this per-position "for correctness."

### 8.8 Full prop pass-down table, `Toaster` → each `<Toast>`

```tsx
<Toast
  key={toast.id}
  icons={icons}
  index={index}                                  // index WITHIN this filtered/position-scoped .map, not filteredToasts overall
  toast={toast}
  defaultRichColors={richColors}
  duration={toastOptions?.duration ?? duration}
  className={toastOptions?.className}
  descriptionClassName={toastOptions?.descriptionClassName}
  invert={invert}
  visibleToasts={visibleToasts}
  closeButton={toastOptions?.closeButton ?? closeButton}
  interacting={interacting}
  position={position}                            // the GROUP's position (this <ol>'s), always
  style={toastOptions?.style}
  unstyled={toastOptions?.unstyled}
  classNames={toastOptions?.classNames}
  cancelButtonStyle={toastOptions?.cancelButtonStyle}
  actionButtonStyle={toastOptions?.actionButtonStyle}
  closeButtonAriaLabel={toastOptions?.closeButtonAriaLabel}
  removeToast={removeToast}
  toasts={filteredToasts.filter((t) => t.position == toast.position)}   // loose ==, scoped to THIS toast's own .position (may differ from the group `position` for edge cases, though normally identical)
  heights={heights.filter((h) => h.position == toast.position)}          // loose ==, same scoping
  setHeights={setHeights}                          // the RAW, unfiltered setter — see §5.5.3 boxed warning
  expandByDefault={expand}
  gap={gap}
  expanded={expanded}
  swipeDirections={props.swipeDirections}           // read off raw `props`, not destructured — Toaster's own top-level prop
/>
```
Note `toasts`/`heights` here filter by `t.position == toast.position` (the **individual
mapped toast's own** `.position`, via loose equality so `undefined == undefined` also
matches), which is subtly different in wording from — but in every real case equal to —
filtering by the enclosing `<ol>`'s group `position` string, since a toast only ever
appears inside the group its own `.position` (or the default-group fallback) resolves to.

---

## 9. Cross-cutting concerns

### 9.1 `data-*` attribute stringification — empirically verified, no Vue trap

Ran both frameworks in this sandbox against an identical vnode with `data-*` props set to
`true`, `false`, `''`, `undefined`, `null`:

**React (`react-dom/server`, `renderToStaticMarkup`):**
```html
<div data-button="true" data-cancel="true" data-bool-true="true" data-bool-false="false" data-empty-str=""></div>
```
(`data-undef`/`data-null` omitted entirely.)

**Vue 3 (real client DOM, `createApp().mount()` under jsdom, including a reactive
`true→false→true` flip verified via `nextTick`):**
```html
<div data-button="true" data-cancel="true" data-bool-true="true" data-bool-false="false" data-mounted="true" data-empty-str=""></div>
```
Byte-identical stringification rules in both frameworks for `data-*` names specifically:
`true`/`false` → literal `"true"`/`"false"` strings (never the HTML-boolean-attribute
empty-string-for-true / omit-for-false convention — that convention is reserved for a
fixed list of recognized attributes like `disabled`/`checked`/`hidden`, which `data-*`
names are never part of in either framework); `null`/`undefined` → attribute omitted;
`''` → empty-string attribute present. **Conclusion: every `data-*` binding in this spec
can be ported as a direct `:data-foo="jsExpression"` Vue binding with zero extra
conversion logic and will match React's DOM output exactly**, including every bare-JSX
(`={true}`-implied) attribute like `data-button`, `data-cancel`, `data-action`,
`data-close-button`, `data-sonner-toast`, `data-sonner-toaster`, `data-react-aria-top-layer`.

### 9.2 React hook → Vue mechanism, consolidated timing-trap table

| React pattern | Where used | Vue mechanism | Timing note |
|---|---|---|---|
| `useState` | throughout | `ref()` | — |
| `useRef` (DOM node) | `toastRef`, `listRef` | template `ref`/`useTemplateRef` | — |
| `useRef` (mutable value, non-UI) | `dragStartTime`, `closeTimerStartTimeRef`, `lastCloseTimerStartTimeRef`, `pointerStartRef`, `offset` | plain `ref()` (or a non-reactive boxed value; reactivity is harmless overhead here) | `offset` specifically can be simplified to a `computed()`, see §5.4 |
| `useMemo` | `heightIndex`, `closeButton`, `duration`, `toastsHeightBefore`, `offset`, `filteredToasts`, `possiblePositions` | `computed()` | — |
| `useCallback` | `deleteToast`, `removeToast` | plain function | no memoization ceremony needed |
| `useEffect(fn, [])` (mount-only, deferred past paint, drives an animation flip) | §5.5.2 `setMounted(true)` | `onMounted` + **double `requestAnimationFrame`** | **TIMING TRAP — Vue's `onMounted` runs pre-paint; must explicitly defer or the entry transition won't play** |
| `useEffect(fn, [])` (mount-only, DOM measurement + cleanup, no paint-timing requirement of its own) | §5.5.3 height registration | `onMounted` + `onUnmounted` | safe as-is; recommend fusing with the above for commit-timing parity, see §5.5.2 |
| `useLayoutEffect` (pre-paint DOM read/write) | §5.5.4 content-resize sync | `watch(deps, fn, { flush: 'post' })` | matches timing naturally — Vue's `flush:'post'` is pre-paint, same as React's layout effect; **no rAF trick needed here** |
| `useEffect(fn, deps)` (teardown+setup on dep change, owns a `setTimeout`/listener) | §5.5.6 timer, §8.4.5 keydown | `watch(deps, fn, {immediate:true})` + cleanup via `onWatcherCleanup()` inside the callback (or return value) | watch `toast`/`hotkey` by **reference** (a plain getter), not `{deep:true}` |
| `useEffect(fn, deps)` (no cleanup, by omission — must NOT add one) | §8.4.3 theme/matchMedia | `watch(..., {immediate:true})` **without** a cleanup fn | deliberate source bug, preserve |
| `ReactDOM.flushSync` wrapped in `setTimeout` | §7 `useSonner`, §8.4.2 add/update branch | plain `setTimeout(fn, 0)`, **no Vue equivalent needed** | Vue's microtask-flush-per-macrotask model already guarantees this; see §8.4.2's full reasoning |
| `requestAnimationFrame` (state update, not animation) | §8.4.2 dismiss→delete-flag branch | `requestAnimationFrame(fn)` | identical API, no change |
| Shared `ref` object assigned to multiple elements in a loop (last-wins) | `listRef` across position groups | callback ref reassigned in loop order (`:ref="(el) => listRef.value = el"`), **not** Vue's default `v-for`-collects-an-array ref behavior | see §8.3 |
| `React.forwardRef` exposing a root DOM node | `Toaster`'s outer `<section>` | **no exact Vue equivalent** — see §10 open question |

### 9.3 Quirks catalogued in this spec that must be preserved verbatim (index)

1. `heightIndex`'s dead `|| 0` (can still be `-1` for one frame) — §5.4.
2. `invert` uses `||` (can't override toaster-level `true` to per-toast `false`); `richColors`/`closeButton` use `??` (can) — §5.4.
3. `duration` resolution uses `||`, so `toast.duration: 0` doesn't mean instant-dismiss — §5.4.
4. `--index`/`--toasts-before` both set to the same value — §5.7.
5. `--z-index` scoped by the individual toast's own `.position`-matching subset, not the group — §5.7.
6. `className`'s `classNames?.default` slot applies unconditionally, not just to type-less toasts — §5.7.
7. Swipe dismiss threshold is `>=45px OR velocity>0.11`, not AND — §5.8.
8. No JS-level click suppression found after a swipe gesture — §5.8 (also §10 open question).
9. `getLoadingIcon`'s two code paths use different, CSS-distinct class names (`sonner-loader` vs `sonner-loading-wrapper`) — §5.9.
10. The loading spinner DOM node stays mounted (visibility toggled via `data-visible`) for the entire lifetime of any promise-derived toast, even after it resolves — §5.9.
11. Close button's `data-disabled` can never actually be `"true"` in the live DOM given its render guard — §5.11.
12. `icons?.close ?? CloseIcon` uses `??` — an explicit `null` still falls back to the built-in icon — §5.11.
13. Action button ignores `dismissible` entirely; cancel button doesn't call `onDismiss`; only close/swipe/programmatic-dismiss call `onDismiss` — §5.6, §6.6.
14. `assignOffset` crashes on a literal `offset: null` (but not `undefined`) — §2.4.
15. `assignOffset`'s output always wins over the `style` prop for the 8 offset vars — §2.4.
16. Theme `'system'` matchMedia listener is never cleaned up — §8.4.3.
17. `listRef` is silently overwritten across multiple simultaneously-rendered position groups; only `listRef`-reading code paths are affected, not per-`<ol>` event handlers — §8.3.
18. An empty default-position `<ol>` renders whenever any toast exists anywhere, even with zero toasts of that position — §8.7.
19. `--front-toast-height` is a cross-position-coupled global value, identical across every simultaneously-rendered `<ol>` — §8.7.
20. `hotkey.every(...)` can never match a multi-`code`-entry array on a single event — §8.4.5.
21. Bare-string `action`/`cancel` renders nothing in source (Vue port deliberately diverges here per the widened `Renderable` type — §6.3, and see open questions).

---

## 10. Open questions for the orchestrator

1. **`action`/`cancel`/`icon`/`icons.*` function-thunk widening vs. source's narrower
   behavior.** `state-api-spec.md` §1.5 already flags that ARCHITECTURE.md's blanket
   "Renderable props … accept `Renderable | (() => Renderable)`" directive widens these
   props beyond what the React source's render logic actually supports (only `title`/
   `description` are ever invoked as functions in source; `icon`/`action`/`cancel`/
   `icons.*` are used as-is, with `action`/`cancel` further gated through the narrow
   `isValidElement`/`isAction` discriminant that silently drops bare strings). This spec
   (§6.3) had to make the widening's *consequence* concrete for `action`/`cancel`'s render
   logic (adding a third "passthrough via `renderNode()`" branch for non-`Action`,
   non-VNode values), which **changes an observable behavior** relative to upstream sonner
   (a bare string cancel/action, which upstream silently drops, would now render). Need
   confirmation: (a) is this three-way branch the intended shape, (b) should this
   divergence from upstream be called out in the port's README/CHANGELOG as an intentional
   improvement, and (c) does the same three-way logic apply to `icons.close`/
   `icons.loading`/`icons[type]` even though those never had an `isAction`-style
   discriminant to begin with (they're simpler — just "call if function, then render") —
   this spec assumed yes (§5.9), confirm.
2. **No click-suppression-after-swipe was found in `index.tsx`.** The task brief for this
   slice specifically asked "when are clicks suppressed after swipe" — nothing was found:
   no `preventDefault`/`stopPropagation` tied to `isSwiped`/`swipeDirection`/`swipeOut`
   state anywhere in this file. If this exists at all in real sonner, it would have to be a
   pure-CSS `pointer-events` effect (owned by `styles-spec.md`) rather than JS. Please
   confirm with the styles slice / a live sonner instance whether such suppression exists
   before assuming the Vue port needs none — if it turns out to be CSS-only, no action
   needed here, but flagging so it isn't assumed to be a JS gap that needs inventing.
3. **`React.forwardRef<HTMLElement, ToasterProps>` on `Toaster` has no exact Vue
   equivalent.** React consumers can get the raw `<section>` DOM node via `<Toaster ref={r}
   />`. In Vue 3 (`<script setup>`), a template ref on a component (`<Toaster ref="r" />`)
   yields the component's **public instance** by default, not the root DOM node directly —
   reaching the element requires either `r.value.$el` (an API-shape difference consumers
   must be told about) or an explicit `defineExpose()` that itself can't make `r.value`
   *equal* the DOM node (exposed properties are namespaced under the ref's `.value`, e.g.
   `r.value.el`, never a bare passthrough). Need a decision: accept the `.{$el|el}`
   indirection and document it as an intentional, unavoidable API difference, or explore
   whether Vue's `expose` + a wrapper pattern can flatten this further. Not decidable from
   source alone — this is a framework-capability gap, not a behavior question.
4. **`Toaster`'s main `ToastState.subscribe` effect has a `[toasts]` dependency array
   (§8.4.2) that this spec argues is vestigial** (the closure never reads the outer
   `toasts` binding directly, and the sibling `useSonner` implementation of the identical
   subscribe-and-merge pattern uses `[]`). This spec recommends porting it as a
   subscribe-once `onMounted`/`onUnmounted` pair rather than replicating the
   resubscribe-on-every-toast-change churn, since the only theoretical difference is
   `ToastState.subscribers` array ordering under multiple simultaneous subscribers, which
   is not something any known test asserts on. Flagging for confirmation since
   ARCHITECTURE.md's "identical behavior" bar is a hard requirement and this is a judgment
   call about what "identical *observable* behavior" means when the literal mechanism
   (resubscribe churn) has no external effect.

---

# Audit corrections (Opus verifier pass, authoritative — overrides anything above)

These corrections were produced by adversarially re-reading `sonner-react/src/index.tsx`,
`hooks.tsx`, `assets.tsx`, `styles.css` and `test/tests/basic.spec.ts` against this spec.
**Where a correction conflicts with the body of this document, the correction wins.**

## AC-1 (CRITICAL, breaks Playwright test 20). React `onFocus`/`onBlur` on the `<ol>` are **delegated `focusin`/`focusout`**, which bubble. Vue's `@focus`/`@blur` do NOT bubble.

§8.5 documents the `<ol>`'s `onFocus`/`onBlur` handlers but never states the Vue event-name
mapping. React (16 through 19) implements `onFocus`/`onBlur` on top of the **bubbling**
`focusin`/`focusout` events, so a handler bound to the `<ol>` fires when *any descendant*
(the `<li>`, a close/action/cancel/custom button inside it) gains or loses focus. Native
`focus`/`blur` do **not** bubble, and Vue binds native listeners verbatim.

**Required Vue binding on each `<ol>`:**
```html
<ol
  @focusin="onFocusHandler"     <!-- React's onFocus -->
  @focusout="onBlurHandler"     <!-- React's onBlur  -->
  ...
>
```
`event.target`, `event.currentTarget` (= the `<ol>`) and `event.relatedTarget` all carry the
same values on `focusin`/`focusout` as React's synthetic focus events, so the handler bodies
in §8.5 port unchanged. **Do not use `@focus`/`@blur` (or `@focus.capture`) here** — with
`@focus` the `lastFocusedElementRef` capture never happens (focus lands on a button *inside*
the toast, and the event never reaches the `<ol>`), which silently breaks the focus-restore
contract and Playwright test 20 (`return focus to the previous focused element`).

`@mouseenter` / `@mouseleave` need **no** such adaptation: native `mouseenter`/`mouseleave`
are dispatched to every newly-entered/left element in the DOM ancestor chain (the `<ol>` is
the `<li>`'s DOM ancestor even though the absolutely-positioned `<li>` escapes the `<ol>`'s
zero-height box), matching React's enter/leave polyfill exactly. `mousemove`, `pointerdown`,
`pointerup`, `pointermove` and `dragend` all bubble natively — no adaptation needed.

## AC-2 (CRITICAL, breaks Playwright test 20). §8.4.6's "Vue simplification: plain `onUnmounted`" is **wrong** — replace it.

§8.4.6 claims *"the only externally-meaningful moment this fires is `Toaster` unmounting
entirely."* That is false. The effect's dependency is `listRef.current`, and the `<ol>`
**unmounts whenever the Toaster's `filteredToasts` array becomes empty** (`if
(!filteredToasts.length) return null;`, §8.7) — i.e. every time the last toast of that
Toaster disappears, while `Toaster` itself stays mounted forever. That transition
(`listRef.current`: `<ol>` → `null`) is what fires the cleanup and restores focus.

Playwright test 20 never unmounts the `Toaster`; it dismisses the last toast while focus is
inside it and asserts focus returns to the trigger button. With the recommended
`onUnmounted`-only port, **nothing ever restores focus and test 20 fails**. (Chromium does
not fire `blur`/`focusout` when the focused element is removed from the DOM, so the §8.5
`onBlur` path does not cover this either.)

**Required Vue implementation** (keep the `listRef` callback-ref from §8.3 so `listRef.value`
becomes `null` when the last `<ol>` unmounts):
```ts
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
```
`onCleanup` runs both before the next invocation (the `<ol>` → `null` transition) **and** on
scope disposal (`Toaster` unmount), covering both cases React's version covers. Do not add a
separate `onUnmounted` doing the same thing — that would double-fire.

Consequence for §8.3's `listRef` binding: the callback ref must also write `null`
(`:ref="(el) => { listRef.value = el as HTMLOListElement | null }"`). Vue invokes a callback
ref with `null` on unmount, which is exactly the signal this watcher needs.

## AC-3 (CRITICAL, breaks Playwright test 25). Vue watcher **registration order** is load-bearing: the `duration` → `remainingTime` watcher (§5.5.1) MUST be created before the timer watcher (§5.5.6).

React flushes a component's passive effects in **declaration order**. `useEffect(() => {
remainingTime.current = duration }, [duration])` is declared at line 145; the timer effect at
line 197. So when a toast is updated with a new `duration`, `remainingTime.current` is
refreshed to the new duration *before* the timer effect tears down and re-arms with
`remainingTime.current`.

Vue runs watchers in **creation order** within a flush. If `Toast.vue` registers the timer
watcher first, an updated toast re-arms its timer with the *stale* `remainingTime` (the old
duration minus elapsed), and Playwright test 25 (`should update toast content and duration
after 3 seconds`, which updates `10000ms → 1000ms` and expects the toast gone ~1200ms later)
fails. **Register the watchers in exactly the source order of §5.5.1 → §5.5.2 → §5.5.3 →
§5.5.4 → §5.5.6 → §5.5.7, and add a code comment saying the order is load-bearing.**

## AC-4. Bare-JSX attributes stringify to `"true"`; explicitly-empty ones stay `""`. A Vue template's valueless attribute renders `=""`, not `="true"`.

§6.5/§9.1 establish that React renders a bare JSX `data-*` attribute (implicit `={true}`) as
`data-x="true"`. But §5.7/§8.7's render trees show several of these written **bare**, and a
Vue template attribute written bare renders `=""`. Exact required output:

| attribute | element | source form | required rendered value |
|---|---|---|---|
| `data-sonner-toast` | `<li>` | `data-sonner-toast=""` | `""` |
| `data-icon` | icon `<div>` | `data-icon=""` | `""` |
| `data-content` | content `<div>` | `data-content=""` | `""` |
| `data-title` | title `<div>` | `data-title=""` | `""` |
| `data-description` | description `<div>` | `data-description=""` | `""` |
| `data-close-button` | close `<button>` | bare | `"true"` |
| `data-button` | action + cancel `<button>` | bare | `"true"` |
| `data-cancel` | cancel `<button>` | bare | `"true"` |
| `data-action` | action `<button>` | bare | `"true"` |
| `data-sonner-toaster` | `<ol>` | bare | `"true"` |
| `data-react-aria-top-layer` | `<section>` | bare | `"true"` |

In a Vue SFC template write the `"true"` ones literally: `data-close-button="true"`,
`data-sonner-toaster="true"`, etc. Every selector in `styles.css` and every Playwright locator
uses presence-only matching (`[data-sonner-toaster]`), so this is cosmetic for the test suite
— but it is required by ARCHITECTURE.md's byte-identical-DOM bar.

Also in the render trees, JSX spellings that must be translated: `tabIndex={0}` → `tabindex="0"`,
`tabIndex={-1}` → `tabindex="-1"`, `className` → `class`, `key` → `:key`. React's
`suppressHydrationWarning` on the `<section>` has **no Vue equivalent — omit it entirely**
(it emits no DOM attribute in React either).

## AC-5. There is **no portal** and **no `cloneElement`** in sonner v2.0.7 — two ARCHITECTURE.md mappings are vacuous. Do not act on them.

ARCHITECTURE.md lists `ReactDOM.createPortal(…, document.body) → <Teleport to="body">` and
`cloneElement(icon, { className }) → h(icon, { class })`. Verified against the pinned source:
`index.tsx` imports `ReactDOM` **only** for `flushSync`; there is no `createPortal` call and no
`cloneElement` call anywhere in `src/`. Therefore:
- **Do NOT wrap `Toaster`'s `<section>` in `<Teleport to="body">`.** The React `Toaster`
  renders inline, exactly where the consumer places it. Teleporting would move it in DOM
  order (changing tab order and the `<section>`'s position relative to app content) —
  a silent deviation from source.
- **Do NOT inject a `class` into resolved icons.** Icons are rendered as-is
  (`{toast.type !== 'loading' ? icon : null}`). Only the `Loader` component and the custom
  `icons.loading` wrapper `<div>` receive `cn(classNames?.loader, toast?.classNames?.loader, …)`
  (§5.9). No other icon gets a class.

## AC-6. `Loader` must be **invoked as a plain function**, not mounted as a Vue component — otherwise attribute fallthrough destroys its class.

`state-api-spec.md` §4.3 defines `Loader` as `({visible, className}) => h('div', {class: 'sonner-loading-wrapper …', 'data-visible': String(visible)}, …)`. §5.9 above renders it as
`<Loader className={…} visible={…} />`. If the Vue port renders it with `h(Loader, { className, visible })`, Vue treats it as a **functional component with no declared props**: every entry
becomes both a prop *and* a fallthrough attr applied to the root element. `className` is a
real DOM property (`'className' in HTMLDivElement.prototype`), so Vue's `patchDOMProp` does
`el.className = <value>` — **overwriting `sonner-loading-wrapper`** and killing every spinner
style in `styles.css`. `visible` would also leak out as a stray `visible="true"` attribute.

**Required:** call it directly — `getLoadingIcon()` returns `Loader({ visible: toastType === 'loading', className: cn(classNames?.loader, toast?.classNames?.loader) })`, a plain `VNode`.
(Acceptable alternative: declare `Loader.props = ['visible', 'className']` **and**
`Loader.inheritAttrs = false`. The direct call is simpler and is what this spec mandates.)

## AC-7. `renderNode()` must `cloneVNode()` a stored `VNode` before rendering it.

`toast.jsx` (from `toast.custom`), `toast.icon`, `toast.action`/`cancel` when given a VNode,
and `ToastIcons.*` are **stored in module state and rendered on every re-render, potentially
by more than one `Toaster` instance simultaneously** (two `<Toaster/>`s with no `id` both
render every untagged toast — see §8.2's `filteredToasts`). React elements are immutable
descriptors and tolerate this; Vue `VNode`s carry mount state (`.el`, `.component`) and cannot
be mounted in two places at once.

**Required:** the shared `renderNode(value)` helper must do
`isVNode(v) ? (v.el ? cloneVNode(v) : v) : …` (or unconditionally `cloneVNode(v)` for VNodes —
cheap and always safe). Vue's `patch()` early-returns on `n1 === n2`, so re-rendering the same
VNode into the *same* slot is harmless; the hazard is strictly the two-Toaster / re-mount case.
The single-`Toaster` Playwright suite does not exercise it, but ARCHITECTURE.md's parity bar
does.

## AC-8. Double-rAF mount flip (§5.5.2): the background-tab caveat is benign — document it, don't work around it.

`requestAnimationFrame` does not fire in a hidden tab, so a toast created while
`document.hidden === true` stays at `data-mounted="false"` (`opacity: 0`) until the tab becomes
visible, whereas React's MessageChannel-scheduled passive effect flips it immediately. This is
**safe**: `useIsDocumentHidden()` already forces `pauseTimer()` for the whole time the document
is hidden (§5.5.6), so no toast can auto-dismiss while invisible; on tab return the rAF pair
fires and the toast animates in normally. Do **not** add a `setTimeout` fallback that races the
rAF pair — that reintroduces the "pops in with no transition" bug §5.5.2 exists to prevent.
For **Vitest/jsdom** unit tests, either enable `pretendToBeVisual` or stub `requestAnimationFrame`,
otherwise `mounted` never flips and height-dependent assertions hang.

## AC-9. Required Vue `:key`s (not mentioned in §8.7/§8.8).

- `<ol v-for="(position, index) in possiblePositions" :key="position">` — mirrors React's
  `key={position}`; without it Vue reuses `<ol>` elements across position changes and the
  callback-`listRef` / focus bookkeeping desyncs.
- `<Toast v-for="(toast, index) in …" :key="toast.id">` — mirrors React's `key={toast.id}`.
  This is what makes `toast.id` immutable per component instance (an assumption §5.5.3 relies
  on) and what makes an in-place content update *reuse* the same `<li>` (required by
  Playwright test 36, `promise toast with testId maintains testId through state changes`).

## AC-10. Small factual fixes to the body of this spec.

- **§5.8 `onPointerUp`, `timeTaken`:** when `dragStartTime.current` is `null` (a pointerup with
  no matching armed pointerdown — e.g. the gesture started on a `<button>`),
  `new Date().getTime() - undefined` is **`NaN`**, not "near 0"; `velocity` is `NaN` and
  `NaN > 0.11` is `false`. The `else` branch is taken, as the spec concludes — but port the
  arithmetic literally (`dragStartTime` may be a `number | null` ref in Vue; `Date.now() - (dragStartTime.value as number)` reproduces the `NaN`). Do **not** add a null-guard that
  short-circuits the handler; the CSS-var reset in the `else` branch must still run.
- **§9.3 item 4 / §5.7:** `--index` is set on every `<li>` but is **never referenced by
  `styles.css`** (verified by a full `var(--` grep). Only `--toasts-before` participates in the
  stack math. Set both anyway.
- **§5.5.6 skip condition:** note that `remainingTime.current` is decremented by `pauseTimer()`
  and can go **negative** if the document was hidden/expanded across a long span; `setTimeout`
  with a negative delay fires immediately, which is the intended catch-up behavior. No clamp
  in source — do not add one.

## AC-11. Open question 2 resolved: there is no click-suppression-after-swipe, in JS *or* CSS.

§10 open question 2 asked the styles slice to confirm. Verified against `styles.css`: the file
contains no `pointer-events` rule other than `[data-sonner-toast][data-visible='false'] {
pointer-events: none; }` (which is about the >`visibleToasts` overflow stack, not swipes), and
no `user-select`/`touch-action` rule that suppresses clicks post-gesture. `touch-action: none`
on `[data-sonner-toast]` and `user-select: none` under `[data-swiped='true']` exist, but
neither suppresses a click. **Conclusion: sonner v2.0.7 has no post-swipe click suppression at
all. The Vue port must not invent one.** This open question is closed; no orchestrator decision
needed.

# Orchestrator corrections (verified against source)

These two entries were confirmed by the orchestrator against the upstream React source
(sonner v2.0.7, `src/index.tsx`) via direct line-range diffing, not inference. They are
**authoritative over both the body of this spec (including §5.9-§5.11 and §8.7) and over the
Audit corrections (AC-1 through AC-11) above wherever either conflicts with what's stated
here.**

## OC-1. `Toaster`'s `filteredToasts` formula (§8.2/§8.7).

§8.7's own text calls this "the parity-preserving reconstruction" of a formula "not spelled
out verbatim in the spec body" and guesses `toasts.filter(t => !t.toasterId || t.toasterId
=== id)` (a toast is shown by an id-less Toaster if it's untagged, OR by ANY Toaster,
id-having or not, if the toast's `toasterId` happens to match that Toaster's `id`). **That
guess is wrong.** Verified verbatim against `sonner` `src/index.tsx` lines 617-622:

```js
const filteredToasts = React.useMemo(() => {
  if (id) {
    return toasts.filter((toast) => toast.toasterId === id);
  }
  return toasts.filter((toast) => !toast.toasterId);
}, [toasts, id]);
```

This is a strict **either/or branch**, not a single combined predicate:
- A `Toaster` rendered **with** an `id` prop renders **only** toasts whose `toasterId`
  matches that `id` — untagged toasts (`toasterId` unset) are **excluded**, even though the
  old formula's `!toast.toasterId` disjunct would have let them leak in whenever `props.id`
  happened to be falsy-checked incorrectly, and more importantly the old formula let a
  **different** id-bearing Toaster's toasts leak into an id-less Toaster whenever `undefined
  === undefined`-style coincidences occurred — the two branches must stay fully separate.
- A `Toaster` rendered **without** an `id` prop renders **only** untagged toasts
  (`toasterId` falsy) — it must **never** render another Toaster's `id`-scoped toasts.

Port as a Vue `computed()` over the `toasts` ref and `props.id`, preserving the `if`/`else`
branch structure (not a single filter predicate):

```ts
const filteredToasts = computed(() => {
  if (props.id) {
    return toasts.value.filter((toast) => toast.toasterId === props.id);
  }
  return toasts.value.filter((toast) => !toast.toasterId);
});
```

`src/Toaster.vue` implements this exactly, immediately above the `possiblePositions`
computed.

## OC-2. `Toast`'s `<li>` child DOM order (§5.7/§5.9/§5.10/§5.11).

The body of this spec presents §5.9 (icon container), §5.10 (content block), and §5.11
(close button) in that reading order, and does not call out that this reading order is also
the required DOM sibling order — it is **not**. Verified verbatim against `sonner`
`src/index.tsx`: the close button JSX (line 419, `{closeButton && !toast.jsx && toastType
!== 'loading' ? (<button ... data-close-button ...>) : null}`) is the **first** child
rendered inside the toast `<li>`, appearing **before** the icon `<div data-icon="">` (line
438) and the content `<div data-content="">` (line 447). Cancel and action buttons still
follow content, in that order.

The exact required `<li>` sibling order is:

1. Close button (`<button data-close-button="true">`, `v-if="showCloseButton"`)
2. Icon container (`<div data-icon="">`, `v-if="showIconContainer"`)
3. Content block (`<div data-content="">`, unconditional)
4. Cancel button/node (`v-if="cancelResolution.kind === 'action'"` / `'node'`)
5. Action button/node (`v-if="actionResolution.kind === 'action'"` / `'node'`)

All render conditions, attributes, and event bindings for each element are unchanged from
the rest of §5 — this is purely a sibling-order correction, not a behavioral one. Getting the
order wrong doesn't change which elements render, but does change tab order, assistive-tech
reading order, and any `:nth-child`/sibling-combinator CSS the styles slice might rely on —
so it is load-bearing for parity even though every individual element's own render condition
was already correct. `src/Toast.vue`'s `<li>` template implements this order exactly.

## OC-3. Attribute-serialization parity for boolean `data-*` attributes (post-green DOM-parity audit).

A full-suite-green pass (72/72 e2e, 204/204 unit) still shipped three real DOM divergences
from upstream, all rooted in how boolean values cross the JSX → Vue-template boundary. None of
the 108 Playwright/Vitest assertions caught them because every test/selector in this port uses
presence-only matching (`[data-sonner-toast]`, `[data-cancel]`, …) or checks a *different*
attribute — never the literal string value of `data-rich-colors`/`data-invert`, and never
`data-button`/`data-cancel`/`data-action`'s value. ARCHITECTURE.md's byte-identical-DOM bar is
stricter than the test suite; this correction closes that gap. Fixed in `src/Toast.vue` /
`src/Toaster.vue` / `src/types.ts` (see the `Finding 1/2/3` and `OC-3` comments left in those
files at the exact call sites).

**(a) Bare JSX attributes stringify to `"true"`, full stop — this generalizes AC-4.** AC-4
above already tabulated `data-close-button`, `data-sonner-toaster`, and
`data-react-aria-top-layer` as bare-JSX-means-`"true"` cases and both were ported correctly.
Two siblings in the same render tree (`data-button`/`data-cancel` on the cancel `<button>`,
`data-button`/`data-action` on the action `<button>`, §6.4/§6.5) were missed by the original
implementation pass and shipped as **bare Vue template attributes** (`data-button` with no
`="…"`), which Vue serializes as `=""` — matching neither React's `"true"` nor any documented
intentional-empty-string case (those are `data-sonner-toast`, `data-icon`, `data-content`,
`data-title`, `data-description`, listed in AC-4 as staying `""` because their JSX source is
*itself* `attr=""`, not a bare `{true}`). Every bare-JSX-attribute site in the render tree must
be written as an explicit `="true"` in the Vue template — there is no third case.

**(b) `undefined`/`null` must OMIT the attribute, matching React's own omission rule.** React
does not render a JSX attribute at all when its expression evaluates to `undefined` (or
`null`); Vue's `v-bind`/`:attr="expr"` has the identical omission rule. This is not new — it is
the mechanism AC-4's `data-swipe-direction`, `data-type`, and `data-testid` "OMITTED while
X"/"OMITTED if Y" annotations already rely on, and §5.7's render tree already annotates
`data-rich-colors={toast.richColors ?? defaultRichColors}` as "OMITTED entirely if both
undefined". The bug was never in the omission rule itself, or in the `Toast.vue` computeds
that produce the value handed to `v-bind` (`richColorsAttr = toast.richColors ??
defaultRichColors`, `invert = toast.invert || invert` — both already correct, `??`/`||`
exactly as upstream) — it was that the *value flowing into* those computeds was never actually
`undefined` at the point it needed to be. See (c).

**(c) Vue's Boolean-prop runtime casting turns an ABSENT optional-boolean prop into `false`,
not `undefined` — this is the shared root cause, and it bites at the OUTERMOST prop boundary,
not where the bug is observed.** `defineProps<T>()` (or its `withDefaults` wrapper) infers a
runtime `type: Boolean` for any prop typed `boolean`/`boolean | undefined`. Vue's prop
resolver (`resolvePropValue`) then applies: *if the prop is absent from the caller AND has no
own `default` key in its resolved options, cast the value to `false`* — a convenience meant for
attribute-shorthand template props (`<Foo disabled>` / no `disabled` at all), not this port's
`defineProps<ToasterProps>()` consumers, none of which template-author `<Toaster>` and expect
Boolean-attribute shorthand semantics. Concretely: `<Toaster>` mounted with no `richColors`/
`invert` prop at all (the common case — every playground fixture and every Playwright test
except the explicit rich-colors ones) means `ToasterProps.richColors`/`.invert` are *absent*,
not merely `undefined`-valued, on `Toaster`'s own `props` object — and with no explicit
`default` entry for them in `withDefaults(...)`, Vue casts both to literal `false`. That `false`
(not `undefined`) is exactly what was being forwarded down to `Toast` as `defaultRichColors`/
`invert`, which is why `toast.richColors ?? defaultRichColors` and `toast.invert || invert`
— both byte-correct expressions — still produced `false` instead of `undefined`, and (b)'s
correct omission rule had nothing to omit.

**Suppress the cast with an explicit `default: undefined`, not by patching the value
downstream.** Per Vue's own resolver logic, the `false`-cast is gated on `!hasDefault` — an
own `default` key existing in the resolved prop options, *even one whose value is
`undefined`*, is sufficient to skip the cast and let the later "apply default when value is
`undefined`" step assign `undefined` through untouched. In `withDefaults(defineProps<T>(),
{...})` this means listing the key with an explicit `undefined` value
(`richColors: undefined, invert: undefined`) — omitting the key entirely is *not* equivalent,
despite both reading as "no default" at a glance; only the former sets `hasDefault`. Patching
the *symptom* instead (e.g. `props.richColors ?? undefined` at every downstream call site, or
`v-if`-gating the attribute) would need to be repeated at every consumption point and silently
regresses the next time a new boolean prop is threaded through — fixing the cast at the prop
declaration is the only fix that can't be bypassed downstream.

**(d) Per-prop verdict table (this sweep, exhaustive over every optional boolean flowing
`Toaster.vue` → `Toast.vue`, plus every boolean reaching a rendered attribute in either SFC):**

| prop (Toaster-level) | upstream (`index.tsx`) can be `undefined`? | forwarding before this fix | forwarding after this fix | reaches an attribute? | verdict |
|---|---|---|---|---|---|
| `richColors` → `defaultRichColors` | yes (`richColors,` no default) | `:defaultRichColors="props.richColors"` but `props.richColors` itself Boolean-cast to `false` when absent (no `withDefaults` entry) | same binding; `richColors: undefined` added to `withDefaults` so `props.richColors` is genuinely `undefined` when absent | yes — `data-rich-colors` | **FIXED** (Finding 2). `data-rich-colors` now omitted when unset, matching upstream byte-for-byte. |
| `invert` | yes (`invert,` no default) | `:invert="props.invert ?? false"` (defensive `??`) **and** `props.invert` itself Boolean-cast to `false` when absent | `invert: undefined` added to `withDefaults`; `:invert="props.invert"` raw, no `??`; `ToastProps.invert` widened to optional | yes — `data-invert` | **FIXED** (Finding 3). `data-invert` now omitted when unset; `toast.invert || invert` (unchanged, correct `||` per §5.4's asymmetry note) still wins over a per-toast `false` when the toaster level is truthy. |
| `closeButton` | yes (`closeButton,` no default) | `:closeButton="props.toastOptions?.closeButton ?? props.closeButton ?? false"` | unchanged | no — only feeds `Boolean(closeButton.value) && !toast.jsx && …` (`showCloseButton`, a `v-if` guard) | **NO FIX NEEDED.** The trailing `?? false` makes `false` vs. `undefined` unobservable: both are falsy inputs to `Boolean(...)`, and `showCloseButton` never itself becomes a rendered attribute (only `data-close-button="true"`, which is unconditionally the literal `"true"` per AC-4/(a) and does not encode `closeButton`'s value). `ToastProps.closeButton` is intentionally left `required boolean`, matching upstream's own (unenforced) required declaration. |
| `expand` → `expandByDefault` | yes (`expand,` no default) | `:expandByDefault="props.expand ?? false"` | unchanged | no — only feeds `Boolean(expanded \|\| (expandByDefault && mounted))` (`data-expanded`, already `Boolean()`-wrapped) and a ternary (`--initial-height: expandByDefault ? 'auto' : …`, a CSS value, not a boolean attribute) | **NO FIX NEEDED.** Same reasoning as `closeButton`: every consumer coerces to a definite boolean or branches in a ternary before anything reaches the DOM; `expandByDefault`'s own truthiness, not its `false`-vs-`undefined` identity, is all that's observable. `ToastProps.expandByDefault` intentionally left `required boolean`. |
| `unstyled` (via `toastOptions?.unstyled`) | yes (`toastOptions?.unstyled`, optional chain, no Boolean-prop involved) | `:unstyled="props.toastOptions?.unstyled"` | unchanged | indirectly — `data-styled={!(toast.jsx \|\| toast.unstyled \|\| unstyled)}` | **ALREADY CORRECT, no fix needed.** `toastOptions` is a plain object prop (not itself `type: Boolean`), so its `.unstyled` sub-property is never subject to Vue's Boolean-prop absent-cast — reading an optional-chained property off a possibly-absent object naturally yields `undefined`, exactly like React. `dataStyled`'s `!(...)` also always yields a real boolean regardless, so this was never at risk either way. |
| `expanded` | n/a — internal state, not a consumer-facing optional prop | `:expanded="expanded"` (Toaster's own `ref(false)`) | unchanged | yes — `data-expanded`, but via `Boolean(expanded \|\| …)` | **N/A.** Not sourced from an optional `ToasterProps` field; always a real boolean `ref`. |
| `interacting` | n/a — internal state | `:interacting="interacting"` | unchanged | no | **N/A.** Same as `expanded`. |
| `dismissible` | n/a — per-`toast()`-call only, never a `ToasterProps`/`ToastProps` field | computed as `toast.dismissible !== false` | unchanged | yes — `data-dismissible` | **N/A / already correct.** `!== false` always yields a real boolean; not part of the Toaster→Toast forwarding surface this sweep audits. |

**Net rule of thumb for any future boolean threaded from `ToasterProps` through `Toaster.vue`
into `Toast.vue`:** if it can ever reach a `v-bind`-ed attribute (directly, or through a `??`/
`||` expression that itself feeds one) without first passing through `Boolean(...)` or a
ternary that produces a non-boolean, it needs an explicit `default: undefined` at its
`ToasterProps` declaration and a raw (no `?? false`) forward — anything that terminates in a
`Boolean(...)`/ternary before touching the DOM does not.
