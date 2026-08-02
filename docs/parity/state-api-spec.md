# Spec: State Engine, Types, Hooks, Assets

Slice source files (sonner React v2.0.7):
- `sonner-react/src/state.ts`
- `sonner-react/src/types.ts`
- `sonner-react/src/hooks.tsx`
- `sonner-react/src/assets.tsx`

Target files (per ARCHITECTURE.md):
- `src/state.ts`
- `src/types.ts`
- `src/hooks.ts`
- `src/assets.ts`

This spec is self-contained: an implementer should be able to write all four target
files from this document alone, without opening the React source.

---

## 0. Cross-cutting type introduced by this slice: `Renderable`

Not present in the React source (React uses `React.ReactNode` everywhere). Per
ARCHITECTURE.md line 26-28, this port must define it in `src/types.ts`:

```ts
import type { Component, VNode, CSSProperties as VueCSSProperties } from 'vue';

export type Renderable = string | number | Component | VNode;
```

Every field typed `React.ReactNode` in the source becomes `Renderable` in the port.
Every field typed `(() => React.ReactNode) | React.ReactNode` becomes
`(() => Renderable) | Renderable`.

`React.CSSProperties` → Vue's `CSSProperties` (imported from `'vue'`).

`React.isValidElement(x)` → `isVNode(x)` (imported from `'vue'`). This is a **narrow**
check — "is this value an already-rendered VNode" — not the broader "is this a
renderable thing" concept from ARCHITECTURE.md's `renderNode()` helper (which is a
concern for the Toast/Toaster component slice, not this one). Do not conflate the two.

---

## 1. `src/types.ts`

### 1.1 Full verbatim type inventory (React source → Vue port)

Transcribe every one of these. Names, optionality (`?`), and field order must match
exactly (field order matters for anyone doing structural diffing / object literal
spreads that rely on later-key-wins semantics elsewhere in this codebase).

```ts
// ToastTypes — verbatim, no ReactNode fields, no change needed
export type ToastTypes = 'normal' | 'action' | 'success' | 'info' | 'warning' | 'error' | 'loading' | 'default';

// PromiseT<Data> — verbatim
export type PromiseT<Data = any> = Promise<Data> | (() => Promise<Data>);

// PromiseIExtendedResult
export interface PromiseIExtendedResult extends ExternalToast {
  message: Renderable;
}

// PromiseTExtendedResult<Data>
export type PromiseTExtendedResult<Data = any> =
  | PromiseIExtendedResult
  | ((data: Data) => PromiseIExtendedResult | Promise<PromiseIExtendedResult>);

// PromiseTResult<Data>
export type PromiseTResult<Data = any> =
  | string
  | Renderable
  | ((data: Data) => Renderable | string | Promise<Renderable | string>);
// NOTE: `string` is a redundant union member (Renderable already includes string).
// This redundancy exists in the original React source too (ReactNode includes string).
// Preserve it verbatim for structural fidelity — do not "clean it up".

// PromiseExternalToast
export type PromiseExternalToast = Omit<ExternalToast, 'description'>;

// PromiseData<ToastData>
export interface PromiseData<ToastData = any> extends PromiseExternalToast {
  loading?: string | Renderable;
  success?: PromiseTResult<ToastData> | PromiseTExtendedResult<ToastData>;
  error?: PromiseTResult | PromiseTExtendedResult;
  description?: PromiseTResult;
  finally?: () => void | Promise<void>;
}
// SOURCE NOTE: React source declares this as
// `export type PromiseData<ToastData = any> = PromiseExternalToast & { ... }`
// (intersection, not interface extends). Either form is structurally equivalent for
// this shape; use whichever satisfies the project's declaration-merging conventions.
// Behaviorally identical — flagging only so the implementer knows it's an intentional,
// harmless representation choice, not a deviation to fix.

// ToastClassnames — no ReactNode fields, verbatim
export interface ToastClassnames {
  toast?: string;
  title?: string;
  description?: string;
  loader?: string;
  closeButton?: string;
  cancelButton?: string;
  actionButton?: string;
  success?: string;
  error?: string;
  info?: string;
  warning?: string;
  loading?: string;
  default?: string;
  content?: string;
  icon?: string;
}

// ToastIcons
export interface ToastIcons {
  success?: Renderable;
  info?: Renderable;
  warning?: Renderable;
  error?: Renderable;
  loading?: Renderable;
  close?: Renderable;
}

// Action
export interface Action {
  label: Renderable;
  onClick: (event: MouseEvent) => void; // React.MouseEvent<HTMLButtonElement, MouseEvent> -> native MouseEvent
  actionButtonStyle?: CSSProperties; // from 'vue'
}

// ToastT
export interface ToastT {
  id: number | string;
  toasterId?: string;
  title?: (() => Renderable) | Renderable;
  type?: ToastTypes;
  icon?: Renderable;
  jsx?: Renderable;
  richColors?: boolean;
  invert?: boolean;
  closeButton?: boolean;
  dismissible?: boolean;
  description?: (() => Renderable) | Renderable;
  duration?: number;
  delete?: boolean;
  action?: Action | Renderable;
  cancel?: Action | Renderable;
  onDismiss?: (toast: ToastT) => void;
  onAutoClose?: (toast: ToastT) => void;
  promise?: PromiseT;
  cancelButtonStyle?: CSSProperties;
  actionButtonStyle?: CSSProperties;
  style?: CSSProperties;
  unstyled?: boolean;
  className?: string;
  classNames?: ToastClassnames;
  descriptionClassName?: string;
  position?: Position;
  testId?: string;
}

// isAction type guard — runtime logic is byte-identical, only the type annotation changes
export function isAction(action: Action | Renderable): action is Action {
  return (action as Action).label !== undefined;
}

// Position, HeightT — no ReactNode fields, verbatim
export type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';
export interface HeightT {
  height: number;
  toastId: number | string;
  position: Position;
}

// ToastOptions — NOT exported in React source (no `export` keyword). Keep un-exported
// in the port too (internal to types.ts, referenced only by ToasterProps.toastOptions).
interface ToastOptions {
  className?: string;
  closeButton?: boolean;
  descriptionClassName?: string;
  style?: CSSProperties;
  cancelButtonStyle?: CSSProperties;
  actionButtonStyle?: CSSProperties;
  duration?: number;
  unstyled?: boolean;
  classNames?: ToastClassnames;
  closeButtonAriaLabel?: string;
  toasterId?: string;
}

// Offset — NOT exported in React source. Keep un-exported.
type Offset =
  | {
      top?: string | number;
      right?: string | number;
      bottom?: string | number;
      left?: string | number;
    }
  | string
  | number;

// ToasterProps — see §1.3 for the full field inventory + defaults
export interface ToasterProps {
  id?: string;
  invert?: boolean;
  theme?: 'light' | 'dark' | 'system';
  position?: Position;
  hotkey?: string[];
  richColors?: boolean;
  expand?: boolean;
  duration?: number;
  gap?: number;
  visibleToasts?: number;
  closeButton?: boolean;
  toastOptions?: ToastOptions;
  className?: string;
  style?: CSSProperties;
  offset?: Offset;
  mobileOffset?: Offset;
  dir?: 'rtl' | 'ltr' | 'auto';
  swipeDirections?: SwipeDirection[];
  icons?: ToastIcons;
  customAriaLabel?: string;
  containerAriaLabel?: string;
}

export type SwipeDirection = 'top' | 'right' | 'bottom' | 'left';

// ToastProps — internal component-props interface, consumed by the Toast.vue slice.
// See §1.4 for the setHeights mapping note.
export interface ToastProps {
  toast: ToastT;
  toasts: ToastT[];
  index: number;
  swipeDirections?: SwipeDirection[];
  expanded: boolean;
  invert: boolean;
  heights: HeightT[];
  setHeights: (updater: HeightT[] | ((prev: HeightT[]) => HeightT[])) => void; // see §1.4
  removeToast: (toast: ToastT) => void;
  gap?: number;
  position: Position;
  visibleToasts: number;
  expandByDefault: boolean;
  closeButton: boolean;
  interacting: boolean;
  style?: CSSProperties;
  cancelButtonStyle?: CSSProperties;
  actionButtonStyle?: CSSProperties;
  duration?: number;
  className?: string;
  unstyled?: boolean;
  descriptionClassName?: string;
  loadingIcon?: Renderable;
  classNames?: ToastClassnames;
  icons?: ToastIcons;
  closeButtonAriaLabel?: string;
  defaultRichColors?: boolean;
}

// SwipeStateTypes — plain TS enum, no JSX/ReactNode involvement. Port verbatim, no
// Vue-specific translation needed (TS enums work identically in .ts files).
export enum SwipeStateTypes {
  SwipedOut = 'SwipedOut',
  SwipedBack = 'SwipedBack',
  NotSwiped = 'NotSwiped',
}

export type Theme = 'light' | 'dark';

// ToastToDismiss — verbatim, no ReactNode fields
export interface ToastToDismiss {
  id: number | string;
  dismiss: boolean;
}

// ExternalToast — verbatim Omit list
export type ExternalToast = Omit<ToastT, 'id' | 'type' | 'title' | 'jsx' | 'delete' | 'promise'> & {
  id?: number | string;
  toasterId?: string;
};
```

### 1.2 React → Vue mapping table (this slice)

| React type | Vue port type | Notes |
|---|---|---|
| `React.ReactNode` | `Renderable` (`string \| number \| Component \| VNode`) | New type alias defined in `types.ts`, not present in React source. |
| `(() => React.ReactNode) \| React.ReactNode` | `(() => Renderable) \| Renderable` | Used for `ToastT.title`, `ToastT.description`, and the internal `titleT` alias in `state.ts`. |
| `React.CSSProperties` | `CSSProperties` (from `'vue'`) | Used for `Action.actionButtonStyle`, `ToastT.cancelButtonStyle`/`actionButtonStyle`/`style`, `ToasterProps.style`, `ToastOptions.style`/`cancelButtonStyle`/`actionButtonStyle`, `ToastProps.style`/`cancelButtonStyle`/`actionButtonStyle`. |
| `React.MouseEvent<HTMLButtonElement, MouseEvent>` | `MouseEvent` (native DOM) | `Action.onClick` param. Vue does not have synthetic events; native `MouseEvent` is what a `@click` handler receives. |
| `React.ReactElement` | `VNode \| Component` | Used for `custom()`'s `jsx` callback return type and the inline `jsx` field of `create()`'s parameter type. Narrower than `Renderable` (excludes bare `string`/`number`) — preserve that narrowness. |
| `React.isValidElement(x)` | `isVNode(x)` (from `'vue'`) | Exact 1:1 semantic replacement — both answer "is this an already-instantiated element/vnode", not "is this renderable". |
| `React.Dispatch<React.SetStateAction<HeightT[]>>` | `(updater: HeightT[] \| ((prev: HeightT[]) => HeightT[])) => void` | See §1.4 — belongs to `ToastProps.setHeights`, consumed by the Toast/Toaster slice but typed here. |
| `React.RefObject<T>` | `Ref<T>` (from `'vue'`) | Not actually used anywhere in this slice's four files (mentioned in ARCHITECTURE.md for other slices — no occurrence here to port). |
| `enum SwipeStateTypes` | same `enum` | No React-specific construct involved; TS enums are framework-agnostic. |

### 1.3 `ToasterProps` full inventory with defaults

The `ToasterProps` **interface** (types.ts) declares every field optional with no
default baked into the type itself — defaults are applied where the `Toaster`
component destructures `props` (in `index.tsx`, **outside this slice**, to be spec'd
by the Toaster.vue slice). Documented here for completeness of the contract, sourced
from `sonner-react/src/index.tsx` lines 593-615:

| Field | Type | Default (applied in `Toaster` component) |
|---|---|---|
| `id` | `string \| undefined` | none (`undefined`) |
| `invert` | `boolean \| undefined` | none |
| `theme` | `'light' \| 'dark' \| 'system'` | `'light'` |
| `position` | `Position` | `'bottom-right'` |
| `hotkey` | `string[]` | `['altKey', 'KeyT']` |
| `richColors` | `boolean \| undefined` | none |
| `expand` | `boolean \| undefined` | none |
| `duration` | `number \| undefined` | none (falls back per-toast to `toast.duration \|\| durationFromToaster \|\| TOAST_LIFETIME(4000)` — Toast slice concern) |
| `gap` | `number` | `GAP` = `14` |
| `visibleToasts` | `number` | `VISIBLE_TOASTS_AMOUNT` = `3` |
| `closeButton` | `boolean \| undefined` | none |
| `toastOptions` | `ToastOptions \| undefined` | none |
| `className` | `string \| undefined` | none |
| `style` | `CSSProperties \| undefined` | none |
| `offset` | `Offset \| undefined` | none |
| `mobileOffset` | `Offset \| undefined` | none |
| `dir` | `'rtl' \| 'ltr' \| 'auto'` | `getDocumentDirection()` (reads `document.documentElement.dir`; Toaster slice concern) |
| `swipeDirections` | `SwipeDirection[] \| undefined` | none (defaulted per-position elsewhere via `getDefaultSwipeDirections(position)`, Toast slice concern) |
| `icons` | `ToastIcons \| undefined` | none |
| `customAriaLabel` | `string \| undefined` | none |
| `containerAriaLabel` | `string` | `'Notifications'` |

Also, for completeness (not a `ToasterProps` field but relevant to the same
destructure block, belongs to the `ToastOptions`/Toast component contract):
`closeButtonAriaLabel` defaults to `'Close toast'` where the individual `Toast`
component destructures `toastOptions?.closeButtonAriaLabel` (source line 90) — this
is Toast.vue-slice territory, noted here only so this spec's default table isn't
mistaken for incomplete.

These `VISIBLE_TOASTS_AMOUNT`, `GAP` constants are already pinned byte-identical by
ARCHITECTURE.md line 49-51; this table is just recording which `ToasterProps` fields
they default onto.

### 1.4 `ToastProps.setHeights` — React→Vue signature note

React's `ToastProps.setHeights: React.Dispatch<React.SetStateAction<HeightT[]>>` is a
`useState` setter that accepts either a new array or an updater function
`(prev: HeightT[]) => HeightT[]`. Vue has no direct equivalent construct. Recommended
port signature (preserves both call-site shapes React code uses):

```ts
setHeights: (updater: HeightT[] | ((prev: HeightT[]) => HeightT[])) => void;
```

The **implementation** behind this signature (a wrapped `Ref<HeightT[]>` setter, or a
function that mutates a ref based on functional vs. direct updater) is the Toast.vue /
Toaster.vue slice's responsibility — this spec only pins the type shape so the two
slices agree on the contract.

### 1.5 Architecture-mandated `Renderable | (() => Renderable)` widening (potential deviation from 1:1 typing — flagged, not silently applied)

ARCHITECTURE.md (lines 45-47) states:

> Renderable props (`title`, `description`, `icon`, `action`, `cancel`, custom
> `icons`, …) accept `Renderable | (() => Renderable)`. Prop-based API is the parity
> source of truth...

`title` and `description` **already** have this shape in the React source (the
`titleT`-style union) — no change needed there, §1.1 already reflects it.

`icon`, `action`, `cancel`, and the `ToastIcons` fields (`success`/`info`/`warning`/
`error`/`loading`/`close`) are **plain `React.ReactNode`** in the React source (no
function variant) — see `ToastT.icon: React.ReactNode`, `ToastT.action: Action |
React.ReactNode`, `ToastIcons.success: React.ReactNode`, etc. in the verbatim listing
above. Per the architecture line quoted, the Vue port is directed to widen these to
also accept a zero-arg thunk, e.g.:

```ts
icon?: Renderable | (() => Renderable);
action?: Action | Renderable | (() => Renderable);
cancel?: Action | Renderable | (() => Renderable);
// ToastIcons:
success?: Renderable | (() => Renderable);
info?: Renderable | (() => Renderable);
warning?: Renderable | (() => Renderable);
error?: Renderable | (() => Renderable);
loading?: Renderable | (() => Renderable);
close?: Renderable | (() => Renderable);
```

This is a deliberate, contract-directed deviation from the literal React type, not a
port bug — flagged prominently here so the implementer applies it deliberately and the
Toast.vue slice knows to *call* these props-as-functions when consuming them (i.e.
`typeof props.icon === 'function' ? props.icon() : props.icon` before passing into
`renderNode()`).

**Open question** (recorded in structured output, not decided here): the contract's
field list ends with "…", and it's ambiguous whether `Action.label` itself (the text
inside an action/cancel button) should also get the function-thunk widening, or only
the outer `action`/`cancel` props. This spec applies the widening only to the fields
explicitly named in the contract sentence. Confirm with the orchestrator before the
Toast.vue slice locks its prop types.

---

## 2. `src/state.ts`

ARCHITECTURE.md line 24-25: *"port of React `state.ts` (Observer + `toast` function
object). Framework-agnostic: keep logic line-for-line identical; only type imports
change."* This section is written to let the implementer do exactly that, plus it
documents every quirk/edge-case in the original that must be preserved even though it
looks like it could be a bug — it is production behavior of sonner v2.0.7 and the
ported Playwright/Vitest suites will assert on it.

### 2.1 Module-level state

```ts
let toastsCounter = 1;
```

Single mutable module-level counter, starts at **1**, shared across every toast
created via `create()`, the base `toast()` call, and `custom()`. Never resets (not
even between different `Toaster` instances/`toasterId`s — it's global to the module).

`titleT` type (internal, not exported): `type titleT = (() => Renderable) | Renderable;`

### 2.2 `Observer` class — fields

```ts
class Observer {
  subscribers: Array<(toast: ToastT | ToastToDismiss) => void>;
  toasts: Array<ToastT | ToastToDismiss>;
  dismissedToasts: Set<string | number>;

  constructor() {
    this.subscribers = [];
    this.toasts = [];
    this.dismissedToasts = new Set();
  }
}
```

**Source-fidelity note**: the React source's field declaration for `subscribers` types
the callback parameter as `ExternalToast | ToastToDismiss`, but the `subscribe()`
method itself (and every actual call site) uses `ToastT | ToastToDismiss`. This is an
internal inconsistency in the upstream `.ts` file (not user-visible, `Observer` is
never exported). Port using `ToastT | ToastToDismiss` consistently (as shown above) —
this is what's actually published at runtime.

`toasts` is typed as a mixed array but **at runtime only ever contains `ToastT`
entries** — `ToastToDismiss` objects (`{id, dismiss: true}`) are only ever handed to
`subscribers`, never pushed into `this.toasts`. `this.toasts` is **append-only plus
in-place-update**: nothing in `Observer` ever removes an entry from it. This is what
makes `getHistory()` (§2.15) a full toast history rather than "currently visible
toasts" — actual DOM removal is a concern of the Toast/Toaster component slice, not
`Observer`.

`dismissedToasts` is the only mechanism inside `Observer` that marks a toast id as
"should be considered inactive" — `getActiveToasts()` filters by membership in this
set (§2.11). It is populated **only** by the single-id branch of `dismiss()` (§2.7)
and by nothing else.

### 2.3 `subscribe`

```ts
subscribe = (subscriber: (toast: ToastT | ToastToDismiss) => void) => {
  this.subscribers.push(subscriber);
  return () => {
    const index = this.subscribers.indexOf(subscriber);
    this.subscribers.splice(index, 1);
  };
};
```

Arrow-function class field (correct `this` binding regardless of how the method is
later detached/called — important since the exported `toast` object relies on this,
see §2.15). Returns an unsubscribe closure. `indexOf` + `splice` — if the subscriber
was already removed (index `-1`), `splice(-1, 1)` removes the **last** element of the
array instead of doing nothing — this is the literal behavior of the source and must
be preserved (do not add a `if (index === -1) return;` guard that isn't in the
original).

### 2.4 `publish`

```ts
publish = (data: ToastT) => {
  this.subscribers.forEach((subscriber) => subscriber(data));
};
```

Synchronous fan-out to every current subscriber, in subscription order.

### 2.5 `addToast`

```ts
addToast = (data: ToastT) => {
  this.publish(data);
  this.toasts = [...this.toasts, data];
};
```

**Order matters**: publishes to subscribers **first**, then appends to `this.toasts`
(new array via spread, not mutation — `this.toasts` is reassigned, so anything holding
a reference to the old array won't see the update — relevant if the Vue port later
wraps this in a `ref`/`reactive`, reassignment is the correct primitive to trigger
reactivity anyway).

### 2.6 `create` — the dedupe/update engine

Full source (lines 47-86 of `state.ts`):

```ts
create = (
  data: ExternalToast & {
    message?: titleT;
    type?: ToastTypes;
    promise?: PromiseT;
    jsx?: React.ReactElement; // -> VNode | Component in the port
  },
) => {
  const { message, ...rest } = data;
  const id = typeof data?.id === 'number' || data.id?.length > 0 ? data.id : toastsCounter++;
  const alreadyExists = this.toasts.find((toast) => {
    return toast.id === id;
  });
  const dismissible = data.dismissible === undefined ? true : data.dismissible;

  if (this.dismissedToasts.has(id)) {
    this.dismissedToasts.delete(id);
  }

  if (alreadyExists) {
    this.toasts = this.toasts.map((toast) => {
      if (toast.id === id) {
        this.publish({ ...toast, ...data, id, title: message });
        return {
          ...toast,
          ...data,
          id,
          dismissible,
          title: message,
        };
      }
      return toast;
    });
  } else {
    this.addToast({ title: message, ...rest, dismissible, id });
  }

  return id;
};
```

Step-by-step semantics an implementer must replicate exactly:

1. **Destructure** `message` out of `data`; `rest` is everything else (still includes
   `type`, `promise`, `jsx`, `id` if present, and all `ExternalToast` fields).

2. **ID resolution**:
   `id = (typeof data.id === 'number' || data.id?.length > 0) ? data.id : toastsCounter++`
   - If `data.id` is a `number` (including `0`), it's used as-is — `0` is handled
     correctly here because the check is `typeof === 'number'`, not truthiness.
   - Else if `data.id` is a non-empty string (`.length > 0`), it's used as-is.
   - Else (undefined, or empty string `''`) a fresh id is minted from
     `toastsCounter++` (post-increment: returns current value, then increments).
   - **TS-strict note**: `data.id?.length > 0` type-checks `data.id: number | string
     | undefined` against `.length`, which doesn't exist on `number`. This compiles in
     loose/JS-emit-only React but will not satisfy `strict: true` TS. Behaviorally
     equivalent, strict-safe rewrite:
     ```ts
     const id =
       typeof data?.id === 'number'
         ? data.id
         : typeof data?.id === 'string' && data.id.length > 0
           ? data.id
           : toastsCounter++;
     ```
     Use this form (or equivalent) in the port. It is not a behavior change.

3. **Existing-toast lookup**: `this.toasts.find(toast => toast.id === id)` — strict
   `===`, searches the **entire** history array (including toasts that were already
   dismissed but not yet purged — dismissal never removes from `this.toasts`, see
   §2.2). So calling `toast.success('x', {id: 5})` after `toast.dismiss(5)` finds and
   **updates** the old entry rather than treating it as fresh — and note step 4 below
   un-dismisses it.

4. **Un-dismiss on (re)create**: if `id` is currently in `dismissedToasts`, it's
   removed — **unconditionally**, before checking `alreadyExists`, regardless of
   whether this call ends up creating a new toast or updating an old one. Net effect:
   calling `create()` (directly or via any wrapper) with an id that was previously
   dismissed always revives it into the active set.

5. **`dismissible` default**: `data.dismissible === undefined ? true : data.dismissible`
   — default is `true`. `false` and `undefined` are treated differently (`undefined`
   → default `true`; explicit `false` → `false`).

6. **Update branch** (`alreadyExists` truthy — note: `.find()` returns the toast
   object itself, which is truthy, or `undefined`, which is falsy, so this is a valid
   existence check):
   - `this.toasts = this.toasts.map(toast => ...)` — rebuilds the whole array,
     replacing only the matching-id entry, leaving all others as the same object
     references.
   - For the matching entry:
     - **Publishes** `{ ...toast (old), ...data (new call's data), id, title: message }`.
       **Critically, this published object omits an explicit `dismissible` key.** If
       the caller's `data` argument didn't include a `dismissible` property at all
       (the common case), `...data` contributes nothing for that key, so the
       published object's `dismissible` comes from `...toast` (the **previous**
       stored value for that toast) — NOT from the freshly computed `dismissible`
       local variable.
     - **Stores** (returned from the `.map` callback, becomes the new `this.toasts`
       entry) `{ ...toast (old), ...data (new), id, dismissible (computed step 5),
       title: message }` — this **does** explicitly set `dismissible` to the freshly
       computed value.
     - **Net effect (must be preserved byte-for-byte)**: if a toast is updated
       without the caller passing an explicit `dismissible` in that call, and the
       toast's previously-stored `dismissible` was `false`, the **published** event
       that the Toast/Toaster component receives still carries the *old* `dismissible:
       false`, while the array entry `Observer.toasts` gets updated to `dismissible:
       true` (the recomputed default) for any *subsequent* lookup/read. This is a
       genuine, subtle discrepancy in upstream sonner — replicate it exactly (do not
       "fix" it by adding `dismissible` to the published object) since the ported
       Playwright/Vitest suite is written against this exact behavior.
   - Non-matching entries pass through unchanged (`return toast;`).

7. **Create branch** (`alreadyExists` falsy): `this.addToast({ title: message, ...rest,
   dismissible, id })` — note `id` is placed **last** in the object literal, so it
   always wins over any `id` that might have survived into `rest` (it would only be
   there if the caller passed a non-`id`-shaped duplicate key, which can't happen
   given `rest` is `data` minus only `message` — but `rest.id` genuinely can differ in
   type from the just-computed `id` when, e.g., `data.id` was an empty string: then
   `rest.id === ''` but the computed `id` is a fresh counter number — the final `id`
   key wins, `''` is discarded). Uses `addToast`, so this both publishes and appends
   (§2.5).

8. **Return value**: the resolved `id` (number or non-empty string), in both branches.

### 2.7 `dismiss`

```ts
dismiss = (id?: number | string) => {
  if (id) {
    this.dismissedToasts.add(id);
    requestAnimationFrame(() => this.subscribers.forEach((subscriber) => subscriber({ id, dismiss: true })));
  } else {
    this.toasts.forEach((toast) => {
      this.subscribers.forEach((subscriber) => subscriber({ id: toast.id, dismiss: true }));
    });
  }

  return id;
};
```

Two entirely different code paths depending on truthiness of `id` (not
`typeof id !== 'undefined'` — **truthiness**, so `id === 0` falls into the `else`
branch, i.e. `toast.dismiss(0)` dismisses **all** toasts, not the toast with id `0`.
This is the same "falsy zero" characteristic as `create()`'s id resolution getting it
right — `dismiss()` does **not** get it right. Preserve exactly.):

- **With a truthy `id`**:
  1. `this.dismissedToasts.add(id)` — synchronous, immediate.
  2. `requestAnimationFrame(() => ...)` — the actual `{id, dismiss: true}` publish to
     subscribers is deferred to the next animation frame. `getActiveToasts()` called
     synchronously right after `dismiss(id)` will already exclude this id (step 1 is
     sync), but subscribers (e.g. the rendered `Toast` component) don't get notified
     of the dismiss event until the next rAF tick.
- **Without an `id`** (`undefined`, or falsy including `0`, `''`, `NaN`):
  - Iterates **every** entry currently in `this.toasts` (the full history array, not
    filtered by already-dismissed) and, for each, synchronously (no `rAF`) fans out
    `{id: toast.id, dismiss: true}` to every subscriber.
  - **Does NOT add any of these ids to `dismissedToasts`.** This is intentional/as-is
    in the source — "dismiss all" relies entirely on the subscriber side effect (the
    rendered components) to actually remove themselves; `Observer`'s own bookkeeping
    (`dismissedToasts`, hence `getActiveToasts()`) is untouched by a no-id `dismiss()`
    call. Concretely: immediately after `toast.dismiss()` (no id) `ToastState
    .getActiveToasts()` / `toast.getToasts()` still returns the same toasts as before
    the call — only the subscriber notification differs.
- Returns the `id` argument as received (so `undefined` when called with no
  arguments).

### 2.8 Type wrappers: `message`, `error`, `success`, `info`, `warning`, `loading`

All six delegate to `create()`. Transcribe literally (spread/key order is irrelevant
functionally here since there are no duplicate keys across `data` and the literal
extras, but transcribe as shown for diff-cleanliness against upstream):

```ts
message = (message: titleT, data?: ExternalToast) => {
  return this.create({ ...data, message });
};

error = (message: titleT, data?: ExternalToast) => {
  return this.create({ ...data, message, type: 'error' });
};

success = (message: titleT, data?: ExternalToast) => {
  return this.create({ ...data, type: 'success', message });
};

info = (message: titleT, data?: ExternalToast) => {
  return this.create({ ...data, type: 'info', message });
};

warning = (message: titleT, data?: ExternalToast) => {
  return this.create({ ...data, type: 'warning', message });
};

loading = (message: titleT, data?: ExternalToast) => {
  return this.create({ ...data, type: 'loading', message });
};
```

`message()` sets no `type` — the resulting toast's `type` stays `undefined` (the
Toast-rendering slice treats `undefined`/unspecified type as `'normal'` display —
that default lives in the Toast component, out of scope here).

### 2.9 `promise` — full flow, every branch

Signature: `promise = <ToastData>(promise: PromiseT<ToastData>, data?: PromiseData<ToastData>) => ...`

**Step 0 — guard**: `if (!data) return;` — if no second argument is supplied at all,
the method does nothing and returns `undefined` synchronously. (Note: this checks
`data` itself, not any field of it — even `data = {}` proceeds past this guard.)

**Step 1 — optional loading toast**:
```ts
let id: string | number | undefined = undefined;
if (data.loading !== undefined) {
  id = this.create({
    ...data,
    promise,
    type: 'loading',
    message: data.loading,
    description: typeof data.description !== 'function' ? data.description : undefined,
  });
}
```
- Only creates a loading toast if `data.loading !== undefined`. If omitted, `id` stays
  `undefined` for the rest of the synchronous setup (this matters for step 6/7 below —
  every subsequent `this.create({id, ...})` call is invoked with `id: undefined`,
  which per `create()`'s id-resolution (§2.6 step 2) always mints a **brand-new** id —
  i.e. without a `loading` message, success/error outcomes appear as new toasts rather
  than replacing an existing one).
- `description`: if it's **not** a function (a plain string/Renderable, including
  `undefined`), it's passed through immediately to the loading toast. If it **is** a
  function, the loading toast's `description` is left `undefined` — the function gets
  invoked later, per outcome branch, with the settled value/error as its argument
  (steps 3-6 below).
- The full `data` object is spread in (so `PromiseData`'s `success`/`error`/`finally`
  fields also technically land on the loading `ToastT`, though they're not
  `ToastT`-schema fields and are simply inert extra properties there — harmless,
  replicate as-is via the spread, don't manually strip them).

**Step 2 — normalize to a `Promise`**:
```ts
const p = Promise.resolve(promise instanceof Function ? promise() : promise);
```
Accepts either an already-created `Promise` or a zero-arg function that returns one;
calls it if it's a function.

**Step 3 — tracking state**:
```ts
let shouldDismiss = id !== undefined;
let result: ['resolve', ToastData] | ['reject', unknown];
```
`shouldDismiss` starts `true` only if a loading toast was actually created (`id`
defined at this synchronous point). It is set to `false` inside any branch below that
explicitly shows a replacement toast — the intent being "if we showed something new
for this outcome, don't also auto-dismiss the loading toast; if nothing matched, the
loading toast should be auto-dismissed since it would otherwise sit forever."

**Step 4 — `.then()` branch** (fulfilled path), branches checked **in this exact
order**, first match wins (subsequent `else if`s are skipped once one matches; if
**none** match, nothing happens — `shouldDismiss` is left at whatever it was, i.e.
still `true` if there was a loading toast, so it gets silently dismissed in
`.finally()` with no replacement shown):

```ts
.then(async (response) => {
  result = ['resolve', response];
  const isVNodeResponse = isVNode(response); // React.isValidElement(response)

  if (isVNodeResponse) {
    shouldDismiss = false;
    this.create({ id, type: 'default', message: response });
    // response used directly as the toast `message` — assumes it's already a
    // renderable VNode. `data.success` is NOT consulted in this branch.

  } else if (isHttpResponse(response) && !response.ok) {
    shouldDismiss = false;
    const promiseData =
      typeof data.error === 'function'
        ? await data.error(`HTTP error! status: ${response.status}`)
        : data.error;
    const description =
      typeof data.description === 'function'
        ? await data.description(`HTTP error! status: ${response.status}`)
        : data.description;
    const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData);
    const toastSettings: PromiseIExtendedResult = isExtendedResult
      ? (promiseData as PromiseIExtendedResult)
      : { message: promiseData as Renderable };
    this.create({ id, type: 'error', description, ...toastSettings });

  } else if (response instanceof Error) {
    shouldDismiss = false;
    const promiseData = typeof data.error === 'function' ? await data.error(response) : data.error;
    const description = typeof data.description === 'function' ? await data.description(response) : data.description;
    const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData);
    const toastSettings: PromiseIExtendedResult = isExtendedResult
      ? (promiseData as PromiseIExtendedResult)
      : { message: promiseData as Renderable };
    this.create({ id, type: 'error', description, ...toastSettings });

  } else if (data.success !== undefined) {
    shouldDismiss = false;
    const promiseData = typeof data.success === 'function' ? await data.success(response) : data.success;
    const description = typeof data.description === 'function' ? await data.description(response) : data.description;
    const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData);
    const toastSettings: PromiseIExtendedResult = isExtendedResult
      ? (promiseData as PromiseIExtendedResult)
      : { message: promiseData as Renderable };
    this.create({ id, type: 'success', description, ...toastSettings });
  }
  // else: no branch matched -> no this.create() call at all. shouldDismiss unchanged.
})
```

Branch order and exact conditions (do not reorder):
1. `isVNode(response)` — response IS already a renderable element → show it verbatim
   as a `type: 'default'` toast, reusing `id` (so it replaces the loading toast in
   place if `id` was defined, or creates fresh if not). `data.success` is **never**
   consulted when this branch matches, even if provided.
2. Else `isHttpResponse(response) && !response.ok` — response duck-types as a `fetch`
   `Response` (`isHttpResponse`, §2.13) AND its `.ok` is falsy → treated as an error
   despite the promise having *resolved* (not rejected). Runs the error-resolution
   sub-flow (see "error-resolution sub-flow" below) using the string
   `` `HTTP error! status: ${response.status}` `` as the argument passed to
   `data.error`/`data.description` when they're functions.
3. Else `response instanceof Error` — resolved value is itself an `Error` instance
   (unusual but possible if a caller resolves with an Error object rather than
   rejecting) → same error-resolution sub-flow, but the argument passed to
   `data.error`/`data.description` (when functions) is the `Error` object itself.
4. Else `data.success !== undefined` — the normal success path. Runs the
   "success-resolution sub-flow" (mirror of the error one, using `data.success`),
   argument passed to functions is `response` itself, resulting toast `type:
   'success'`.
5. Else (nothing matched, most commonly: resolved with a plain value and no
   `data.success` configured) — **no toast is created for this outcome at all**.

**"Error/success-resolution sub-flow"** (identical shape, only the source field
differs — `data.error` vs `data.success` — and the resulting `type` — `'error'` vs
`'success'`):
1. Resolve `promiseData`: if the relevant field (`data.error`/`data.success`) is a
   `function`, `await` it with the branch-specific argument (see above); otherwise use
   the field's value as-is (which may itself be `undefined` in the HTTP/Error
   fallthrough-triggered error branches, since those trigger `data.error`-based
   resolution unconditionally — note that unlike the plain-`.catch()` path (step 5
   below) and the success branch, **the HTTP-not-ok and `Error`-instance branches do
   NOT gate on whether `data.error !== undefined`** — they always run the
   error-resolution logic and always call `this.create(..., type: 'error', ...)`, even
   if `data.error` was never provided by the caller, in which case `promiseData` ends
   up `undefined` and the resulting toast's `message` is `undefined`).
2. Resolve `description`: if `data.description` is a `function`, `await` it with the
   same branch-specific argument; otherwise use `data.description` as-is.
3. `isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData)` —
   true when the resolved handler value is a plain object (the `PromiseIExtendedResult`
   shape, e.g. `{message: '...', description: '...', action: {...}}`) rather than a
   primitive/VNode. **Edge case**: `typeof null === 'object'`, so if a handler
   explicitly returns/resolves `null`, `isExtendedResult` is `true` and
   `toastSettings` becomes `null`; spreading `...null` in an object literal is valid
   JS and contributes no properties — net effect, the created toast gets no `message`
   from `toastSettings` (falls through to whatever `create()` defaults to, i.e.
   `undefined` title). Preserve this (don't special-case `null`).
4. `toastSettings: PromiseIExtendedResult = isExtendedResult ? promiseData : {message: promiseData}`.
5. `this.create({ id, type: 'error' | 'success', description, ...toastSettings })` —
   note `toastSettings` is spread **after** `description`, so if `toastSettings`
   happens to carry its own `description` key (i.e. `promiseData` was an extended
   result object that itself included a `description` field), that **overrides** the
   `description` computed in step 2. This is how a handler can override the
   promise-level `description` on a per-outcome basis.

**Step 5 — `.catch()` branch** (rejected path):
```ts
.catch(async (error) => {
  result = ['reject', error];
  if (data.error !== undefined) {
    shouldDismiss = false;
    const promiseData = typeof data.error === 'function' ? await data.error(error) : data.error;
    const description = typeof data.description === 'function' ? await data.description(error) : data.description;
    const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData);
    const toastSettings: PromiseIExtendedResult = isExtendedResult
      ? (promiseData as PromiseIExtendedResult)
      : { message: promiseData as Renderable };
    this.create({ id, type: 'error', description, ...toastSettings });
  }
  // else: data.error undefined -> no toast shown, shouldDismiss unchanged (loading
  // toast, if any, will be silently dismissed in .finally()).
})
```
Unlike the `.then()` branch's HTTP/Error sub-cases, this **does** gate on
`data.error !== undefined` before doing anything — if the caller didn't configure an
`error` handler/value, a rejected promise with a `loading` toast showing will just
silently dismiss that loading toast (no error toast appears) once `.finally()` runs.

**Step 6 — `.finally()`**:
```ts
.finally(() => {
  if (shouldDismiss) {
    this.dismiss(id);
    id = undefined;
  }
  data.finally?.();
})
```
- If `shouldDismiss` is still `true` at this point (loading toast existed and no
  branch above matched to replace it), calls `this.dismiss(id)` (the single-id branch,
  §2.7 — including its `requestAnimationFrame`-deferred publish) then reassigns the
  outer closure's `id` variable to `undefined`. This reassignment happens
  **asynchronously**, after the promise settles — it does **not** retroactively affect
  the synchronous return value already computed by the time `.finally()` runs (see
  Step 8 below — the return-value decision is made synchronously, before any of
  `.then`/`.catch`/`.finally` execute, since those are all async microtask callbacks).
- Always invokes `data.finally?.()` (optional call — no-op if not provided) regardless
  of `shouldDismiss`, and regardless of resolve/reject outcome. Its return value
  (possibly a `Promise`) is not awaited/used.

**Step 7 — `unwrap()`**:
```ts
const unwrap = () =>
  new Promise<ToastData>((resolve, reject) =>
    originalPromise.then(() => (result[0] === 'reject' ? reject(result[1]) : resolve(result[1]))).catch(reject),
  );
```
`originalPromise` is the full `.then().catch().finally()` chain from steps 4-6, which
by construction never itself rejects (its own `.catch()` swallows the original
rejection). `unwrap()` builds a **fresh** `Promise` each time it's called that: waits
for `originalPromise` to settle (always fulfills, since its rejections are caught),
then inspects the closed-over `result` tuple (set synchronously inside the `.then`/
`.catch` callbacks in steps 4/5) — if `result[0] === 'reject'`, rejects the returned
promise with `result[1]` (the original error); otherwise resolves with `result[1]`
(the original resolved value). The extra `.catch(reject)` on the outer chain guards
against a throw inside this resolution logic itself. Net effect: `unwrap()` gives
callers a way to get back the *original* promise's settlement (value or error)
**after** all the toast-side-effect handling above has already run to completion —
useful for `await toast.promise(p, {...}).unwrap()` patterns.

**Step 8 — return value** (synchronous, evaluated immediately after the chain is
constructed, using `id`'s value from Step 1 — **before** any async
`.then`/`.catch`/`.finally` callback has had a chance to run, since those are always
deferred to microtasks even for an already-resolved promise):
```ts
if (typeof id !== 'string' && typeof id !== 'number') {
  return { unwrap };
} else {
  return Object.assign(id, { unwrap });
}
```
- If no loading toast was created (`id` still `undefined`), returns a plain object
  `{ unwrap }`.
- If a loading toast **was** created, returns `Object.assign(id, { unwrap })`. Since
  `id` is a primitive (`number` or `string`), `Object.assign`'s target argument gets
  boxed via `ToObject` — the return value is a **boxed `Number`/`String` wrapper
  object** (not a primitive!) with an own `unwrap` property attached. This is a real,
  documented quirk of upstream sonner: `const t = toast.promise(p, {loading: '...'})`
  yields `typeof t === 'object'`, not `'number'`, even though `t` is
  `==`-comparable to the numeric id and stringifies to it. Comparisons using `===`
  against a raw number/string id will **fail** against this return value; `==` and
  template-literal interpolation work because of `valueOf`/`toString` boxing
  semantics. **Preserve this exactly** — do not "fix" it into a plain
  `{ id, unwrap }` shape, since the ported test suite may assert on this exact boxing
  behavior (e.g. `String(toast.promise(...))` producing the id).

### 2.10 `custom`

```ts
custom = (jsx: (id: number | string) => VNode | Component, data?: ExternalToast) => {
  const id = data?.id || toastsCounter++;
  this.create({ jsx: jsx(id), ...data, id });
  return id;
};
```
- ID resolution here uses `data?.id || toastsCounter++` — **truthiness**, not the
  careful `typeof === 'number'` check `create()` uses internally. This means
  `toast.custom(cb, {id: 0})` does **not** reuse id `0` — it falls through to
  `toastsCounter++` and mints a fresh id, because `0` is falsy. This is the same
  "falsy zero" class of quirk as `dismiss()` (§2.7) and differs from `create()`'s own
  internal id logic (§2.6 step 2). Preserve exactly — do not harmonize it with
  `create()`'s logic.
- `jsx(id)` is invoked **synchronously**, immediately, with the id just resolved
  (whether reused from `data.id` or freshly minted) — the callback's `id` argument is
  guaranteed consistent with the `id` ultimately used by `create()` right after.
  Object literal order: `{ jsx: jsx(id), ...data, id }` — `id` is last so it always
  wins even though `data` (spread in the middle) can't itself contain a conflicting
  `jsx` key (excluded from `ExternalToast`) but could theoretically contain `id` if
  the caller passed one (consistent value, no actual conflict).
- Returns the resolved `id`.

### 2.11 `getActiveToasts`

```ts
getActiveToasts = () => {
  return this.toasts.filter((toast) => !this.dismissedToasts.has(toast.id));
};
```
Filters the full history array down to entries whose id is **not** in
`dismissedToasts`. Given `dismissedToasts` is populated only by `dismiss(id)`'s
truthy-id branch (§2.7), a toast dismissed via `dismiss()` with no argument (dismiss
all) or via `dismiss(0)` (falsy-zero quirk) will **still appear** in
`getActiveToasts()`'s result until/unless something else marks its id dismissed or the
Toast/Toaster component layer separately purges it from `this.toasts` (it can't —
`Observer` never removes from `this.toasts`, only the components' own local state
does, which `Observer` has no visibility into).

### 2.12 `ToastState` singleton

```ts
export const ToastState = new Observer();
```
Single module-level instance, constructed once at module evaluation time. All of
`toast.*`'s methods below are this instance's bound (arrow-function) methods.

### 2.13 `isHttpResponse` helper

```ts
const isHttpResponse = (data: any): data is Response => {
  return (
    data &&
    typeof data === 'object' &&
    'ok' in data &&
    typeof data.ok === 'boolean' &&
    'status' in data &&
    typeof data.status === 'number'
  );
};
```
Module-private (not exported), duck-types anything shaped like a Fetch `Response`
(has boolean `.ok` and numeric `.status`) — used only by `promise()`'s `.then()`
branch (§2.9 step 4, branch 2). Port verbatim, no framework-specific change needed.

### 2.14 Base callable `toast(message, data)` — NOT the same code path as `create()`

```ts
const toastFunction = (message: titleT, data?: ExternalToast) => {
  const id = data?.id || toastsCounter++;

  ToastState.addToast({
    title: message,
    ...data,
    id,
  });
  return id;
};

const basicToast = toastFunction;
```

**This is the single most important asymmetry in the module to flag**: calling the
base export as a function — `toast('hello')` / `toast('hello', {...})` — does **not**
go through `Observer.create()`. It calls `ToastState.addToast()` **directly**. As a
consequence, compared to `toast.message(...)`/`toast.success(...)`/etc. (all of which
go through `create()`, §2.6/§2.8), the bare `toast(...)` call:
- **Never dedupes/updates** an existing toast with the same id — even if a toast with
  that exact id already exists in `this.toasts`, calling `toast('again', {id: sameId})`
  **appends a second entry** with the same id rather than updating the first in place
  (because it calls `addToast`, which unconditionally appends, not `create`, which
  checks `alreadyExists` first).
- **No `dismissible` default applied** — `dismissible` stays `undefined` unless the
  caller explicitly passed it in `data` (whereas `create()`-routed calls always get an
  explicit `true`/`false`).
- **No `dismissedToasts` cleanup** — does not un-dismiss a previously-dismissed id the
  way `create()` does.
- **Uses the truthy `||` id-resolution** (`data?.id || toastsCounter++`), so passing
  `{id: 0}` here also falls through to a freshly minted id (same falsy-zero quirk as
  `custom()`/`dismiss()`, §2.10/§2.7) — again inconsistent with `create()`'s careful
  `typeof === 'number'` handling.

Preserve this asymmetry exactly — do not "helpfully" route the base callable through
`create()` for consistency; the ported test suite is written against sonner's actual
(quirky) behavior.

### 2.15 Exported `toast` object — `Object.assign` structure

```ts
const getHistory = () => ToastState.toasts;
const getToasts = () => ToastState.getActiveToasts();

export const toast = Object.assign(
  basicToast,
  {
    success: ToastState.success,
    info: ToastState.info,
    warning: ToastState.warning,
    error: ToastState.error,
    custom: ToastState.custom,
    message: ToastState.message,
    promise: ToastState.promise,
    dismiss: ToastState.dismiss,
    loading: ToastState.loading,
  },
  { getHistory, getToasts },
);
```

- `Object.assign` called with **three** arguments: target = `basicToast` (the plain
  function from §2.14, mutated in place and returned), source 1 = an object literal of
  9 methods torn off `ToastState` (safe because they're arrow-function class fields,
  already bound to the `ToastState` instance — detaching them from the instance and
  reattaching as properties of the `toast` function object does not break their
  `this`), source 2 = `{ getHistory, getToasts }` (plain closures over `ToastState`,
  not methods needing `this` at all).
- End result: `toast` is simultaneously **callable** (`toast(msg, data)` →
  `toastFunction`, §2.14) **and** has 11 own properties: `success`, `info`, `warning`,
  `error`, `custom`, `message`, `promise`, `dismiss`, `loading`, `getHistory`,
  `getToasts`. There is deliberately **no** `toast.create` or `toast.getActiveToasts`
  exposed on the public object (those stay internal to `Observer`/`ToastState`).
- `toast.dismiss` is literally `ToastState.dismiss` (§2.7) — same function reference,
  same quirks (RAF-deferred single-id publish, no-RAF dismiss-all, no
  `dismissedToasts` population on dismiss-all, falsy-zero-dismisses-all).
- This entire block is framework-agnostic JS — port verbatim, only the type imports at
  the top of the file change (per §0/§2.1's `isVNode` import and the `Renderable`/
  `VNode`/`Component` type substitutions noted inline throughout §2.6-§2.10).

### 2.16 Full reference transcription (illustrative — adapt casts as needed for strict-mode compile, behavior must match exactly)

```ts
import { isVNode } from 'vue';
import type { Component, VNode } from 'vue';
import type {
  ExternalToast,
  PromiseData,
  PromiseIExtendedResult,
  PromiseT,
  Renderable,
  ToastT,
  ToastToDismiss,
  ToastTypes,
} from './types';

let toastsCounter = 1;

type titleT = (() => Renderable) | Renderable;

class Observer {
  subscribers: Array<(toast: ToastT | ToastToDismiss) => void>;
  toasts: Array<ToastT | ToastToDismiss>;
  dismissedToasts: Set<string | number>;

  constructor() {
    this.subscribers = [];
    this.toasts = [];
    this.dismissedToasts = new Set();
  }

  subscribe = (subscriber: (toast: ToastT | ToastToDismiss) => void) => {
    this.subscribers.push(subscriber);
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      this.subscribers.splice(index, 1);
    };
  };

  publish = (data: ToastT) => {
    this.subscribers.forEach((subscriber) => subscriber(data));
  };

  addToast = (data: ToastT) => {
    this.publish(data);
    this.toasts = [...this.toasts, data];
  };

  create = (
    data: ExternalToast & {
      message?: titleT;
      type?: ToastTypes;
      promise?: PromiseT;
      jsx?: VNode | Component;
    },
  ) => {
    const { message, ...rest } = data;
    const id =
      typeof data?.id === 'number'
        ? data.id
        : typeof data?.id === 'string' && data.id.length > 0
          ? data.id
          : toastsCounter++;
    const alreadyExists = this.toasts.find((toast) => toast.id === id);
    const dismissible = data.dismissible === undefined ? true : data.dismissible;

    if (this.dismissedToasts.has(id)) {
      this.dismissedToasts.delete(id);
    }

    if (alreadyExists) {
      this.toasts = this.toasts.map((toast) => {
        if (toast.id === id) {
          this.publish({ ...toast, ...data, id, title: message } as ToastT);
          return {
            ...toast,
            ...data,
            id,
            dismissible,
            title: message,
          } as ToastT;
        }
        return toast;
      });
    } else {
      this.addToast({ title: message, ...rest, dismissible, id } as ToastT);
    }

    return id;
  };

  dismiss = (id?: number | string) => {
    if (id) {
      this.dismissedToasts.add(id);
      requestAnimationFrame(() => this.subscribers.forEach((subscriber) => subscriber({ id, dismiss: true })));
    } else {
      this.toasts.forEach((toast) => {
        this.subscribers.forEach((subscriber) => subscriber({ id: toast.id, dismiss: true }));
      });
    }
    return id;
  };

  message = (message: titleT, data?: ExternalToast) => this.create({ ...data, message });
  error = (message: titleT, data?: ExternalToast) => this.create({ ...data, message, type: 'error' });
  success = (message: titleT, data?: ExternalToast) => this.create({ ...data, type: 'success', message });
  info = (message: titleT, data?: ExternalToast) => this.create({ ...data, type: 'info', message });
  warning = (message: titleT, data?: ExternalToast) => this.create({ ...data, type: 'warning', message });
  loading = (message: titleT, data?: ExternalToast) => this.create({ ...data, type: 'loading', message });

  promise = <ToastData,>(promise: PromiseT<ToastData>, data?: PromiseData<ToastData>) => {
    if (!data) return;

    let id: string | number | undefined = undefined;
    if (data.loading !== undefined) {
      id = this.create({
        ...data,
        promise,
        type: 'loading',
        message: data.loading,
        description: typeof data.description !== 'function' ? data.description : undefined,
      });
    }

    const p = Promise.resolve(promise instanceof Function ? promise() : promise);

    let shouldDismiss = id !== undefined;
    let result: ['resolve', ToastData] | ['reject', unknown];

    const originalPromise = p
      .then(async (response) => {
        result = ['resolve', response];
        const isVNodeResponse = isVNode(response as any);

        if (isVNodeResponse) {
          shouldDismiss = false;
          this.create({ id, type: 'default', message: response as unknown as Renderable });
        } else if (isHttpResponse(response) && !(response as any).ok) {
          shouldDismiss = false;
          const promiseData =
            typeof data.error === 'function'
              ? await (data.error as any)(`HTTP error! status: ${(response as any).status}`)
              : data.error;
          const description =
            typeof data.description === 'function'
              ? await (data.description as any)(`HTTP error! status: ${(response as any).status}`)
              : data.description;
          const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData as any);
          const toastSettings: PromiseIExtendedResult = isExtendedResult
            ? (promiseData as PromiseIExtendedResult)
            : ({ message: promiseData } as PromiseIExtendedResult);
          this.create({ id, type: 'error', description, ...toastSettings });
        } else if (response instanceof Error) {
          shouldDismiss = false;
          const promiseData = typeof data.error === 'function' ? await (data.error as any)(response) : data.error;
          const description =
            typeof data.description === 'function' ? await (data.description as any)(response) : data.description;
          const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData as any);
          const toastSettings: PromiseIExtendedResult = isExtendedResult
            ? (promiseData as PromiseIExtendedResult)
            : ({ message: promiseData } as PromiseIExtendedResult);
          this.create({ id, type: 'error', description, ...toastSettings });
        } else if (data.success !== undefined) {
          shouldDismiss = false;
          const promiseData = typeof data.success === 'function' ? await (data.success as any)(response) : data.success;
          const description =
            typeof data.description === 'function' ? await (data.description as any)(response) : data.description;
          const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData as any);
          const toastSettings: PromiseIExtendedResult = isExtendedResult
            ? (promiseData as PromiseIExtendedResult)
            : ({ message: promiseData } as PromiseIExtendedResult);
          this.create({ id, type: 'success', description, ...toastSettings });
        }
      })
      .catch(async (error) => {
        result = ['reject', error];
        if (data.error !== undefined) {
          shouldDismiss = false;
          const promiseData = typeof data.error === 'function' ? await (data.error as any)(error) : data.error;
          const description =
            typeof data.description === 'function' ? await (data.description as any)(error) : data.description;
          const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData as any);
          const toastSettings: PromiseIExtendedResult = isExtendedResult
            ? (promiseData as PromiseIExtendedResult)
            : ({ message: promiseData } as PromiseIExtendedResult);
          this.create({ id, type: 'error', description, ...toastSettings });
        }
      })
      .finally(() => {
        if (shouldDismiss) {
          this.dismiss(id);
          id = undefined;
        }
        data.finally?.();
      });

    const unwrap = () =>
      new Promise<ToastData>((resolve, reject) =>
        originalPromise
          .then(() => (result[0] === 'reject' ? reject(result[1]) : resolve(result[1] as ToastData)))
          .catch(reject),
      );

    if (typeof id !== 'string' && typeof id !== 'number') {
      return { unwrap };
    } else {
      return Object.assign(id, { unwrap });
    }
  };

  custom = (jsx: (id: number | string) => VNode | Component, data?: ExternalToast) => {
    const id = data?.id || toastsCounter++;
    this.create({ jsx: jsx(id), ...data, id });
    return id;
  };

  getActiveToasts = () => {
    return this.toasts.filter((toast) => !this.dismissedToasts.has(toast.id));
  };
}

export const ToastState = new Observer();

const toastFunction = (message: titleT, data?: ExternalToast) => {
  const id = data?.id || toastsCounter++;
  ToastState.addToast({ title: message, ...data, id } as ToastT);
  return id;
};

const isHttpResponse = (data: any): data is Response => {
  return (
    data &&
    typeof data === 'object' &&
    'ok' in data &&
    typeof data.ok === 'boolean' &&
    'status' in data &&
    typeof data.status === 'number'
  );
};

const basicToast = toastFunction;

const getHistory = () => ToastState.toasts;
const getToasts = () => ToastState.getActiveToasts();

export const toast = Object.assign(
  basicToast,
  {
    success: ToastState.success,
    info: ToastState.info,
    warning: ToastState.warning,
    error: ToastState.error,
    custom: ToastState.custom,
    message: ToastState.message,
    promise: ToastState.promise,
    dismiss: ToastState.dismiss,
    loading: ToastState.loading,
  },
  { getHistory, getToasts },
);
```

---

## 3. `src/hooks.ts` (source: `hooks.tsx`)

### 3.1 `useIsDocumentHidden` — exact React behavior

```ts
export const useIsDocumentHidden = () => {
  const [isDocumentHidden, setIsDocumentHidden] = React.useState(document.hidden);

  React.useEffect(() => {
    const callback = () => {
      setIsDocumentHidden(document.hidden);
    };
    document.addEventListener('visibilitychange', callback);
    return () => document.removeEventListener('visibilitychange', callback);
  }, []);

  return isDocumentHidden;
};
```
- Initial state: `document.hidden` (a `boolean`), read **at hook-invocation time**
  (component construction), not lazily.
- Effect has an **empty dependency array** — runs exactly once after initial
  mount, registers a `'visibilitychange'` listener on `document` (not `window`),
  cleans up (`removeEventListener`, same event name/handler reference) on unmount.
  No re-registration on any prop/state change (there are none — this hook takes no
  arguments).
- The listener's callback re-reads `document.hidden` (not the event object) and
  pushes it into state — so every `'visibilitychange'` event just re-syncs to
  whatever `document.hidden` currently is.
- Returns the current boolean value (not a setter — read-only from the consumer's
  perspective).

### 3.2 Vue composable port

```ts
import { onMounted, onUnmounted, ref } from 'vue';

export function useIsDocumentHidden() {
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

  return isDocumentHidden; // Ref<boolean> — callers read `.value`
}
```
Mapping rationale: `useState` → `ref()` (initial value computed once at composable
call time, same timing as React's hook call). `useEffect(fn, [])` (mount-only, with
cleanup) → `onMounted` for the setup half + `onUnmounted` for the teardown half (per
ARCHITECTURE.md line 39-41: "mount-only effect → `onMounted`... cleanup fns → watch
cleanup / `onUnmounted`"). Event name (`'visibilitychange'`), target (`document`, not
`window`), and the "re-read `document.hidden`, don't use the event payload" behavior
are all preserved exactly.

Consumers (the Toast.vue component, out of this slice) will use `isDocumentHidden.value`
wherever the React source reads the hook's return value directly.

### 3.3 `useSonner` is NOT in this file

ARCHITECTURE.md's public export list (`{ toast, Toaster, useSonner }`) includes
`useSonner`, but its React implementation lives in `sonner-react/src/index.tsx`
(around line 552), **not** in `hooks.tsx`. It is out of scope for this spec/slice —
it belongs to whichever spec covers `index.tsx`/`Toaster.vue`. Do not expect it in the
ported `src/hooks.ts`; do not fabricate it here.

---

## 4. `src/assets.ts` (source: `assets.tsx`)

### 4.1 `getAsset` — behavior

```ts
export const getAsset = (type: ToastTypes): JSX.Element | null => {
  switch (type) {
    case 'success': return SuccessIcon;
    case 'info': return InfoIcon;
    case 'warning': return WarningIcon;
    case 'error': return ErrorIcon;
    default: return null;
  }
};
```
Exactly 4 `ToastTypes` values map to an icon: `'success'`, `'info'`, `'warning'`,
`'error'`. **Every other value** — `'normal'`, `'action'`, `'loading'`, `'default'`,
and `undefined`/unspecified — falls through to `default: return null` (no icon).
Note `'loading'` returns `null` here on purpose: the loading state is rendered via the
separate `Loader` component (§4.4), not through `getAsset`.

**Vue-specific structural requirement (deviation from a literal transcription,
required by how Vue's rendering model differs from React's — not optional)**: in the
React source, `SuccessIcon`/`WarningIcon`/`InfoIcon`/`ErrorIcon` are **module-level
constant JSX element values** (already-instantiated React elements), and the exact
same element object reference is returned by every call to `getAsset('success')` etc.
React elements are cheap, immutable, and safe to reuse across multiple renders/trees.
**Vue `VNode`s are not** — a `VNode` object carries mount-time state (`el`, patch
flags) and Vue explicitly does not support mounting the same `VNode` instance in
multiple places in a render tree simultaneously (multiple toasts of the same type
rendered at once would share one `VNode` object, which breaks Vue's reconciliation —
in dev mode Vue warns "vnode has already been mounted"/similar, and in general the
mounted instance's DOM node would only be able to exist in one place). Therefore, in
the Vue port these four values **must** be zero-argument functions (Vue "functional
components" — any plain function returning a `VNode` qualifies) that build a **fresh**
`VNode` on every invocation, and `getAsset` returns the **function reference**, not a
pre-built `VNode`:

```ts
export const getAsset = (type: ToastTypes): (() => VNode) | null => {
  switch (type) {
    case 'success':
      return SuccessIcon;
    case 'info':
      return InfoIcon;
    case 'warning':
      return WarningIcon;
    case 'error':
      return ErrorIcon;
    default:
      return null;
  }
};
```
Consumers render the result via `h(icon)` (if truthy) — this is a Toast.vue-slice
concern, noted here only so the return-type contract is unambiguous.

### 4.2 Exact SVG markup — success / warning / info / error icons

These four SVGs must render **byte-identical DOM output** to the React version. The
critical gotcha: JSX attribute names like `fillRule`/`clipRule` are **React's**
camelCase convention for the real SVG presentation attributes `fill-rule`/`clip-rule`
— React's DOM renderer silently translates a fixed table of camelCase JSX prop names
to their hyphenated real attribute names for SVG elements. **Vue's `h()` does not do
this translation** (there is no JSX compiler step involved per ARCHITECTURE.md's
`assets.ts` being a plain `.ts` file, not `.tsx`) — whatever string key you pass in the
props object to `h()` is set essentially as-is via `setAttribute`. Passing
`fillRule: 'evenodd'` to `h('path', {...})` in Vue would set a non-standard attribute
literally named `fillRule` (or `fillrule` depending on casing normalization), which
the SVG spec does not recognize, silently defaulting the actual `fill-rule` to
`nonzero` instead of `evenodd` and changing the rendered shape. **The port must use the
literal hyphenated attribute keys** (`'fill-rule'`, `'clip-rule'`) as object keys in
every `h()` call for these paths. `viewBox` needs no translation — it is natively
mixed-case in the SVG spec itself (not a JSX-only convention), so both React and raw
DOM `setAttribute('viewBox', ...)` use the identical string; pass it through as
`viewBox` unchanged.

**Success icon** (`viewBox="0 0 20 20"`):
```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" height="20" width="20">
  <path
    fill-rule="evenodd"
    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
    clip-rule="evenodd"
  />
</svg>
```
Vue `h()` target:
```ts
const SuccessIcon = () =>
  h(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 20 20', fill: 'currentColor', height: '20', width: '20' },
    [
      h('path', {
        'fill-rule': 'evenodd',
        d: 'M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z',
        'clip-rule': 'evenodd',
      }),
    ],
  );
```

**Warning icon** (`viewBox="0 0 24 24"` — different viewBox from the other three,
preserve exactly):
```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" height="20" width="20">
  <path
    fill-rule="evenodd"
    d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
    clip-rule="evenodd"
  />
</svg>
```
```ts
const WarningIcon = () =>
  h(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'currentColor', height: '20', width: '20' },
    [
      h('path', {
        'fill-rule': 'evenodd',
        d: 'M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z',
        'clip-rule': 'evenodd',
      }),
    ],
  );
```

**Info icon** (`viewBox="0 0 20 20"`):
```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" height="20" width="20">
  <path
    fill-rule="evenodd"
    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
    clip-rule="evenodd"
  />
</svg>
```
```ts
const InfoIcon = () =>
  h(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 20 20', fill: 'currentColor', height: '20', width: '20' },
    [
      h('path', {
        'fill-rule': 'evenodd',
        d: 'M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z',
        'clip-rule': 'evenodd',
      }),
    ],
  );
```

**Error icon** (`viewBox="0 0 20 20"`):
```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" height="20" width="20">
  <path
    fill-rule="evenodd"
    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
    clip-rule="evenodd"
  />
</svg>
```
```ts
const ErrorIcon = () =>
  h(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 20 20', fill: 'currentColor', height: '20', width: '20' },
    [
      h('path', {
        'fill-rule': 'evenodd',
        d: 'M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z',
        'clip-rule': 'evenodd',
      }),
    ],
  );
```

All four: `xmlns` = `'http://www.w3.org/2000/svg'`, `height` = `'20'`, `width` =
`'20'`, root `fill` = `'currentColor'` (only two distinct `viewBox` values across the
set — `'0 0 20 20'` for success/info/error, `'0 0 24 24'` for warning — verify against
the markup above per icon, do not assume they're all identical). Single `<path>` child
each, no other children/attributes.

None of these four are exported from the module (matches the React source — only
`getAsset`, `Loader`, `CloseIcon` are imported elsewhere, confirmed by grepping
`index.tsx`).

### 4.3 `Loader` component — exact structure

React source:
```tsx
const bars = Array(12).fill(0);

export const Loader = ({ visible, className }: { visible: boolean; className?: string }) => {
  return (
    <div className={['sonner-loading-wrapper', className].filter(Boolean).join(' ')} data-visible={visible}>
      <div className="sonner-spinner">
        {bars.map((_, i) => (
          <div className="sonner-loading-bar" key={`spinner-bar-${i}`} />
        ))}
      </div>
    </div>
  );
};
```

Exact structure to reproduce:
- Root `<div>`:
  - `class` = `['sonner-loading-wrapper', className].filter(Boolean).join(' ')` — if
    `className` is falsy (`undefined`, `''`), the result is just `'sonner-loading-wrapper'`
    (no trailing space); if truthy, `'sonner-loading-wrapper ' + className` (single
    space separator). **Do not always concatenate** — replicate the falsy-filter
    exactly, including the case of an explicitly passed empty-string `className`.
  - `data-visible` = the `visible` boolean prop. React stringifies non-native-boolean
    DOM attributes like `data-visible` to the literal strings `"true"`/`"false"` when
    rendering a JS boolean into a `data-*` attribute. For certainty across Vue
    versions, **explicitly stringify** in the port: `'data-visible': String(visible)`
    rather than relying on Vue's own boolean-attribute coercion for a non-whitelisted
    attribute name.
- One child `<div class="sonner-spinner">`.
- Inside that, exactly **12** `<div class="sonner-loading-bar">` elements (from
  `Array(12).fill(0).map(...)` — the mapped value itself, `0`, is unused; only the
  index `i` matters, used to build the React `key`). No other attributes on these
  divs. In the Vue port, pass an explicit `key: \`spinner-bar-${i}\`` in each `h()`
  call (same key string as the React source) for parity, even though Vue's `h()` API
  doesn't strictly require a key outside of `v-for`-compiled templates — using the
  same key values is good practice for diff/patch parity and costs nothing.

Vue `h()` target:
```ts
const bars = Array(12).fill(0);

export const Loader = ({ visible, className }: { visible: boolean; className?: string }) =>
  h(
    'div',
    {
      class: ['sonner-loading-wrapper', className].filter(Boolean).join(' '),
      'data-visible': String(visible),
    },
    [
      h(
        'div',
        { class: 'sonner-spinner' },
        bars.map((_, i) => h('div', { class: 'sonner-loading-bar', key: `spinner-bar-${i}` })),
      ),
    ],
  );
```

### 4.4 `CloseIcon` — exact structure

React source:
```tsx
export const CloseIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);
```

Same camelCase-to-kebab-case attribute gotcha as §4.2: `strokeWidth` → `'stroke-width'`,
`strokeLinecap` → `'stroke-linecap'`, `strokeLinejoin` → `'stroke-linejoin'` in the
Vue `h()` props object. `xmlns`, `width`, `height`, `viewBox`, `fill`, `stroke` are
already correctly-cased native attribute names, pass through unchanged.

Per §4.1's VNode-reuse constraint, `CloseIcon` must also become a zero-arg function
(not a bare constant `VNode`) in the Vue port, even though it's a single fixed icon
with no props — it can still be rendered in multiple toasts' close buttons
simultaneously (every toast with `closeButton: true` shows one), so the same
VNode-reuse hazard applies.

Vue `h()` target:
```ts
export const CloseIcon = () =>
  h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: '12',
      height: '12',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    [h('line', { x1: '18', y1: '6', x2: '6', y2: '18' }), h('line', { x1: '6', y1: '6', x2: '18', y2: '18' })],
  );
```
Two `<line>` children, no closing-tag content (both source lines are
`<line ...></line>` — empty elements, same as self-closing `<line ... />`, no visual/
DOM difference either way — `h('line', {...})` with no third argument produces the
correct empty element).

### 4.5 Consumption note (Toast.vue slice, referenced for context only)

`index.tsx` line 434 does `{icons?.close ?? CloseIcon}` — i.e. a caller-supplied
`icons.close` override (from `ToasterProps.icons`/`ToastIcons.close`, §1.1) takes
precedence over the built-in `CloseIcon`, falling back to the built-in only when
`icons?.close` is `null`/`undefined` (`??`, not `||` — so an explicitly falsy-but-defined
override like `''`/`0` would NOT fall back, though `ToastIcons.close`'s type doesn't
realistically permit those in practice). This is Toast.vue-slice implementation, noted
here only so the `CloseIcon`/`getAsset` export shapes are understood in their actual
call context.

### 4.6 Full reference transcription of `src/assets.ts`

```ts
import { h } from 'vue';
import type { VNode } from 'vue';
import type { ToastTypes } from './types';

export const getAsset = (type: ToastTypes): (() => VNode) | null => {
  switch (type) {
    case 'success':
      return SuccessIcon;
    case 'info':
      return InfoIcon;
    case 'warning':
      return WarningIcon;
    case 'error':
      return ErrorIcon;
    default:
      return null;
  }
};

const bars = Array(12).fill(0);

export const Loader = ({ visible, className }: { visible: boolean; className?: string }) =>
  h(
    'div',
    {
      class: ['sonner-loading-wrapper', className].filter(Boolean).join(' '),
      'data-visible': String(visible),
    },
    [
      h(
        'div',
        { class: 'sonner-spinner' },
        bars.map((_, i) => h('div', { class: 'sonner-loading-bar', key: `spinner-bar-${i}` })),
      ),
    ],
  );

const SuccessIcon = () =>
  h(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 20 20', fill: 'currentColor', height: '20', width: '20' },
    [
      h('path', {
        'fill-rule': 'evenodd',
        d: 'M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z',
        'clip-rule': 'evenodd',
      }),
    ],
  );

const WarningIcon = () =>
  h(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'currentColor', height: '20', width: '20' },
    [
      h('path', {
        'fill-rule': 'evenodd',
        d: 'M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z',
        'clip-rule': 'evenodd',
      }),
    ],
  );

const InfoIcon = () =>
  h(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 20 20', fill: 'currentColor', height: '20', width: '20' },
    [
      h('path', {
        'fill-rule': 'evenodd',
        d: 'M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z',
        'clip-rule': 'evenodd',
      }),
    ],
  );

const ErrorIcon = () =>
  h(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 20 20', fill: 'currentColor', height: '20', width: '20' },
    [
      h('path', {
        'fill-rule': 'evenodd',
        d: 'M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z',
        'clip-rule': 'evenodd',
      }),
    ],
  );

export const CloseIcon = () =>
  h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: '12',
      height: '12',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    [h('line', { x1: '18', y1: '6', x2: '6', y2: '18' }), h('line', { x1: '6', y1: '6', x2: '18', y2: '18' })],
  );
```

---

## 5. Summary of behaviors that look like bugs but must be preserved

For a reviewer's quick reference — every one of these is intentional-per-upstream and
the ported test suite is expected to assert on it, not "fix" it:

1. `create()`'s id resolution correctly handles `id === 0` (`typeof === 'number'`
   check); `dismiss()`, `custom()`, and the base `toastFunction()` all use truthy
   (`||`/`if (id)`) checks that mishandle `id === 0` (§2.6, §2.7, §2.10, §2.14).
2. `create()`'s update-path `publish()` call omits an explicit `dismissible` key while
   the array-stored version includes one — the published/subscribed value and the
   internally-stored value for `dismissible` can diverge for one tick (§2.6 step 6).
3. `dismiss()` with no id does not populate `dismissedToasts`, so
   `getActiveToasts()`/`toast.getToasts()` do not reflect a "dismiss all" until the
   component layer separately handles it (§2.7, §2.11).
4. `dismiss(id)` (truthy id) defers the actual subscriber notification to
   `requestAnimationFrame`; `dismissedToasts.add(id)` itself is synchronous (§2.7).
5. The base callable `toast(msg, data)` bypasses `create()` entirely (calls
   `addToast` directly) — no dedupe, no `dismissible` default, no un-dismiss-on-recreate
   (§2.14).
6. `toast.promise(...)`'s return value, when a `loading` toast was created, is a boxed
   `Number`/`String` object (via `Object.assign(id, {unwrap})`), not a primitive
   (§2.9 step 8).
7. In `promise()`'s `.then()`, the HTTP-not-ok and `Error`-instance branches always
   create an error toast (even with no `data.error` configured, `promiseData` just
   ends up `undefined`); the plain `.catch()` branch, by contrast, gates on
   `data.error !== undefined` before doing anything (§2.9 steps 4/5).
8. `Observer.toasts` never shrinks — nothing in `state.ts` removes an entry once
   added; `getHistory()` is the raw, ever-growing array (§2.2, §2.15).

---

## Open questions for the orchestrator (see structured output)

Recorded separately in this agent's structured output `openQuestions` field.

---

# Audit corrections (Opus verifier pass, authoritative — overrides anything above)

## AC-S1. `Loader` must be **called**, not mounted as a component (cross-slice, CRITICAL for the spinner's styling).

§4.3/§4.6 define `Loader` as a plain function `({visible, className}) => VNode`, and
`component-spec.md` §5.9 renders it as `<Loader className={…} visible={…} />`. If the Vue port
renders it with `h(Loader, { className, visible })`, Vue treats it as a **functional component
with undeclared props**: each entry becomes a prop *and* a fallthrough attr merged onto the
root element. `className` is a real DOM property, so Vue's `patchDOMProp` executes
`el.className = <value>`, **overwriting the `sonner-loading-wrapper` class** the function just
computed — every `.sonner-loading-wrapper` / `.sonner-spinner` / `.sonner-loading-bar` rule in
`styles.css` stops applying, and a stray `visible="true"` attribute leaks into the DOM.

**Mandate:** `Loader` is invoked directly as a function returning a `VNode`
(`Loader({ visible, className })`). If it is ever used with `h()`, it must additionally declare
`Loader.props = ['visible', 'className']` **and** `Loader.inheritAttrs = false`. Prefer the
direct call.

The four icon factories (`SuccessIcon`/`WarningIcon`/`InfoIcon`/`ErrorIcon`) and `CloseIcon`
are rendered with `h(Icon)` and **no props**, so they are unaffected — but for the same reason
they must never be handed props either (see `component-spec.md` AC-5: sonner v2.0.7 contains no
`cloneElement`, so no class is ever injected into an icon).

## AC-S2. Stored `VNode`s must be `cloneVNode()`d at render time.

`toast.jsx` (produced eagerly by `custom()` via `jsx(id)`), and any `VNode` passed as
`toast.icon` / `toast.action` / `toast.cancel` / `ToastIcons.*`, live in the module-level
`Observer.toasts` array and are re-rendered on every update — and can be rendered by **two
`Toaster` instances at once** (two `<Toaster/>`s without an `id` both receive every untagged
toast). A Vue `VNode` carries mount state (`.el`, `.component`) and cannot be mounted in two
places simultaneously. The shared `renderNode()` helper must `cloneVNode(v)` any `VNode` it is
handed (or at minimum when `v.el != null`). React elements have no such constraint, which is
why the source needs no equivalent. See `component-spec.md` AC-7.

## AC-S3. The boxed-`Number` return of `promise()` is not a valid `create()` id.

§2.9 step 8 correctly documents that `Object.assign(id, {unwrap})` returns a **boxed**
`Number`/`String`. Consequence worth stating explicitly for the implementer: feeding that
value back in as `data.id` (e.g. `toast.success('x', { id: toast.promise(...) })`) hits
`create()`'s id resolution with `typeof data.id === 'object'` → neither the `'number'` nor the
`'string'` branch matches → a **fresh** id is minted and the toast is *not* updated in place.
`toast.dismiss(boxedId)` does work (the truthiness check passes) but `dismissedToasts.add()`
stores the wrapper object, so `dismissedToasts.has(rawId)` is `false` — `getActiveToasts()`
will still list it. All of this is upstream behavior; preserve, do not normalize with
`valueOf()`.

## AC-S4. SSR / non-DOM environment notes (both preserve upstream behavior — do not add guards).

- `useIsDocumentHidden()` reads bare `document.hidden` at composable-call time with no
  `typeof document` guard (unlike `getDocumentDirection()`, which has one). Upstream React is
  identical. It is only reached from `Toast`, which never renders server-side (no toasts exist
  during SSR), so it is safe in practice. **Do not add an SSR guard** — that would deviate.
- `Observer.dismiss(id)` calls bare `requestAnimationFrame`. In a Node/Vitest environment
  without jsdom (or with jsdom lacking `pretendToBeVisual`), this throws. Upstream is
  identical. **Do not add a fallback in `state.ts`** — instead the unit-test slice must provide
  a `requestAnimationFrame` polyfill/stub in its test setup. Record this in the Vitest setup
  file, not in library code.

## AC-S5. §1.5's widening — one clarification the Toast slice depends on.

`component-spec.md` §6.3 resolves the widened `action`/`cancel` types with a three-way
`resolveActionSlot()` that renders bare strings (upstream renders nothing). This audit does
**not** overturn that decision — it remains an orchestrator call (see `openQuestions`) — but
records the parity consequence precisely: upstream sonner renders **nothing** for
`cancel: 'Undo'`; the widened port renders the text node `Undo` as a direct child of the
`<li>`, which `styles.css`'s `[data-sonner-toast][data-styled='true'] { display: flex; gap: 6px }`
will lay out as a flex item. If strict upstream parity is chosen instead, `resolveActionSlot`
must return `{kind:'none'}` for non-`Action`, non-`VNode` values.
