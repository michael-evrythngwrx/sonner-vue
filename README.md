# sonner-vue

An opinionated toast component, ported to Vue 3.

`sonner-vue` is a faithful, 1:1 port of [**sonner**](https://sonner.emilkowal.ski/) — the toast
library by [Emil Kowalski](https://emilkowal.ski/) — to Vue 3. All credit for the design,
animation, and API design of the original goes to Emil; this project only translates it. You can
read Emil's own write-up of the original ([why and how it was built](https://emilkowal.ski/ui/building-a-toast-component))
for background — everything about the *design* is his.

`sonner-vue` is an independent, unofficial port. It is not affiliated with, endorsed by, or
maintained by Emil Kowalski. Source: [sonner on GitHub](https://github.com/emilkowalski/sonner).

> **Not to be confused with `vue-sonner`.** `vue-sonner` is a separate, independently maintained
> package. `sonner-vue` is a different project: a strict 1:1 port of sonner **v2**'s DOM structure,
> CSS, animations, and public API, verified line-for-line against sonner's own Playwright test
> suite (see [Fidelity & testing](#fidelity--testing) below).

## Install

```bash
pnpm add sonner-vue
```

```bash
npm install sonner-vue
```

```bash
yarn add sonner-vue
```

`vue` `^3.4` is a peer dependency.

## Quick start

Mount `<Toaster />` once, near the root of your app — it's where every toast will be rendered.
Then call `toast()` from anywhere.

```vue
<!-- App.vue -->
<script setup lang="ts">
import { Toaster, toast } from 'sonner-vue';
</script>

<template>
  <Toaster />
  <button @click="toast('My first toast')">Give me a toast</button>
</template>
```

Styles are injected automatically — no CSS import required. If your app runs under a CSP that
blocks inline style/script injection (or you'd simply rather not have JS write a `<style>` tag),
import the stylesheet manually instead and it'll take over:

```ts
import 'sonner-vue/dist/styles.css';
```

## Usage

### Types

`toast()` renders a plain toast. Dedicated methods cover the common types:

```ts
toast('Event has been created');
toast.success('Event has been created');
toast.error('Event has not been created');
toast.info('Event has new information');
toast.warning('Event has a warning');
toast.loading('Event is being created');
```

### Description

Every method accepts a second `data` argument for options, including a `description`:

```ts
toast('Event has been created', {
  description: 'Monday, January 3rd at 6:00pm',
});
```

### Action & cancel buttons

Pass an `Action` — an object with `label` and `onClick` — for a button rendered inside the toast:

```ts
toast('Event has been created', {
  action: {
    label: 'Undo',
    onClick: () => console.log('Undo'),
  },
  cancel: {
    label: 'Cancel',
    onClick: () => console.log('Cancel'),
  },
});
```

`action` and `cancel` also accept a component or a `() => h(...)` thunk if you need a fully
custom node instead of a button — see [Vue-specific notes](#vue-specific-notes) for why a thunk
is preferred over a pre-built `VNode`. A bare string or number passed directly as `action`/`cancel`
(i.e. *not* wrapped in an `Action` object) intentionally renders nothing — that matches upstream
React sonner's own behavior, not a Vue-port gap.

### Promise

`toast.promise` takes a promise (or a function returning one) and updates the toast as it
settles:

```ts
toast.promise(() => fetchEvent(), {
  loading: 'Loading...',
  success: (data) => `${data.name} has been added`,
  error: 'Error creating event',
});
```

`success`, `error`, and `description` may each be a static value or a function of the
resolved/rejected value, and can return a richer object (`{ message, ...restOfExternalToast }`) to
set other toast options at the same time. `toast.promise` returns an object with `unwrap()`, which
resolves/rejects with the same result the original promise did once the toast lifecycle finishes:

```ts
const promise = () => new Promise((resolve) => setTimeout(() => resolve({ name: 'My toast' }), 2000));

toast.promise(promise, {
  loading: 'Loading...',
  success: (data) => `${data.name} toast has been added`,
  error: 'Error',
});

const data = await toast.promise(promise, { loading: 'Loading...' }).unwrap();
```

### Custom toast

`toast.custom` gives you the full toast body as a render function, called with the toast's id:

```ts
import { h } from 'vue';
import { toast } from 'sonner-vue';

toast.custom((id) => h(MyToast, { onClose: () => toast.dismiss(id) }));
```

### Dismiss

```ts
toast.dismiss(id); // dismiss one
toast.dismiss(); // dismiss all
```

### Reading toast state

`useSonner()` is a headless composable that mirrors the currently active toasts, useful for
building a fully custom renderer:

```ts
import { useSonner } from 'sonner-vue';

const { toasts } = useSonner(); // toasts.value: ToastT[]
```

`toast.getToasts()` returns the currently active toasts (not dismissed) and `toast.getHistory()`
returns every toast ever created, including dismissed ones — both as plain synchronous reads, no
subscription required.

## `<Toaster />` props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | — | Scopes this Toaster to only render toasts created with matching `toasterId`, for multiple independent `<Toaster />` instances. |
| `position` | `Position` | `'bottom-right'` | Where toasts are placed. One of `top-left`, `top-right`, `bottom-left`, `bottom-right`, `top-center`, `bottom-center`. |
| `richColors` | `boolean` | `false` | Colorizes toasts by type. |
| `expand` | `boolean` | `false` | Show all toasts expanded, not just on hover. |
| `visibleToasts` | `number` | `3` | Amount of visible toasts stacked before others are hidden. |
| `closeButton` | `boolean` | `false` | Adds a close button to every toast. |
| `offset` | `string \| number \| { top?, right?, bottom?, left? }` | `24px` | Offset from the viewport edge. |
| `mobileOffset` | same as `offset` | `16px` | Offset used on mobile viewports. |
| `theme` | `'light' \| 'dark' \| 'system'` | `'light'` | Sets `data-sonner-theme`; `'system'` follows `prefers-color-scheme` and updates live. |
| `dir` | `'rtl' \| 'ltr' \| 'auto'` | `'auto'` | Toast direction. `'auto'` reads `<html dir>`/computed style. |
| `hotkey` | `string[]` | `['altKey', 'KeyT']` | Keyboard shortcut that focuses the toast list. |
| `gap` | `number` | `14` | Gap between toasts, in pixels. |
| `icons` | `ToastIcons` | — | Overrides the default icon per type (`success`, `info`, `warning`, `error`, `loading`, `close`). |
| `toastOptions` | `ToastOptions` | — | Default options applied to every toast rendered by this Toaster (see below). |
| `invert` | `boolean` | `false` | Inverts toast colors. |
| `duration` | `number` | `4000` | Duration in ms before a toast auto-closes. |
| `swipeDirections` | `SwipeDirection[]` | derived from `position` | Directions a toast can be swiped to dismiss. |
| `containerAriaLabel` | `string` | `'Notifications'` | Base `aria-label` on the toast container. |
| `className` | `string` | — | Class applied to the toast list. |
| `style` | `CSSProperties` | — | Inline style applied to the toast list. |

### Per-toast options

The same shape (`ExternalToast`) is accepted as the second argument to `toast()`/`toast.success()`/etc.,
as well as via `<Toaster :toast-options="{ ... }">` to set library-wide defaults:

```ts
toast('Event has been created', {
  duration: 10000,
  unstyled: true,
  className: 'my-toast',
  classNames: { title: 'my-title', description: 'my-description' },
  closeButton: true,
  onDismiss: (t) => console.log('dismissed', t),
  onAutoClose: (t) => console.log('auto-closed', t),
});
```

A per-toast option always wins over the `Toaster`'s `toastOptions`, which in turn wins over the
`Toaster`'s own top-level prop (e.g. `toast(..., { duration: 10000 })` beats `toastOptions.duration`,
which beats `<Toaster :duration="4000" />`).

### Dark mode

```vue
<Toaster theme="dark" />
```

Pass `theme="system"` to follow the OS preference automatically, or manage the value yourself
(e.g. from a theme store) and bind it reactively — `<Toaster :theme="theme" />` re-renders live.

### Custom icons

```vue
<script setup lang="ts">
import { h } from 'vue';
import { Toaster } from 'sonner-vue';
</script>

<template>
  <Toaster
    :icons="{
      success: () => h(MySuccessIcon),
      error: () => h(MyErrorIcon),
    }"
  />
</template>
```

## Vue-specific notes

- **Renderable props.** Anywhere sonner-react accepts `ReactNode` (`title`, `description`, `icon`,
  `action`, `cancel`, custom `icons`, the `toast.custom` render function, ...), `sonner-vue` accepts
  `string | Component | VNode | () => VNode`. Prefer a thunk (`() => h(...)`) over handing it a
  pre-built `VNode` directly — thunks are re-invoked fresh each time they're needed, while a VNode
  created once and reused can misbehave if Vue has already mounted it elsewhere.
- **DOM node access.** React sonner exposes the toaster's root DOM node via `forwardRef`. Vue has
  no equivalent, so use a template ref and read `.$el` instead:

  ```vue
  <script setup lang="ts">
  import { ref, onMounted } from 'vue';
  import { Toaster } from 'sonner-vue';

  const toasterRef = ref<InstanceType<typeof Toaster>>();
  onMounted(() => console.log(toasterRef.value?.$el));
  </script>

  <template>
    <Toaster ref="toasterRef" />
  </template>
  ```

- **Everything else is 1:1.** DOM structure, `data-*` attributes, CSS custom properties, and the
  shipped stylesheet are unchanged from sonner. Any styling or theming guide written for sonner
  (custom CSS, `data-sonner-toast` selectors, `[data-rich-colors]`, etc.) applies to `sonner-vue`
  without translation.

## Fidelity & testing

`sonner-vue` is verified against sonner v2.0.7's own 36-test Playwright suite, ported with only
the import line changed — same test file, same assertions, same DOM contract, run against a Vue
playground app that reproduces sonner's test fixture exactly. That suite passes byte-identically.

On top of it, a 15-test DOM-parity regression suite and 200+ Vitest unit tests cover the toast
state machine, timers, and promise flows directly. Together these guarantee: any DOM structure,
class, `data-*` attribute, animation timing, or public API behavior that sonner's test suite
exercises behaves identically in `sonner-vue`. Behavior outside that suite's coverage isn't
guaranteed identical, though the port was written to match line-for-line wherever practical.

## License

MIT — original work © Emil Kowalski. `sonner-vue` is a Vue 3 port of that work; see
[LICENSE](./LICENSE) for the full text and port attribution.
