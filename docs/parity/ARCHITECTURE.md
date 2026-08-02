# sonner-vue — Architecture Contract (v1)

Pinned by the orchestrator. All agents follow this. If a decision here conflicts with what you
find in the sonner source, DO NOT silently deviate — report it in your structured output.

Reference React source (sonner v2.0.7): `/private/tmp/claude-501/-Users-michaelmurray-Developer-sonner-vue/e540f102-dcc4-4e5a-95a9-bca108aafa6d/scratchpad/sonner-react`
Target repo: `/Users/michaelmurray/Developer/sonner-vue`

## Product
- npm package **`sonner-vue`** — faithful 1:1 port of **sonner v2.0.7** (React) to **Vue 3**.
- Hard requirement: identical animations, transitions, DOM structure, `data-*` attributes,
  inline CSS custom properties, CSS file, and public API semantics. The ported Playwright
  suite is the acceptance bar.
- License: MIT. Preserve Emil Kowalski's copyright notice, add port attribution.
- Note: `vue-sonner` (a different existing port) already exists on npm. We are NOT it and do
  not copy from it. Port only from the sonner React source.

## Tech
- Vue `^3.4` peer dependency. TypeScript strict. pnpm.
- Library layout under `/src`:
  - `src/index.ts` — public entry. Exports `{ toast, Toaster, useSonner }` + types
    (`ExternalToast`, `ToastT`, `ToasterProps`, `ToastClassnames`, `ToastToDismiss`, `Action`).
    Imports `./styles.css` as a side effect (mirrors sonner's `index.tsx`).
  - `src/state.ts` — port of React `state.ts` (Observer + `toast` function object).
    Framework-agnostic: keep logic line-for-line identical; only type imports change.
  - `src/types.ts` — port of `types.ts`. Mappings:
    `React.ReactNode` → `Renderable` type alias = `string | number | Component | VNode`;
    `React.CSSProperties` → `CSSProperties` from `vue`; `React.RefObject<T>` → `Ref<T>`.
  - `src/Toaster.vue`, `src/Toast.vue` — `<script setup lang="ts">` SFCs mirroring the two
    components in `index.tsx`.
  - `src/assets.ts` — icons as functional components via `h()`, byte-identical SVG output
    (same attributes, classes, structure).
  - `src/hooks.ts` — composables (`useIsDocumentHidden`, `useSonner`).
  - `src/styles.css` — copied from sonner **verbatim** unless a spec documents a required change.

## React → Vue mappings
- `ReactDOM.createPortal(…, document.body)` → `<Teleport to="body">`.
- `useState`/`useRef` → `ref()`; `useMemo` → `computed()`; `useCallback` → plain function.
- `useEffect` → `watch`/`watchEffect`/`onMounted`/`onUnmounted`. Match dependency-array
  semantics deliberately (mount-only effect → `onMounted`; dep-driven → `watch` with the same
  deps; cleanup fns → watch cleanup / `onUnmounted`).
- `React.isValidElement(x)` → `isVNode(x)`; also treat Vue component objects/functions as
  renderable. Provide one shared `renderNode()` helper to render a `Renderable`.
- `cloneElement(icon, { className })` → `h(icon, { class })`.
- Renderable props (`title`, `description`, `icon`, `action`, `cancel`, custom `icons`, …)
  accept `Renderable | (() => Renderable)`. Prop-based API is the parity source of truth;
  Vue slots may be added as sugar only where they cannot change behavior.
- `toast.custom(cb)` accepts `(id) => VNode | Component`.
- Keep sonner's constants byte-identical (e.g. `VISIBLE_TOASTS_AMOUNT`, `VIEWPORT_OFFSET`,
  `MOBILE_VIEWPORT_OFFSET`, `TOAST_LIFETIME`, `TOAST_WIDTH`, `GAP`, `SWIPE_THRESHOLD`,
  `TIME_BEFORE_UNMOUNT`).

## Build & packaging
- Vite lib mode + `vite-plugin-dts`. Outputs: `dist/index.mjs`, `dist/index.cjs`,
  `dist/index.d.ts` (+ `.d.mts`), `dist/styles.css`.
- CSS DX matches sonner: styles work without a manual consumer import
  (`vite-plugin-css-injected-by-js`), and `./dist/styles.css` stays in the exports map for
  manual/CSP use. If spec analysis shows sonner's shipped dist behaves differently, flag it —
  we match sonner.
- `package.json` exports map mirrors sonner's (`.` with import/require/types conditions,
  `./dist/styles.css`). `sideEffects` must include the CSS-injecting entry + css.

## Repo layout
```
/                  library package (src/, package.json, vite.config.ts, tsconfig.json)
/playground        private Vite+Vue app. Replicates sonner's test app DOM contract exactly
                   (same buttons/classes/test hooks/URL-param config) so the ported
                   Playwright suite runs nearly unchanged. Doubles as the dev playground.
/test/e2e          ported Playwright specs (from sonner test/tests/basic.spec.ts)
/test/unit         Vitest unit tests (state module, timers, promise flows)
```
- Root scripts: `dev` (playground), `build`, `test` (unit), `test:e2e`, `type-check`.

## Orchestrator decisions (post-audit — AUTHORITATIVE, override anything above that conflicts)
- **D1 — No Teleport, no cloneElement.** sonner v2.0.7 has no portal (Toaster renders in place
  where the consumer mounts it) and no cloneElement. The mappings listed earlier for these are
  vacuous — do NOT add `<Teleport>` or icon class-injection.
- **D2 — action/cancel resolution keeps upstream observable behavior.** VNode → passthrough
  render; `Action` object (`isAction` guard) → button; Vue components and function thunks
  `() => Renderable` are additionally accepted (Vue necessity — VNodes must not be created
  eagerly and reused) and render via `renderNode()`; bare string/number action/cancel render
  NOTHING (upstream parity, per state-api-spec AC-S5). `Action.label` stays plain `Renderable`
  (no thunk widening). `icon`/`icons.*` accept `Renderable | (() => Renderable)`; strings render
  as text (upstream parity — ReactNode strings render).
- **D3 — Toaster DOM node access: accept-and-document.** Consumers use a template ref; the root
  `<section>` is reachable via `$el`. No wrapper/forwardRef emulation.
- **D4 — subscribe-once.** Port Toaster's `ToastState.subscribe` effect as a subscribe-once
  `onMounted`/`onUnmounted` pair. Upstream's `[toasts]` resubscribe churn is vestigial and
  unobservable; document as an intentional internal simplification.
- **D5 — Playwright port parity.** The playground dev server binds port 3000 (`strictPort`);
  `baseURL` stays `http://localhost:3000` so the ported config is minimal-diff.
- **D6 — Test 27 (`[data-dismiss]`).** Nothing upstream renders `data-dismiss`; per audit
  option (d), the playground's own Dismiss button inside the custom-with-empty-id toast carries
  `data-dismiss`. The ported spec file stays byte-identical.
- **D7 — `rsf-promise` button.** Stub with a plain setTimeout-resolved promise, keeping the same
  button/test-id DOM contract. No server-actions port. Documented deviation.
- **D8 — Omit `sideEffects`** from package.json entirely (matches sonner; safest default).
- **D9 — styles.css lands via byte-identical `cp`** from the reference repo, diff-verified.
  AC-CSS1's embedded copy in styles-spec.md is the cross-check.
- **D10 — CSS injection guard.** `vite-plugin-css-injected-by-js` with an `injectCodeFunction`
  guarded by `typeof document !== 'undefined'`. Acceptance: built `dist/index.mjs` imports in
  bare Node without throwing (AC-T1).
- **D11 — Audit timing mandates are binding:** `@focusin`/`@focusout` on the `<ol>` (AC-1);
  focus-restore via `watch(listRef, …, { flush: 'post' })` + onCleanup (AC-2); watcher
  registration in exact source order with a load-bearing comment (AC-3); Loader called as a
  plain function, never mounted as an implicit functional component (AC-6/AC-S1); double-rAF
  `data-mounted` flip fused with mount-time height measurement; swipe `--swipe-amount-x/y` via
  direct `el.style.setProperty()` (never reactive `:style`); exact inline-style spread orders
  (toaster root: offset vars AFTER consumer style; toast: JS vars BEFORE `...style, ...toast.style`).

## Quality bar (verifier-enforced)
- All 36 ported Playwright tests green. Vitest units green. `pnpm build` clean,
  `type-check` clean, `publint` + `@arethetypeswrong/cli` pass.
