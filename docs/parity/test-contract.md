# sonner-vue — Test Contract Spec (Playwright suite + test app)

Source slice: `sonner-react/test/**` (Next.js app) + `sonner-react/playwright.config.ts`.
Target per ARCHITECTURE.md: `/playground` (Vite+Vue app replicating the same DOM contract) +
`/test/e2e` (ported Playwright specs).

This spec is exhaustive enough that the implementer never needs to open the React source for
this slice. Where library-internal behavior (state.ts spread order, Toast.vue swipe physics)
is only *exercised* by a test but is authoritatively specified elsewhere, I note it but do not
claim to be the source of truth for it — cross-check against the component/state specs.

---

## 1. Playwright config (`sonner-react/playwright.config.ts`)

```ts
export default defineConfig({
  testDir: './test',
  timeout: 30 * 1000,              // 30s per test
  expect: { timeout: 5000 },       // 5s default for expect(locator).toXxx() polling
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    cwd: './test',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // firefox, mobile, branded-browser projects are present but commented out — NOT active.
  ],
});
```

Key exact values an implementer must replicate in `sonner-vue/playwright.config.ts` (or
equivalent) unless the orchestrator directs otherwise:
- `testDir` → point at `test/e2e`.
- `timeout: 30000` (per-test), `expect.timeout: 5000` (per-assertion poll).
- `fullyParallel: true`, `retries` 0 locally / 2 on CI, `workers` unlimited locally / 1 on CI.
- `reporter: 'html'`.
- `baseURL: 'http://localhost:3000'` — **the Next.js dev server's default port**. The Vue
  playground is a Vite app; Vite's default dev port is **5173**, not 3000. Either (a) configure
  the Vite playground's dev server to bind port 3000 (`vite --port 3000` / `server.port: 3000`
  in `vite.config.ts`) to keep `baseURL` unchanged, or (b) change `baseURL`/`webServer.url` to
  Vite's port. Recommend (a) for minimal diff against the upstream config. **Record final
  choice — not pinned by ARCHITECTURE.md.**
- `webServer.command` must become whatever starts the playground dev server (e.g. `npm run dev`
  / `pnpm --filter playground dev`), `cwd` → `./playground` (or wherever the playground lives).
- Only `chromium` and `webkit` projects are active upstream. Port both unchanged unless firefox
  is desired; do not silently add projects not present upstream.
- `trace: 'on-first-retry'` — keep.

## 2. Root `beforeEach`

```ts
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});
```
Every test starts from a fresh `/` navigation (full reload — clears all in-memory toast state,
since `ToastState` is a module-level singleton `Observer` instance with no persistence). Tests
that need a URL param instead call `page.goto('/?param=value')` again inside the test body,
which **overrides** the `beforeEach` navigation (Playwright runs them in sequence, the second
`goto` simply re-navigates).

## 3. Test app inventory — `sonner-react/test/src/app/page.tsx`

This is a Next.js App Router page component (`'use client'`) receiving `searchParams` as a
prop (Next parses the URL query into a plain object server-side and passes it in — see §4 for
the Vue equivalent). It renders ~30 trigger buttons and two `<Toaster>` instances.

### 3.1 Local component state (React `useState`, all must have Vue equivalents — `ref()`)

| state var | initial | setter used by |
|---|---|---|
| `showAutoClose` | `false` | `auto-close-toast-callback` button's `onAutoClose` callback → `true`; renders `<div data-testid="auto-close-el" />` when true |
| `showDismiss` | `false` | `dismiss-toast-callback` button's `onDismiss` callback → `true`; renders `<div data-testid="dismiss-el" />` when true |
| `theme` | `searchParams.theme || 'light'` | `theme-button` click → `'dark'` (hardcoded, one-way) |
| `isFinally` | `false` | both promise buttons' `finally` callback → `true`; exposed only via `data-finally` attr on the trigger buttons (never asserted by any of the 36 tests) |
| `showAriaLabels` | `false` | the unlabelled "With custom ARIA labels" button → `true` (before firing the toast); also flipped back to `false` by that toast's own `onAutoClose` |

### 3.2 Every button — exact `data-testid`, visible text, and `onClick` action

All buttons share `className="button"` (plain class, no scoping) unless noted.

| `data-testid` | Visible text | onClick behavior |
|---|---|---|
| `theme-button` | `Change theme` | `setTheme('dark')` |
| `default-button` | `Render Toast` | `toast('My Toast')` |
| `default-button-top` | `Render Toast Top` | `toast('My Toast')` (same call as above — testid differs only; not used by any of the 36 tests) |
| `success` | `Render Success Toast` | `toast.success('My Success Toast')` |
| `error` | `Render Error Toast` | `toast.error('My Error Toast')` |
| `action` | `Render Action Toast` | `toast('My Message', { action: { label: 'Action', onClick: () => console.log('Action') } })` |
| `action-prevent` | `Render Action Toast` | `toast('My Message', { action: { label: 'Action', onClick: (event) => { event.preventDefault(); console.log('Action'); } } })` |
| `promise` | `Render Promise Toast` | `toast.promise(promise, { loading: 'Loading...', success: 'Loaded', error: 'Error', finally: () => setIsFinally(true) })` where `promise = () => new Promise((resolve) => setTimeout(resolve, 2000))`. Also has `data-finally={isFinally ? '1' : '0'}`. |
| `rsf-promise` | `Render React Server Function Toast` | `toast.promise(action(), {...})` — calls a Next.js Server Action (`'use server'`, streams UI via `ai/rsc`'s `createStreamableUI`). **Not exercised by any of the 36 tests.** See §7 (out of scope / gap). |
| `custom` | `Render Custom Toast` | `toast.custom((t) => (<div><h1>jsx</h1><button data-testid="dismiss-button" onClick={() => toast.dismiss(t)}>Dismiss</button></div>))` |
| `custom-cancel-button-toast` | `Render Custom Cancel Button` | `toast('My Custom Cancel Button', { cancel: { label: 'Cancel', onClick: () => console.log('Cancel') } })` |
| `custom-with-empty-id` | `Render Custom Toast with empty id` | `toast.custom((t) => (<div><h1>jsx</h1><button data-testid="dismiss-button" onClick={() => toast.dismiss(t)}>Dismiss</button></div>), { id: undefined })` — functionally identical to `custom` (an explicit `id: undefined` is a no-op vs. omitting `id`). |
| `infinity-toast` | `Render Infinity Toast` | `toast('My Toast', { duration: Infinity })` |
| `auto-close-toast-callback` | `Render Toast With onAutoClose callback` | `toast('My Toast', { onAutoClose: () => setShowAutoClose(true) })` |
| `dismiss-toast-callback` | `Dismiss toast callback` | `toast('My Toast', { onDismiss: () => setShowDismiss(true) })` |
| `non-dismissible-toast` | `Non-dismissible Toast` | `toast('My Toast', { dismissible: false })` |
| `update-toast` | `Updated Toast` | Two synchronous calls: `const toastId = toast('My Unupdated Toast', { duration: 10000 })` then immediately `toast('My Updated Toast', { id: toastId, duration: 10000 })` — the 2nd call updates the same toast id before it ever renders as "unupdated". |
| `update-toast-duration` | `Updated Toast Duration` | `const toastId = toast('My Unupdated Toast, Updated After 3 Seconds', { duration: 10000 })`, then `setTimeout(() => toast('My Updated Toast, Close After 1 Second', { id: toastId, duration: 1000 }), 3000)` — update fires 3000ms later, with a shorter 1000ms duration from that point. |
| `string-description` | `String Description` | `toast('Custom Description', { description: 'string description' })` |
| `react-node-description` | `ReactNode Description` | `toast('Custom Description', { description: <div>This is my custom ReactNode description</div> })` — Vue equivalent: `description: () => h('div', 'This is my custom ReactNode description')` (per ARCHITECTURE.md's `Renderable | (() => Renderable)` convention) or an equivalent VNode. |
| `close-button` | `Render close button` | `toast('Toast with close button', { closeButton: true })`. **Not exercised by any of the 36 tests** — but must still exist in the DOM contract per the architecture note ("replicate the DOM contract exactly"). |
| `extended-promise` | `Extended Promise Toast` | `toast.promise(new Promise((resolve) => setTimeout(() => resolve({ name: 'Sonner' }), 2000)), { loading: 'Loading...', success: (data) => ({ message: `${data.name} toast has been added`, description: 'Custom description for the Success state' }), error: { message: 'An error occurred', description: undefined, action: { label: 'Retry', onClick: () => console.log('retrying') } }, description: 'Global description' })` |
| `extended-promise-error` | `Extended Promise Error Toast` | `toast.promise(new Promise((_, reject) => setTimeout(() => reject(new Error('Simulated error')), 2000)), { loading: 'Loading...', success: (data) => ({...}), error: { message: 'An error occurred', description: undefined, action: { label: 'Retry', onClick: (event) => { event.preventDefault(); console.log('retrying'); } } }, description: 'Global description' })` |
| `error-promise` | `Error Promise Toast` | `const whatWillHappen = async () => { throw new Error('Not implemented'); }; toast.promise(whatWillHappen, { loading: 'Saving project...', success: (result) => result?.ok ? 'Project saved' : `${result?.error}`, error: (e) => `Error Raise: ${e}` })`. Note: `whatWillHappen` is passed **as the function itself** (`PromiseT` accepts `Promise \| (() => Promise)`); `toast.promise` calls it. The thrown error, when template-literal-interpolated as `` `Error Raise: ${e}` ``, stringifies via `Error.prototype.toString()` → `"Error: Not implemented"`, giving the final message `"Error Raise: Error: Not implemented"`. |
| *(none — `getByRole('button', { name: 'With custom ARIA labels' })`)* | `With custom ARIA labels` | `setShowAriaLabels(true); toast('Toast with custom ARIA labels', { closeButton: true, onAutoClose: () => setShowAriaLabels(false) })`. This button has **no `data-testid`** — must be located by accessible role+name only. Preserve this (do not add a testid) so the test's `getByRole` locator still resolves correctly. |
| `toast-secondary` | `Render Toast in Secondary Toaster` | `toast('Secondary Toaster Toast', { toasterId: 'secondary' })` |
| `toast-global` | `Render Toast in Global Toaster` | `toast('Global Toaster Toast')` |
| `testid-toast-button` | `Toast with testId` | `toast('Toast with test ID', { testId: 'my-test-toast' })` |
| `testid-promise-toast-button` | `Promise Toast with testId` | `toast.promise(promise, { loading: 'Loading...', success: 'Loaded', error: 'Error', testId: 'promise-test-toast' })` (same `promise` helper as above) |

Conditionally rendered elements (siblings of the buttons, plain divs, no styling):
- `{showAutoClose ? <div data-testid="auto-close-el" /> : null}`
- `{showDismiss ? <div data-testid="dismiss-el" /> : null}`

### 3.3 The two `<Toaster>` instances

**Primary / global Toaster** (no `id` prop → receives all toasts without a `toasterId`):
```tsx
<Toaster
  offset={32}
  position={searchParams.position || 'bottom-right'}
  toastOptions={{
    actionButtonStyle: { backgroundColor: 'rgb(219, 239, 255)' },
    cancelButtonStyle: { backgroundColor: 'rgb(254, 226, 226)' },
    closeButtonAriaLabel: showAriaLabels ? 'Yeet the notice' : undefined,
  }}
  theme={theme}
  dir={searchParams.dir || 'auto'}
  containerAriaLabel={showAriaLabels ? 'Notices' : undefined}
  icons={{
    close: searchParams.customCloseIcon === '' ? (<svg .../* 12x12 X icon, strokeWidth 3 */>) : undefined,
  }}
/>
```
**Secondary Toaster** (`id="secondary"` → only receives toasts created with
`{ toasterId: 'secondary' }`):
```tsx
<Toaster
  id="secondary"
  position="top-left"
  toastOptions={{ className: 'secondary-toaster' }}
/>
```
Everything else on the secondary Toaster is library default (`theme='light'`, `dir` resolves
via document direction since unset, no custom icons, default `offset`, etc.).

`Home.theme = 'light'` — a stray static property on the page component; it is not read by
Next.js or by the app itself (dead code left over from an older theming mechanism). **No
Vue equivalent needed.**

## 4. URL search-param contract — exhaustive

The Next.js page reads `searchParams` (parsed by the Next.js App Router from the URL query
string and passed as a plain object prop). **Only 4 keys are read anywhere in the app:**

| param | read as | default when absent | effect |
|---|---|---|---|
| `theme` | `searchParams.theme` | `'light'` | seeds the `theme` ref's **initial** value only (`useState(searchParams.theme || 'light')`) — passed to the primary `<Toaster theme={theme}>`. Not reactive to further URL changes after mount. |
| `position` | `searchParams.position` | `'bottom-right'` | passed straight to the primary `<Toaster position={...}>`. One of the 6 valid `Position` values (`top-left`, `top-right`, `bottom-left`, `bottom-right`, `top-center`, `bottom-center`). No validation — an invalid value is passed through as-is (upstream sonner assumes a valid `Position` string; behavior for garbage is undefined/library-internal, out of this slice's scope). |
| `dir` | `searchParams.dir` | `'auto'` | passed straight to the primary `<Toaster dir={...}>`. Valid values: `'rtl' \| 'ltr' \| 'auto'`. |
| `customCloseIcon` | `searchParams.customCloseIcon === ''` | icon is `undefined` (library default close icon used) | **exact-equality check against the empty string**, not mere presence/truthiness. A bare query flag `?customCloseIcon` (no `=value`) parses to `''` in both Next's `searchParams` and the browser's native `URLSearchParams` (`new URLSearchParams('customCloseIcon').get('customCloseIcon') === ''`), so `?customCloseIcon` alone satisfies the check and swaps in a custom 12×12 X-icon SVG (`viewBox="0 0 24 24"`, `strokeWidth="3"`, two `<line>` elements) as `icons.close`. Any other value (`?customCloseIcon=foo`) leaves it `undefined`. **Not exercised by any of the 36 Playwright tests** — replicate for DOM-contract fidelity, no test currently depends on it. |

**No other search params are read anywhere in the test app** — specifically `richColors`,
`closeButton`, `duration`, `expand`, `gap`, `visibleToasts`, `invert`, `unstyled` etc. are
**not** wired to URL params in this app; where those features are exercised at all, it's via a
button's inline `toast(...)` call options, never via the querystring.

### Vue/Vite adaptation required
The Next.js App Router passes `searchParams` as a **server-parsed prop** available synchronously
before first render. A Vite SPA has no server-side query parsing step — the playground page must
read `window.location.search` (via `new URLSearchParams(window.location.search)`) on
setup/mount, before the initial render of `theme`, `position`, `dir`, and the `icons.close`
resolution. Because `page.goto('/?dir=rtl')` is a **full navigation** (not a client-side route
change) in every test that uses it, reading `location.search` once at component `setup()` /
`onMounted`-time (synchronously, not after a tick) is sufficient — there is no requirement to
watch the URL reactively after mount. Do **not** wire this through `vue-router`'s reactive
`route.query` unless it resolves synchronously on first render; a router that resolves query
params asynchronously (route guards, etc.) could cause first-paint to briefly use defaults, which
would still work for e2e (Playwright's `expect` polls) but is safest avoided — prefer reading
`window.location.search` directly for parity with the Next app's synchronous read.

## 5. Custom code inventory the playground must reproduce

- **`promise` helper** — a shared `() => new Promise((resolve) => setTimeout(resolve, 2000))`,
  reused by both `promise` and `testid-promise-toast-button` buttons. Reproduce identically
  (2000ms resolve, no payload).
- **`action()` server function** (`test/src/app/action.tsx`) — Next.js Server Action using
  `ai/rsc`'s `createStreamableUI`, streams `"loading N%"` text every 100ms up to `"load
  complete"`. Backs only the `rsf-promise` button, which **no test exercises**. There is no
  Vue/Vite equivalent of a React Server Component streamable UI — **do not attempt to port this
  mechanism**; either omit the `rsf-promise` button entirely from the playground or stub it with
  a plain resolved-after-1000ms promise that yields a string (breaks strict DOM parity for that
  one button but preserves everything the test suite touches). See §8 open question.
- **Custom JSX-in-toast** (`custom`, `custom-with-empty-id` buttons) — a literal 2-element tree:
  an `<h1>jsx</h1>` and a `<button data-testid="dismiss-button">Dismiss</button>` whose click
  calls `toast.dismiss(t)` with the toast's own id (`t`, the callback param `toast.custom`
  receives). Vue equivalent: `toast.custom((id) => h('div', [h('h1', 'jsx'), h('button', { 'data-testid': 'dismiss-button', onClick: () => toast.dismiss(id) }, 'Dismiss')]))`.
- **Auto-close / dismiss "flag" divs** — `data-testid="auto-close-el"` and
  `data-testid="dismiss-el"`, each an empty `<div>` conditionally rendered from local boolean
  state flipped inside a toast option callback (`onAutoClose`, `onDismiss`). These are the test
  app's way of proving a callback fired (no counter, no text — just element presence).
- **No counters, no other custom components.** The app has no numeric counter display, no
  toast-count badge, nothing else stateful beyond the 5 booleans in §3.1.
- **Custom close icon SVG** (conditionally supplied via `icons.close` when `?customCloseIcon`)
  — reproduce verbatim: `width="12" height="12" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"`, containing
  two `<line>` elements identical to the library's own default `CloseIcon` (see
  `sonner-react/src/assets.tsx`) except `strokeWidth` is `3` here vs. the library default `1.5`
  — this is the whole point of the fixture (a visibly-different custom icon), preserve the `3`.

## 6. DOM attributes the tests assert against (library-rendered, for locator reference only)

These are **rendered by the library itself** (`sonner-react/src/index.tsx`), not the test app —
included here only so whoever ports the Playwright suite knows what selectors resolve to. The
authoritative spec for producing this markup in Vue is the Toaster/Toast component spec, not
this document; treat this table as a cross-reference, not a mandate.

| attribute / selector | where | meaning |
|---|---|---|
| `[data-sonner-toaster]` | `<ol>`, one per active *position* per `<Toaster>` instance. **Only rendered once ≥1 toast exists for that position** (`if (!filteredToasts.length) return null`) — a `<Toaster>` with zero toasts renders no `<ol>` at all, only its outer wrapper `<section>`. | the toast-list container for one position |
| `data-sonner-theme="light"\|"dark"` | on the `<ol data-sonner-toaster>` | resolved theme (`theme` prop, or system-resolved if `theme='system'`) |
| `data-x-position="left"\|"right"\|"center"`, `data-y-position="top"\|"bottom"` | on the `<ol data-sonner-toaster>` (and mirrored per-toast `<li>`) | parsed from `position.split('-')` → `[y, x]` |
| `dir` attribute (plain HTML attr, not `data-`) | on `<ol data-sonner-toaster>` | `'rtl'\|'ltr'`; resolved from `Toaster`'s own `dir` prop if set to `'rtl'`/`'ltr'`, else from `document.documentElement`'s `dir` attribute (or its computed CSS `direction` if that attribute is itself `'auto'`/absent) |
| `[data-sonner-toast]` | `<li>` | one per rendered toast |
| `data-testid` | on `<li data-sonner-toast>` | only present when `toast.testId` was passed; **absent entirely (not merely empty) otherwise** — React omits the attribute for `undefined` props, so `expect(toast).not.toHaveAttribute('data-testid')` must be literally true, not `data-testid=""` |
| `[data-button]` | `<button>` | present on **both** the action button and the cancel button (in addition to `data-action`/`data-cancel` respectively) — a locator for `[data-button]` alone will match either/both if present simultaneously |
| `[data-action]`, `[data-cancel]` | `<button>` | disambiguate action vs. cancel |
| `[data-close-button]` | `<button>` | the close (X) button, only rendered when `closeButton` resolves truthy for that toast AND `!toast.jsx` AND `toastType !== 'loading'` |
| `[data-dismissible]` | on `<li data-sonner-toast>`, string `"true"`/`"false"` | mirrors `toast.dismissible !== false` |

## 7. All 36 tests — exact steps, assertions, and certified behavior

All locators below are exactly as written upstream; do not "fix" a selector to what you believe
was intended (see §9 open question re: test #27).

### Group: rendering, timing, types (tests 1–8)

**1. `toast is rendered and disappears after the default timeout`**
```
click [data-testid=default-button]
expect [data-sonner-toast] toHaveCount(1)
expect [data-sonner-toast] toHaveCount(0)   // polls up to 5000ms (expect.timeout)
```
Certifies: default toast creation + default `TOAST_LIFETIME` (4000ms) + `TIME_BEFORE_UNMOUNT`
(200ms) exit-animation removal all complete inside the 5000ms poll window (4000+200=4200ms <
5000ms). **Timing is exact and load-bearing** — do not alter these two constants without
re-verifying this margin.

**2. `various toast types are rendered correctly`**
```
click [data-testid=success]
expect getByText('My Success Toast', {exact:true}) toHaveCount(1)
click [data-testid=error]
expect getByText('My Error Toast', {exact:true}) toHaveCount(1)
click [data-testid=action]
expect [data-button] toHaveCount(1)
```
Certifies: `toast.success`, `toast.error`, and action-button rendering, all as separate
still-visible toasts stacking up (3 total by the end, un-asserted directly).

**3. `show correct toast content based on promise state`**
```
click [data-testid=promise]
expect getByText('Loading...') toHaveCount(1)
expect getByText('Loaded') toHaveCount(1)   // polls; resolves after the 2000ms promise settles
```
Certifies: `toast.promise` loading→success text transition, same toast id/element updates
in-place (no flash-then-remount required by this assertion, but the transition must land within
5000ms of the loading text appearing — 2000ms promise well inside budget).

**4. `handle toast promise rejections`** — **runs entirely in the Playwright/Node process, not
in the browser.** No `page.*` interaction beyond the inherited `beforeEach` navigation.
```ts
const rejectedPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Promise rejected')), 100));
try {
  toast.promise(rejectedPromise, {});
} catch {
  throw new Error('Promise should not have rejected without unwrap');
}
await expect(toast.promise(rejectedPromise, {}).unwrap()).rejects.toThrow('Promise rejected');
```
`toast` here is `import { toast } from 'sonner'` at the **top of the spec file**, i.e. the
framework-agnostic `state.ts` export invoked directly in Node — no DOM, no browser page
required for the assertions (though `page` fixture is still injected/unused per Playwright's
per-test signature). Certifies two things: (a) `toast.promise(...)` must never itself throw
synchronously even when its promise argument will reject — it returns an id/handle object with
`.unwrap()`; (b) `.unwrap()` returns a promise that rejects with the *original* rejection reason
once the underlying promise settles (100ms real-timer wait, not mocked).
Vue port: import `{ toast }` from the built `sonner-vue` package (or its `state.ts` module
directly) in the Playwright test file — this test needs **no page/browser interaction at all**
and could theoretically run as a Vitest unit test instead, but port it into the e2e file
unchanged to keep 1:1 test-count parity with upstream (36 tests) unless the orchestrator
directs otherwise.

**5. `promise toast with extended configuration`**
```
click [data-testid=extended-promise]
expect getByText('Loading...') toHaveCount(1)
expect getByText('Sonner toast has been added') toHaveCount(1)     // polls ~2000ms for resolve
expect getByText('Custom description for the Success state') toHaveCount(1)
expect getByText('Global description') toHaveCount(0)
```
Certifies: `success` callback receiving resolved data (`{name:'Sonner'}`) and returning an
extended result object (`{message, description}`); the **per-result `description` overrides**
the promise-level top-level `description: 'Global description'` — the global description text
must never appear once the success result lands.

**6. `promise toast with extended error configuration`**
```
click [data-testid=extended-promise-error]
expect getByText('Loading...') toHaveCount(1)
expect getByText('An error occurred') toHaveCount(1)               // polls ~2000ms for reject
const actionButton = getByText('Retry')
expect actionButton toHaveCount(1)
click actionButton
expect getByText('An error occurred') toHaveCount(1)                // still present after click
```
Certifies: extended error-result object (`{message, description: undefined, action}`) renders
an action button labeled "Retry"; clicking it invokes the action's `onClick`, which calls
`event.preventDefault()` — and per the action-button click handler contract (`if
(event.defaultPrevented) return;` before `deleteToast()`), **`preventDefault()` on the action's
click event suppresses the toast's auto-dismiss-on-click behavior**, so the toast must still be
present immediately after the click.

**7. `promise toast with Error object rejection`**
```
click [data-testid=error-promise]
expect getByText('Error Raise: Error: Not implemented') toHaveCount(1)
```
Certifies: when the promise executor function itself throws synchronously inside an `async`
function (`whatWillHappen`), the resulting rejection reaches the `error` callback as an `Error`
instance; the callback template-literal-stringifies it (`` `Error Raise: ${e}` ``) — this
depends on `Error.prototype.toString()` producing `"Error: Not implemented"` (i.e. `"<name>:
<message>"`). **In Vue/TS this is the exact same JS `Error` object semantics — no framework
difference; verify your test harness's `Error#toString` is not shadowed/polyfilled
differently.**

**8. `render custom jsx in toast`**
```
click [data-testid=custom]
expect getByText('jsx') toHaveCount(1)
```
Certifies: `toast.custom(cb)` renders raw markup (the `<h1>jsx</h1>`) unwrapped by any of the
library's own title/description/content chrome. **Vue-specific risk:** in React,
`toast.jsx ? toast.jsx : ...` in the `<li>`'s title slot causes the *entire* custom node to
render in place of the standard title/description block (see index.tsx line ~449); the Vue
`Toast.vue` must replicate that "when `toast.jsx` is set, ignore `title`/`description` entirely
and render the custom VNode directly inside `data-content` (or wherever the component spec
places it)" branch — confirm against the component spec, this doc only certifies the *outcome*
(the text "jsx" must be queryable).

### Group: swipe / drag gestures (tests 9–10, 11, and 16 which also swipes)

**9. `toast is removed after swiping down`**
```
click [data-testid=default-button]
page.hover('[data-sonner-toast]')      // moves mouse to the toast's center
page.mouse.down()
page.mouse.move(0, 800)                // absolute viewport coords — moves cursor to (x=0, y=800)
page.mouse.up()
expect [data-sonner-toast] toHaveCount(0)
```
Default position is `bottom-right` (no URL param) → `position.split('-')` → `y='bottom'`,
`x='right'` → default swipe directions `['bottom','right']`. Moving straight down from the
toast's center to `(0, 800)` produces a large positive `yDelta` (well beyond `SWIPE_THRESHOLD`
= 45px) with `swipeDirection` locking to `'y'` (vertical) since `|yDelta| > |xDelta|`; because
`'bottom'` is an allowed direction and `yDelta > 0`, the swipe is undampened and exceeds
threshold → toast removed (no `mouse.up`-triggered animation-completion wait needed —
`expect(...).toHaveCount(0)` polls up to 5000ms, well beyond the `TIME_BEFORE_UNMOUNT` 200ms).
**No mouse-move `steps` option used — a single teleport-style jump, not a smooth drag.** Must
still trigger the pointer-move handler logic (`onPointerMove`) at least once between down/up;
Playwright's `mouse.move` dispatches the underlying pointer events synchronously so a single
jump is sufficient — do not require intermediate steps for this particular test (contrast with
test 16 which explicitly uses `steps`).

**10. `dismissible toast is not removed when dragged`**
```
click [data-testid=non-dismissible-toast]
const dragBoundingBox = await toast.boundingBox()   // toast := page.locator('[data-sonner-toast]')
if (!dragBoundingBox) return                          // test silently no-ops if box is null
page.mouse.move(box.x + box.width/2, box.y)            // top-center of the toast
page.mouse.down()
page.mouse.move(0, box.y + 300)
page.mouse.up()
expect getByTestId('non-dismissible-toast') toHaveCount(1)
```
The toast was created with `dismissible: false`. Certifies: swipe gestures are inert on a
non-dismissible toast (the library's `onPointerDown` handler early-returns before arming
swipe state when `!dismissible`). **Read the final assertion literally** — it checks the
**trigger button** `[data-testid=non-dismissible-toast]` still has count 1, *not*
`[data-sonner-toast]`. This is trivially true regardless of what happened to the toast (the
button never disappears) — port the assertion exactly as written even though it looks like it
should have asserted the toast itself; do not "fix" it, see §9.

**11. `toast is removed after swiping up`**
```
page.goto('/?position=top-left')
click [data-testid=default-button]
page.hover('[data-sonner-toast]')
page.mouse.down()
page.mouse.move(0, -800)               // negative absolute Y — moves cursor above the viewport
page.mouse.up()
expect [data-sonner-toast] toHaveCount(0)
```
Position `top-left` → `y='top'`, `x='left'` → default swipe directions `['top','left']`.
Moving to negative Y produces large negative `yDelta`; `'top'` is allowed and `yDelta < 0` →
undampened, exceeds threshold → removed. **Negative absolute mouse coordinates are
intentional and must be passed through as-is** to `page.mouse.move` — do not clamp to 0 in the
port.

**16. `toast's dismiss callback gets executed correctly`** (drag-based, listed here for
gesture completeness, described fully in its own numbered slot below).

### Group: hover / persistence (tests 12–14)

**12. `toast is not removed when hovered`**
```
click [data-testid=default-button]
expect [data-sonner-toast] toBeVisible()
page.hover('[data-sonner-toast]')
page.waitForTimeout(100)
page.waitForTimeout(5000)
expect [data-sonner-toast] toBeVisible()
expect [data-sonner-toast] toHaveCount(1)
```
Certifies: hovering pauses the auto-close timer (`pauseTimer()` branch when `interacting` is
true via the Toaster's `onPointerDown`/mouseenter machinery, or directly via the per-toast hover
— confirm exact hover-vs-pointerdown wiring against the component spec). Total real wait is
5100ms, comfortably exceeding the default 4000ms `TOAST_LIFETIME` — proves the toast would have
auto-closed by now if not paused.

**13. `toast is not removed if duration is set to infinity`**
```
click [data-testid=infinity-toast]
expect toast toBeVisible()
toast.hover({ force: true })
page.waitForTimeout(100)
page.waitForTimeout(5000)
expect toast toBeVisible()
expect toast toHaveCount(1)
```
`{ force: true }` on `.hover()` bypasses Playwright's actionability checks (e.g. it will hover
even if another element is momentarily on top). Certifies: `duration: Infinity` never schedules
a close timer at all (`if (... || toast.duration === Infinity || ...) return;` short-circuits
before any `setTimeout`), independent of hover.

**14. `toast is not removed when event prevented in action`**
```
click [data-testid=action-prevent]
click [data-button]
expect [data-sonner-toast] toHaveCount(1)
```
Certifies the same `event.preventDefault()` → survive-the-click contract as test 6, but via the
plain (non-promise) `action` option path.

### Group: callbacks via drag/click (tests 15–16)

**15. `toast's auto close callback gets executed correctly`**
```
click [data-testid=auto-close-toast-callback]
expect getByTestId('auto-close-el') toHaveCount(1)
```
No explicit wait — relies on `expect(...).toHaveCount(1)`'s 5000ms poll to cover the 4000ms
default auto-close + `onAutoClose` firing synchronously with the internal `deleteToast()` call
(see index.tsx: `toast.onAutoClose?.(toast); deleteToast();` inside the timer callback — callback
fires *before* the removal animation starts, not after).

**16. `toast's dismiss callback gets executed correctly`**
```
click [data-testid=dismiss-toast-callback]
const toast = page.locator('[data-sonner-toast]')
await toast.waitFor({ state: 'visible' })
const box = await toast.boundingBox()
if (!box) return
const startX = box.x + box.width/2, startY = box.y + box.height/2
page.mouse.move(startX, startY)
page.mouse.down()
page.mouse.move(startX, startY + 20, { steps: 5 })      // small initial nudge
page.mouse.move(startX, startY + 300, { steps: 10 })    // main swipe
page.mouse.up()
expect getByTestId('dismiss-el') toHaveCount(1)
```
Default position `bottom-right` → swipe-down is an allowed direction, same threshold math as
test 9, but here delivered as two **stepped** moves (`steps: 5` then `steps: 10`, i.e.
Playwright synthesizes intermediate pointermove events) rather than one jump — this specific
test is the one that requires realistic incremental pointermove events (matters if the Vue
port's pointer handling relies on delta-per-event rather than only start/end, e.g. dampening
math keyed off consecutive move events). Certifies: swiping past threshold triggers
`toast.onDismiss?.(toast)` (called from the `onPointerUp` handler, *before* `deleteToast()`) —
distinct code path from the timer-based `onAutoClose` in test 15.

### Group: theme (tests 17–19)

**17. `toaster's theme should be light`**
```
click [data-testid=infinity-toast]
expect [data-sonner-toaster] toHaveAttribute('data-sonner-theme', 'light')
```
No URL param → `theme` state initializes to `'light'` (no `?theme=` param). Must click a toast
trigger first because `<ol data-sonner-toaster>` doesn't exist in the DOM until ≥1 toast exists
(§6).

**18. `toaster's theme should be dark`**
```
page.goto('/?theme=dark')
click [data-testid=infinity-toast]
expect [data-sonner-toaster] toHaveAttribute('data-sonner-theme', 'dark')
```

**19. `toaster's theme should be changed`**
```
click [data-testid=infinity-toast]
expect [data-sonner-toaster] toHaveAttribute('data-sonner-theme', 'light')
click [data-testid=theme-button]
expect [data-sonner-toaster] toHaveAttribute('data-sonner-theme', 'dark')
```
Certifies live reactivity: the `<Toaster theme={theme}>` prop is bound to the page's own
`theme` ref, and clicking `theme-button` (`setTheme('dark')`) must re-render the already-open
toaster's `data-sonner-theme` attribute without needing to reopen/recreate the toast. In Vue
this requires `theme` to be a reactive `ref` passed as a prop and the Toaster component to
`watch`/react to prop changes (not just read it once on mount).

### Group: focus management (test 20)

**20. `return focus to the previous focused element`**
```
page.getByTestId('custom').focus()
page.keyboard.press('Enter')                         // triggers the button's click handler → toast.custom(...)
expect [data-sonner-toast] toHaveCount(1)
page.getByTestId('dismiss-button').focus()            // the toast's own inner Dismiss button
page.keyboard.press('Enter')                          // triggers toast.dismiss(t)
expect [data-sonner-toast] toHaveCount(0)
expect getByTestId('custom') toBeFocused()
```
Certifies the Toaster's focus-restoration contract: focusing into the toast list captures the
previously-focused element (via the list container's `focus`/`blur` bookkeeping — see the
Toaster component spec for the exact mechanism, this doc only certifies the observable outcome),
and when the focused element inside the list is removed from the DOM (toast dismissed), focus
programmatically returns to whatever had focus immediately before entering the list — here, the
`custom` button. **Pressing `Enter` on a focused `<button>` must fire a native `click` event**
(true of both React's synthetic events and Vue's native DOM listeners — no special handling
needed, this is standard browser behavior for buttons, not framework-specific).

### Group: `dir` attribute resolution (tests 21–23)

**21. `toaster's dir prop is reflected correctly`**
```
page.goto('/?dir=rtl')
click [data-testid=default-button]
expect [data-sonner-toaster] toHaveAttribute('dir', 'rtl')
```

**22. `toaster respects the HTML's dir attribute`**
```
page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'))
click [data-testid=default-button]
expect [data-sonner-toaster] toHaveAttribute('dir', 'rtl')
```
No `?dir=` param here → Toaster's own `dir` prop defaults to `'auto'` (page.tsx:
`dir={searchParams.dir || 'auto'}`) → falls through to reading `document.documentElement`'s
`dir` attribute directly (`'rtl'`, just set programmatically) → resolves to `'rtl'`.

**23. `toaster respects its own dir attribute over HTML's`**
```
page.goto('/?dir=ltr')
page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'))
click [data-testid=default-button]
expect [data-sonner-toaster] toHaveAttribute('dir', 'ltr')
```
Certifies precedence: an explicit non-`'auto'` `dir` prop on `<Toaster>` (here `'ltr'` from the
URL param) **always wins over** `document.documentElement`'s `dir` attribute, even though the
latter is set to the opposite value (`'rtl'`) right before the toast is triggered. Only when the
Toaster's own `dir` resolves to `'auto'` does it fall back to inspecting the document (tests
21/22 both use the `'auto'`-fallback path via different routes: 21 sets `?dir=rtl` — a
non-`'auto'` value! — so 21 is actually testing the direct-prop path, not the fallback. Re-read:
21 has no `document.documentElement` mutation at all, so its `'rtl'` outcome is unambiguous
either way. 22 is the true "prop is `'auto'`, document decides" test. 23 is the true "prop wins
over document" test.

### Group: update-in-place (tests 24–25)

**24. `show correct toast content when updating`**
```
click [data-testid=update-toast]
expect getByText('My Unupdated Toast') toHaveCount(0)
expect getByText('My Updated Toast') toHaveCount(1)
```
Both `toast(...)` calls in the button handler run synchronously in the same click/tick, so by
the time Playwright even observes the DOM, only the updated content has ever been rendered (the
"unupdated" title should never be visible even transiently, hence asserting count **0** for it,
not "0 eventually" — though `toHaveCount` still polls, this is really asserting it's *never*
been 1). Certifies same-id `toast(msg, { id })` mutates the existing entry rather than creating
a second one.

**25. `should update toast content and duration after 3 seconds`**
```
click [data-testid=update-toast-duration]
const initialToast = getByText('My Unupdated Toast, Updated After 3 Seconds')
expect initialToast toBeVisible()
page.waitForTimeout(3000)
const updatedToast = getByText('My Updated Toast, Close After 1 Second')
expect updatedToast toBeVisible()
expect initialToast not.toBeVisible()
page.waitForTimeout(1200)
expect updatedToast not.toBeVisible()
```
Exact timing chain: initial toast created with `duration: 10000`. A `setTimeout(fn, 3000)` in
the button handler fires the update at **wall-clock 3000ms after click**. `page.waitForTimeout
(3000)` blocks the test for the same 3000ms, so by the time it resolves, the update has (just)
landed. The updated toast is given `duration: 1000` **from the moment of the update call**, so
it should auto-close ~1000ms + 200ms(unmount) = ~1200ms after the update — matching the test's
second `waitForTimeout(1200)`. **These three numbers (3000, 1000-inside-app, 1200-in-test) must
remain in this exact relationship** — the update's own duration resets the remaining-time clock
from zero at update time (it does not inherit/continue the original 10000ms countdown).

### Group: custom styles (tests 26–28)

**26. `cancel button is rendered with custom styles`**
```
click [data-testid=custom-cancel-button-toast]
const button = page.locator('[data-cancel]')
expect button toHaveCSS('background-color', 'rgb(254, 226, 226)')
```
Style source: primary `<Toaster toastOptions={{ cancelButtonStyle: { backgroundColor: 'rgb(254, 226, 226)' } }}>`.
`toHaveCSS` reads the **computed style**, so this is satisfied whether the color arrives via an
inline `style` attribute or a stylesheet rule — but the library applies it as an inline style
object (`style={toast.cancelButtonStyle || cancelButtonStyle}` in index.tsx), so replicate via
Vue's `:style` binding for parity, not a CSS class.

**27. `cancel button dismisses the custom toast with empty id`** — see §9, this test's own
selector does not match anything the app renders; flagged as an open question, do not silently
"fix" the selector when porting.

**28. `action button is rendered with custom styles`**
```
click [data-testid=action]
const button = page.locator('[data-button]')
expect button toHaveCSS('background-color', 'rgb(219, 239, 255)')
```
Style source: primary `<Toaster toastOptions={{ actionButtonStyle: { backgroundColor: 'rgb(219, 239, 255)' } }}>`.
Note `[data-button]` (not `[data-action]`) is the locator used — matches the action button
because it carries both attributes; ensure the Vue port also stamps `data-button` on both action
and cancel buttons (§6) or this locator resolves to the wrong/no element.

### Group: description rendering (tests 29–30)

**29. `string description is rendered`**
```
click [data-testid=string-description]
expect getByText('string description') toHaveCount(1)
```

**30. `ReactNode description is rendered`**
```
click [data-testid=react-node-description]
expect getByText('This is my custom ReactNode description') toHaveCount(1)
```
Certifies `description` accepts a renderable node, not just a string — in the Vue port this is
the `Renderable | (() => Renderable)` `description` prop per ARCHITECTURE.md; the test app's
`<div>This is my custom ReactNode description</div>` must port to an equivalent VNode-returning
description (see §5 custom-code inventory).

### Group: ARIA (test 31)

**31. `aria labels are custom`**
```
page.getByRole('button', { name: 'With custom ARIA labels' }).click()
expect getByText('Toast with custom ARIA labels') toHaveCount(1)
expect getByLabel('Notices') toHaveCount(1)
expect getByLabel('Yeet the notice', { exact: true }) toHaveCount(1)
```
`getByLabel('Notices')` (no `exact`) does a **case-insensitive, trimmed substring match** on
accessible name by default in Playwright — the actual computed `aria-label` on the toaster
`<section>` is `` `${containerAriaLabel} ${hotkeyLabel}` `` = `"Notices alt+T"` (see index.tsx:
`aria-label={customAriaLabel ?? \`${containerAriaLabel} ${hotkeyLabel}\`}`, where
`hotkeyLabel = hotkey.join('+').replace(/Key/g,'').replace(/Digit/g,'')` and the default
`hotkey = ['altKey','KeyT']` → `'altKey+KeyT'` → strip all literal substrings `'Key'` →
`'alt+T'`). Because the assertion is a substring match, `"Notices"` alone is sufficient — **the
exact `hotkeyLabel` formatting is not strictly verified by this test**, but should still be
replicated faithfully in the Toaster component for API parity (out of this slice's scope to
mandate the formula precisely — cross-check the Toaster component spec). The second assertion
(`exact: true`) **is** a strict equality check: the close button's `aria-label` must be exactly
`"Yeet the notice"`, sourced from primary `<Toaster toastOptions={{ closeButtonAriaLabel:
'Yeet the notice' }}>` — this only applies because the triggered toast itself was created with
`closeButton: true`.

### Group: multi-Toaster (tests 32–33)

**32. `toast with toasterId only appears in the correct Toaster`**
```
click [data-testid=toast-secondary]
const secondaryToaster = page.locator('[data-sonner-toaster][data-x-position="left"][data-y-position="top"]')
expect secondaryToaster.getByText('Secondary Toaster Toast') toHaveCount(1)
const globalToaster = page.locator('[data-sonner-toaster][data-x-position="right"][data-y-position="bottom"]')
expect globalToaster.getByText('Secondary Toaster Toast') toHaveCount(0)
```
**33. `toast without toasterId only appears in the global Toaster`**
```
click [data-testid=toast-global]
const globalToaster = page.locator('[data-sonner-toaster][data-x-position="right"][data-y-position="bottom"]')
expect globalToaster.getByText('Global Toaster Toast') toHaveCount(1)
const secondaryToaster = page.locator('[data-sonner-toaster][data-x-position="left"][data-y-position="top"]')
expect secondaryToaster.getByText('Global Toaster Toast') toHaveCount(0)
```
Both rely on the exact default position pairing (`right`/`bottom` for the unconfigured primary
Toaster, `left`/`top` for the hardcoded `position="top-left"` secondary Toaster) — **do not
introduce a `?position=` override for these two tests**; they run against a bare `page.goto('/')`
from `beforeEach` (no extra `goto`), so the primary Toaster is at its true default
`'bottom-right'`. Certifies toast-to-toaster routing via `toasterId` matching (§3.3's
`filteredToasts` logic — a toast with `toasterId: 'secondary'` is filtered into the `id="secondary"`
Toaster's list only; a toast with no `toasterId` goes only into the id-less Toaster's list).

### Group: testId passthrough (tests 34–36)

**34. `toast with testId renders data-testid attribute correctly`**
```
click [data-testid=testid-toast-button]
expect getByTestId('my-test-toast') toBeVisible()
expect getByTestId('my-test-toast') toHaveText('Toast with test ID')
```
**35. `toast without testId does not have data-testid attribute`**
```
click [data-testid=default-button]
const toast = page.locator('[data-sonner-toast]')
expect toast toBeVisible()
expect toast not.toHaveAttribute('data-testid')
```
The attribute must be **entirely absent**, not present-and-empty — matches React's behavior of
omitting an attribute entirely when the bound value is `undefined`. **Vue-specific risk:** Vue's
`v-bind` also omits `null`/`undefined`-valued attributes by default, so `:data-testid="toast.testId"`
with `toast.testId === undefined` should correctly omit it — but verify this is not accidentally
rendered as `data-testid=""` by any fallback/coercion in the component implementation (e.g. `||
''` patterns would break this test).

**36. `promise toast with testId maintains testId through state changes`**
```
click [data-testid=testid-promise-toast-button]
expect getByTestId('promise-test-toast') toBeVisible()
expect getByTestId('promise-test-toast') toHaveText('Loading...')
expect getByTestId('promise-test-toast') toHaveText('Loaded')     // polls through the 2000ms promise resolve
```
Certifies the `testId` passed to `toast.promise(...)` options survives the loading→success
content swap on the **same** DOM element/toast id (same underlying `<li>`, not a
remove-and-recreate) — because `getByTestId('promise-test-toast')` is re-queried fresh each
assertion but must resolve to a `toBeVisible` single element throughout, and content changes
in-place under that same testid.

## 8. Porting checklist — per test, unchanged vs. needs adaptation

| # | Test | Port as-is? | Adaptation needed |
|---|---|---|---|
| 1 | default timeout disappearance | Yes | — |
| 2 | toast types | Yes | — |
| 3 | promise loading→success | Yes | — |
| 4 | promise rejection (Node-side) | **Import swap only** | `import { toast } from 'sonner'` → `import { toast } from 'sonner-vue'` (or wherever the built lib resolves in the e2e test's Node context — likely needs the library built/linked, not just the playground running) |
| 5 | extended promise config | Yes | — |
| 6 | extended promise error config | Yes | — |
| 7 | Error object rejection message | Yes | Confirm `Error#toString()` unaffected by any Vue/Vite transform |
| 8 | custom jsx | **Behavior port** | Vue `toast.custom((id) => h(...))` callback signature; confirm `Toast.vue`'s jsx-branch skips title/description exactly like React's |
| 9 | swipe down removes | Yes | Same mouse-coordinate script, no Vue-specific change (pure DOM/pointer events) |
| 10 | non-dismissible drag no-op | Yes | Keep the (arguably weak) assertion exactly as upstream (§9) |
| 11 | swipe up removes (top-left) | Yes | — |
| 12 | hover pauses timer | Yes | — |
| 13 | Infinity duration never closes | Yes | — |
| 14 | preventDefault keeps action toast | Yes | — |
| 15 | onAutoClose callback fires | Yes | — |
| 16 | onDismiss callback fires (stepped drag) | Yes | — |
| 17 | theme light default | Yes | — |
| 18 | theme dark via URL | Yes | Requires playground to read `?theme=` the same way (§4) |
| 19 | theme live-changes via button | Yes | Requires `theme` to be a **reactive** prop into `<Toaster>` in the playground |
| 20 | focus restoration | Yes | Depends on Toaster/Toast components implementing the same blur/focus bookkeeping — behavior-port, not test-file change |
| 21 | dir prop via URL | Yes | Requires playground to read `?dir=` (§4) |
| 22 | dir falls back to `<html dir>` | Yes | — |
| 23 | dir prop wins over `<html dir>` | Yes | — |
| 24 | update same-id toast content | Yes | — |
| 25 | update toast content + duration timing | Yes | Exact ms values (3000/1000/1200) must be preserved in the playground's button handler |
| 26 | cancel button custom inline style | Yes | Ensure Vue applies `cancelButtonStyle` as inline `style`, not a class |
| 27 | cancel/dismiss empty-id toast | **Blocked — see §9** | Selector `[data-dismiss]` matches nothing in the current app; needs an orchestrator decision before porting |
| 28 | action button custom inline style | Yes | Same inline-style requirement as #26 |
| 29 | string description | Yes | — |
| 30 | ReactNode/VNode description | **Adaptation** | Test app's `<div>...</div>` JSX description → Vue render-fn/VNode description (§5) |
| 31 | custom ARIA labels | Yes | Preserve the *un-testid'd* button located via `getByRole` + accessible name |
| 32 | toasterId routes to secondary Toaster | Yes | — |
| 33 | no toasterId routes to global Toaster | Yes | — |
| 34 | testId renders `data-testid` | Yes | — |
| 35 | no testId ⇒ no `data-testid` attr | Yes | Verify Vue doesn't coerce `undefined` → `""` (§7 test 35 note) |
| 36 | testId survives promise state change | Yes | — |

**Overall:** the suite is almost entirely a **behavior port** (same script, same selectors) once
the playground reproduces the exact DOM/testid/URL-param contract in §3–§6. The only structural
changes are: (a) test 4's import source, (b) test 8/30's JSX→VNode construction inside the
playground page (not the test file itself), (c) the playground's own URL-param-reading mechanism
(§4), and (d) test 27 is blocked pending an explicit decision (§9).

## 9. Open questions (source conflicts / ambiguities — do not silently resolve)

1. **Test 27 (`cancel button dismisses the custom toast with empty id`) has a broken selector
   upstream.** The test clicks `custom-with-empty-id` (which renders a `toast.custom(...)` jsx
   toast containing a `<button data-testid="dismiss-button">`), then does
   `page.locator('[data-dismiss]').click()`. **No element anywhere in the library or the test
   app carries a `data-dismiss` attribute** (verified via `grep -rn "data-dismiss"` across the
   entire `sonner-react` source and test tree — the only hit is the unrelated
   `data-dismissible` attribute on `<li data-sonner-toast>`). As written, `.click()` on a
   zero-match locator will hang until Playwright's actionability timeout and the test will fail
   (or hang until the 30s per-test timeout). This conflicts with ARCHITECTURE.md's quality bar
   ("All 36 ported Playwright tests green") — a literal 1:1 port of this test **cannot pass**.
   Options for the orchestrator: (a) port the test literally and accept it as a known-failing/
   skipped test (breaks the "all 36 green" bar, needs an explicit carve-out), (b) fix the
   selector to `[data-testid="dismiss-button"]` (matches the button that actually exists and
   plausibly matches the test's *intent* — dismissing the custom toast via its own dismiss
   button), (c) something else. **I have not silently chosen — flagging for a decision.**
2. **Playwright `baseURL`/dev-server port mismatch.** Upstream pins `baseURL:
   'http://localhost:3000'` (Next.js's default port) and `webServer.command: 'npm run dev'`
   against the Next app. The Vue playground is Vite-based; Vite's default port is 5173. Needs an
   explicit decision (bind Vite to port 3000 for a minimal-diff config, or update `baseURL`) —
   not pinned by ARCHITECTURE.md. See §1.
3. **`rsf-promise` button (`test/src/app/action.tsx`) has no Vite/Vue equivalent** — it depends
   on Next.js Server Actions + `ai/rsc`'s `createStreamableUI`, a React-specific streaming-UI
   primitive with no Vue analog and no supporting server runtime in a plain Vite SPA. No test
   exercises this button, so it's safe to omit or stub, but ARCHITECTURE.md's instruction that
   the playground "replicates sonner's test app DOM contract exactly" is technically violated by
   omitting it. Recommend: omit the button (or stub its handler with a plain
   `setTimeout`-resolved promise) and record the deviation — flagging rather than silently
   dropping since the contract says "exactly."
4. **`searchParams` timing model differs between Next (server-parsed prop, available at first
   render) and a Vite SPA (client-only, must read `window.location.search`).** I've specified
   the recommended approach (§4) but this is a structural adaptation of the *page*, not just an
   import swap — flagging in case the orchestrator wants a different mechanism (e.g. a router
   with synchronous query resolution, or hash-based config instead of query-string).

## 10. Gap list — sonner behaviors NOT covered by the 36 tests

Cross-referenced against the feature surface visible in `sonner-react/src/index.tsx` and
`types.ts` (constants + props already enumerated in ARCHITECTURE.md). None of the following are
exercised by any of the 36 Playwright tests; if the orchestrator wants broader coverage than a
literal port, these are the candidates for new Vitest unit tests or additional e2e specs — not
required by this slice's task ("port the 36 tests"), but recorded as requested.

- **`Toaster` props never exercised by any test:** `expand` (expand-by-default), `gap` (custom
  toast spacing), `visibleToasts` (stack-size limit / hidden-toast behavior beyond
  `VISIBLE_TOASTS_AMOUNT`=3 default), `invert`, `richColors` (Toaster-level default, nor any
  per-toast `richColors` override — the `data-rich-colors` attribute is never asserted),
  `unstyled`, `className`, `style`, `offset`/`mobileOffset` object-shorthand forms (only the
  numeric `offset={32}` is used, and never asserted against computed CSS), `swipeDirections`
  override (only the position-derived default directions are exercised), `hotkey` customization,
  `customAriaLabel` (only `containerAriaLabel` is exercised).
- **Toaster keyboard hotkey behavior** (`Alt+T` expands + focuses the list; `Escape` collapses
  when focus is within the list) — zero keyboard-driven expand/collapse tests exist.
- **Stacking/expand visual behavior** — no test creates >1 simultaneous toast in the same
  position and asserts on `--offset`/`--front-toast-height`/hover-to-expand
  layout, front-toast `data-front`, or the `VISIBLE_TOASTS_AMOUNT` cutoff (4th+ toast should
  become non-`data-visible`).
- **`toast.dismiss()` with no id** (dismiss-all) — untested.
- **`toast.loading()`, `toast.message()`, `toast.info()`, `toast.warning()`** convenience
  methods — none are wired to any button in the test app, none are tested.
- **`useSonner()` hook** — exported by the library, entirely unused/untested by the test app.
- **`toast.getHistory()` / `toast.getToasts()`** introspection — untested.
- **Promise + HTTP `Response`-like rejection/resolution branch** (`isHttpResponse` check in
  state.ts: a resolved value that looks like a `Response` with `ok:false`) — only plain `Error`
  rejections and plain resolves are exercised; the `Response`-shaped branch is dead code as far
  as this suite is concerned.
- **Horizontal swipe removal** (left/right) — only vertical (up/down) swipes are tested; no test
  covers a `position` with distinct left/right swipe-out behavior asserted against `data-swipe-
  direction="left"|"right"`.
- **`data-swipe-direction`, `data-swiped`, `data-swipe-out`, `data-promise`, `data-invert`,
  `data-rich-colors`, `data-styled`, `data-mounted`, `data-front`, `data-index`, `data-expanded`**
  attributes — none directly asserted by any test (only `data-y-position`, `data-x-position`,
  `data-sonner-theme`, `dir`, `data-testid`, `data-dismissible`(indirectly), `data-button`,
  `data-action`, `data-cancel`, `data-close-button`(indirectly via aria test) are touched).
- **`closeButton` (the `close-button` test-app button, and the Toaster-level `closeButton`
  default) is never clicked or asserted** — no test verifies the close (X) button actually
  removes a toast on click, nor its default `aria-label="Close toast"`.
- **`theme="system"` + `prefers-color-scheme` media-query reactivity** — untested (only explicit
  `'light'`/`'dark'` are exercised).
- **6 `Position` values: only `bottom-right` (default), `top-left` are exercised** via the app's
  own tests; `top-right`, `bottom-left`, `top-center`, `bottom-center` are never navigated to or
  asserted against.
- **`toast(...)` with `id` collision across *types*** (e.g. update a `success` toast into an
  `error` toast via same id) — untested; only same-type content/duration updates are covered
  (tests 24–25).
- **`icons` prop overrides for `success`/`info`/`warning`/`error`/`loading` icons** — only the
  `close` icon override (`customCloseIcon` URL param) exists in the app, and it's not exercised
  by any test either (§4).
- **`classNames`/`toastOptions.classNames` per-type class overrides** — untested (only inline
  `style` overrides for action/cancel buttons are tested).
- **`onDragEnd`/incomplete-swipe "spring back" behavior** (swiping less than
  `SWIPE_THRESHOLD` and releasing) — no test verifies the toast survives and resets
  `--swipe-amount-x/y` to `0px` when a swipe doesn't clear the threshold.

---

# Audit corrections (Opus verifier pass, authoritative — overrides anything above)

## AC-T1 (CRITICAL cross-slice, breaks the *whole* e2e file). Test 4 imports the library into **Node**; the CSS auto-injection mandated by `styles-spec.md` §1 must therefore be SSR-safe.

Test 4 (`handle toast promise rejections`) does `import { toast } from 'sonner'` at the **top of
the spec file** and runs it in the Playwright/Node process. `styles-spec.md` §1 mandates that
`src/index.ts` do a top-level `import './styles.css'` and that the built entry inject that CSS
into `document.head` **at module-evaluation time** (via `vite-plugin-css-injected-by-js`, to
match bunchee's DX). In Node there is no `document`: if the injected snippet is not guarded, the
`import` throws and **every test in the file fails at collection time**, not just test 4.

**Required:** either (a) verify/configure the CSS-injection snippet to no-op under
`typeof document === 'undefined'` (most builds of `vite-plugin-css-injected-by-js` do guard —
**verify it in the built `dist/index.mjs`, do not assume**), or (b) have the e2e spec import
`toast` from a DOM-free subpath/source module (`sonner-vue/dist/state.mjs` or `../../src/state`)
instead of the package root. Option (a) preserves the upstream import line exactly and is
preferred; option (b) is the fallback. **This must be validated before the suite is considered
green** — it is the single highest-blast-radius interaction between the styles slice and the
test slice.

Note that test 4 itself needs no `requestAnimationFrame`: `toast.promise(p, {})` with no
`loading` never creates a toast, so `id` stays `undefined`, `shouldDismiss` stays `false`, and
`Observer.dismiss()` (the only rAF user in `state.ts`) is never reached. Vitest **unit** tests of
`state.ts` that call `toast.dismiss(id)` **do** need an rAF stub — see `state-api-spec.md` AC-S4.

## AC-T2. §9 item 1 (test 27's `[data-dismiss]`) — add a **recommended** option (d).

The upstream test clicks `page.locator('[data-dismiss]')`, and nothing in the library or the
upstream test app renders that attribute (confirmed independently by this audit:
`grep -rn "data-dismiss\b"` across `sonner-react/` matches **only** `test/tests/basic.spec.ts:277`).
The options listed were (a) accept a failing/skipped test, (b) change the selector.

**Add option (d), and treat it as this audit's recommendation:** leave the Playwright spec
**byte-identical to upstream** and add `data-dismiss` to the playground's own Dismiss button
inside the `custom-with-empty-id` toast:
```ts
toast.custom((id) => h('div', [
  h('h1', 'jsx'),
  h('button', { 'data-testid': 'dismiss-button', 'data-dismiss': '', onClick: () => toast.dismiss(id) }, 'Dismiss'),
]), { id: undefined })
```
Rationale: the playground is **our** artifact (ARCHITECTURE.md only requires it to replicate the
DOM contract the tests exercise), whereas the ported spec file is the acceptance bar. Option (d)
is the only option that satisfies "all 36 ported Playwright tests green" without editing a single
line of the ported test file, and it is almost certainly what the upstream test app looked like
when this test was written. Whether to also add `data-dismiss` to the `custom` button (test 20's
toast) is **not** required — test 20 uses `getByTestId('dismiss-button')`. Adding it to only one
of the two buttons avoids any locator ambiguity. **Still an orchestrator decision; recorded here
with a recommendation rather than silently applied.**

## AC-T3. §6's `<ol>` render-guard description is wrong: the guard is **per-`Toaster`**, not per-position.

§6 says the `<ol>` is *"Only rendered once ≥1 toast exists for that position"*. The actual source
guard is `if (!filteredToasts.length) return null;` evaluated **inside** the
`possiblePositions.map()` — it inspects the Toaster's **entire** filtered toast list, not the
per-position subset. Correct statement:

> A `<Toaster>` renders **no `<ol>` at all** (only its outer `<section>`) while it has zero
> toasts. As soon as it has **at least one** toast anywhere, it renders one `<ol>` per entry of
> `possiblePositions` — and `possiblePositions[0]` is always the Toaster's own `position` prop.
> So an `<ol>` for the Toaster's default position can exist **with zero `<li>` children** (e.g.
> every current toast carries an explicit `position` pointing elsewhere).

This does not change any of the 36 tests' outcomes (tests 32/33 rely only on "the *other*
Toaster has zero toasts → no `<ol>` → locator count 0", which both readings produce), but it is
the behavior `component-spec.md` §8.7 mandates and the two documents must agree.

## AC-T4. Test 12's pause mechanism is `expanded`, not `interacting`.

§7 test 12 hedges ("`interacting` … via the Toaster's `onPointerDown`/mouseenter machinery").
Pin it down: `page.hover()` dispatches **no** pointerdown, so `interacting` stays `false`
throughout. The pause comes from the `<ol>`'s `@mouseenter`/`@mousemove` → `expanded = true` →
the Toast's timer watcher re-runs and takes the `pauseTimer()` branch
(`if (expanded || interacting || isDocumentHidden)`). Two consequences for the Vue port:
- `@mouseenter` must be bound to the **`<ol>`**, and it does fire when the pointer enters the
  absolutely-positioned `<li>` (the `<li>` is a DOM descendant, so native `mouseenter` is
  dispatched to the `<ol>` too, even though the `<ol>`'s own box is zero-height).
- The auto-collapse watcher (`if (toasts.length <= 1) expanded = false`) must fire **only on
  `toasts` change**, never on an interval/`expanded` change — otherwise the single toast in this
  test un-pauses itself and the test fails.

## AC-T5. Tests 20 and 25 have hard implementation preconditions recorded in `component-spec.md`'s audit corrections. Do not port them without those.

- **Test 20 (`return focus to the previous focused element`)** requires **both**
  `component-spec.md` **AC-1** (bind `@focusin`/`@focusout` on the `<ol>`, not `@focus`/`@blur`
  — native focus events don't bubble, so the `lastFocusedElement` capture never happens) and
  **AC-2** (restore focus from a `watch(listRef, …)` cleanup that fires when the last toast's
  `<ol>` unmounts, **not** from `onUnmounted` — the `Toaster` never unmounts in this test).
  Either omission fails test 20 with no other visible symptom.
- **Test 25 (`should update toast content and duration after 3 seconds`)** requires
  `component-spec.md` **AC-3**: the `duration → remainingTime` watcher must be **registered
  before** the timer watcher, because Vue runs watchers in creation order and React runs passive
  effects in declaration order. Wrong order → the updated toast re-arms with the stale 10000ms
  budget and survives the test's `waitForTimeout(1200)`.

## AC-T6. Playground reactivity requirements the tests depend on (beyond `theme`).

§8 flags `theme` as needing to be reactive (test 19). Two more, both exercised by **test 31**:
- `containerAriaLabel` flips `undefined → 'Notices'` when `showAriaLabels` flips, so the
  `<section>`'s `aria-label` must be a **computed** value in `Toaster.vue`
  (`customAriaLabel ?? \`${containerAriaLabel} ${hotkeyLabel}\``), not captured once at setup.
  With `withDefaults`, `undefined` correctly resolves to `'Notifications'`.
- `toastOptions.closeButtonAriaLabel` flips `undefined → 'Yeet the notice'` on the same tick,
  and must reach the already-decided-to-render close button. So `toastOptions` must be passed as
  a reactive/computed object from the playground **and** read reactively by `Toast.vue`
  (a destructured-once `const { closeButtonAriaLabel = 'Close toast' } = props` in
  `<script setup>` loses reactivity in Vue < 3.5 without `toRefs`/props-destructure compilation —
  use `props.` access or Vue 3.5+ reactive props destructure, and verify).
  Note the ordering in the app: `setShowAriaLabels(true)` runs **before** `toast(...)`, so the
  toast is created after the label is already `'Yeet the notice'` — but the Toaster re-render
  and the toast creation land in different ticks (the subscribe handler is `setTimeout`-deferred),
  so a non-reactive read would still usually pass. Do not rely on that; make it reactive.

## AC-T7. Timing budget re-check (informational, no change needed).

Test 1's margin is tighter than §7 states once the port's own deferrals are counted:
`setTimeout(0)` in the subscribe handler + 2×`requestAnimationFrame` for the `data-mounted` flip
(~32ms) + `TOAST_LIFETIME` 4000ms + `TIME_BEFORE_UNMOUNT` 200ms ≈ **4235ms**, against the 5000ms
`expect` poll. Still comfortable. But this is why `component-spec.md` AC-8 forbids adding any
further deferral (e.g. a `setTimeout` fallback around the rAF pair) to the mount flip.
