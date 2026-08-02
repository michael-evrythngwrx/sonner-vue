# Spec audit — Opus verifier pass

Scope: adversarial cross-check of `ARCHITECTURE.md`, `component-spec.md`, `state-api-spec.md`,
`styles-spec.md`, `test-contract.md` against the pinned React source
(`sonner-react/src/{index.tsx,state.ts,types.ts,hooks.tsx,assets.tsx,styles.css}`) and
`sonner-react/test/**`.

**Overall verdict: the four specs are unusually thorough and mostly correct.** Every module-level
constant, every `data-*` attribute, every quirk in `state.ts`, and every one of the 36 Playwright
tests is documented accurately. 14 gaps were found; **5 would have broken behavioral parity or
blocked implementation outright.** All 14 are now fixed in-place in the specs, in
`## Audit corrections` / `# Audit corrections` sections marked authoritative-over-body (plus one
inline correction in `styles-spec.md` §4.6).

---

## Critical gaps (would have broken parity / blocked the slice)

### 1. `styles-spec.md` §3 "Full verbatim source" was empty — the slice was unimplementable
`styles-spec.md` §3 instructs "copy `sonner-react/src/styles.css` verbatim" but contains no copy,
and implementation agents are barred from opening the React source. §4's fenced blocks *do*
cumulatively contain every declaration (verified programmatically: 0 of 725 lines missing), but
§4 is ordered **by concern, not by source line** (§4.11 = source lines 463–530 precedes §4.12 =
lines 219–251), while §4.5 itself declares rule order load-bearing for the `--y` cascade.
Reconstructing from §4 in document order yields a broken cascade.
**Fix:** `styles-spec.md` → `AC-CSS1` now embeds the complete 725-line file byte-for-byte
(verified equal to source via script) and demotes §4 to commentary.

### 2. React `onFocus`/`onBlur` on the `<ol>` are bubbling `focusin`/`focusout`; Vue's `@focus`/`@blur` are not
`component-spec.md` §8.5 specifies the handlers but never states the Vue event-name mapping —
the single most classic React→Vue trap in this file. Focus lands on a `<button>` *inside* the
toast, so with `@focus` the `<ol>`'s handler never runs, `lastFocusedElementRef` is never
captured, and Playwright test 20 (`return focus to the previous focused element`) fails.
**Fix:** `component-spec.md` → `AC-1` mandates `@focusin`/`@focusout`, and documents that
`@mouseenter`/`@mouseleave`/`@mousemove`/pointer/`@dragend` need **no** adaptation (native
`mouseenter` *is* dispatched to the ancestor `<ol>` even though its box is zero-height).

### 3. §8.4.6's recommended `onUnmounted` simplification silently kills focus restoration
The spec asserts *"the only externally-meaningful moment this fires is `Toaster` unmounting
entirely."* False. The React effect's dep is `listRef.current`, and the `<ol>` unmounts every
time the Toaster's `filteredToasts` empties (`if (!filteredToasts.length) return null`) — which
is exactly what happens when the last toast is dismissed, with `Toaster` still mounted. That
`<ol> → null` transition is what fires the cleanup that restores focus. Test 20 never unmounts
the Toaster, and Chromium does not fire `blur`/`focusout` when a focused element is removed, so
the `onUnmounted` port restores focus **never**.
**Fix:** `component-spec.md` → `AC-2` replaces it with `watch(listRef, (el, _prev, onCleanup) => …, { flush: 'post' })`, registering the restore as the watcher's cleanup (which also covers
component unmount), plus the requirement that the callback-ref writes `null` on unmount.

### 4. Vue watcher **registration order** is load-bearing and unstated (breaks test 25)
React flushes passive effects in declaration order, so `remainingTime.current = duration`
(source line 145) always runs before the timer effect (line 197) re-arms with
`remainingTime.current`. Vue runs watchers in **creation order**. If `Toast.vue` registers the
timer watcher first, an updated toast re-arms with the stale budget — test 25
(`should update toast content and duration after 3 seconds`: 10000ms → 1000ms) fails, because
the toast would close at t≈13000 instead of t≈4200.
**Fix:** `component-spec.md` → `AC-3` mandates registration in exact source order §5.5.1 →
5.5.2 → 5.5.3 → 5.5.4 → 5.5.6 → 5.5.7, with a load-bearing-order code comment.
Cross-referenced from `test-contract.md` → `AC-T5`.

### 5. `Loader` rendered as a Vue functional component destroys the spinner's class
`state-api-spec.md` §4.3 defines `Loader({visible, className})` as a plain function;
`component-spec.md` §5.9 renders it as `<Loader className={…} visible={…} />`. Ported literally
as `h(Loader, { className, visible })`, Vue treats it as a functional component with undeclared
props: every entry is *also* a fallthrough attr merged onto the root element, and because
`className` is a real DOM property Vue executes `el.className = <value>`, **overwriting
`sonner-loading-wrapper`** — every `.sonner-loading-wrapper` / `.sonner-spinner` /
`.sonner-loading-bar` rule stops applying and a stray `visible="true"` attribute leaks out.
**Fix:** `component-spec.md` → `AC-6` and `state-api-spec.md` → `AC-S1` mandate invoking
`Loader(...)` directly as a function (alternative: declare `props` **and** `inheritAttrs: false`).

---

## Non-critical gaps (correctness/parity/robustness), all fixed

### 6. Cross-slice: test 4 imports the library into Node; CSS auto-injection must be SSR-safe
`test-contract.md` test 4 does a top-level `import { toast } from 'sonner'` and runs it in the
Playwright/Node process, while `styles-spec.md` §1 mandates CSS injection into `document.head`
at module-evaluation time. If the injected snippet isn't guarded by
`typeof document === 'undefined'`, the import throws and **all 36 tests fail at collection**.
Neither spec noticed the interaction.
**Fix:** `test-contract.md` → `AC-T1` requires verifying the guard in the built `dist/index.mjs`,
with a DOM-free-subpath import as fallback. Also records that test 4 itself needs no `rAF`, but
Vitest unit tests calling `toast.dismiss(id)` do (`state-api-spec.md` → `AC-S4`).

### 7. `styles-spec.md` §4.6 misexplained `scale(calc(-1 * var(--scale)))` as a negative/mirrored scale
`--scale` is a raw token stream, so the expansion is `calc(-1 * var(--toasts-before) * 0.05 + 1)`
= `1 − 0.05·n` → `0.95 / 0.9 / 0.85`. **Positive, slightly shrunk; nothing is ever mirrored.**
The wrong reading actively invites "fixing" the missing `calc()` on the `--scale` declaration,
which *would* introduce a real 180° flip on every stacked toast.
**Fix:** inline corrected boxed note in `styles-spec.md` §4.6 + `AC-CSS2`.

### 8. Bare-JSX attributes render `="true"`, but a bare Vue template attribute renders `=""`
`component-spec.md` §6.5/§9.1 establish the React rule but §5.7/§8.7's render trees still write
`data-sonner-toaster`, `data-close-button`, `data-button`, `data-cancel`, `data-action`,
`data-react-aria-top-layer` bare — copied into a Vue template these become `=""`.
**Fix:** `AC-4` adds an exact per-attribute table (`""` for `data-sonner-toast`/`data-icon`/
`data-content`/`data-title`/`data-description`; `"true"` for the six bare ones), plus the
`tabIndex`→`tabindex`, `className`→`class`, `key`→`:key` translations and "omit
`suppressHydrationWarning`". Cosmetic for CSS/locators (all presence-matched), required by the
byte-identical-DOM bar.

### 9. Two ARCHITECTURE.md React→Vue mappings are vacuous for v2.0.7 and would cause deviations if applied
Verified: `index.tsx` imports `ReactDOM` **only** for `flushSync` — there is **no
`createPortal`** and **no `cloneElement`** anywhere in `src/`. An implementer following
ARCHITECTURE.md literally could wrap `Toaster` in `<Teleport to="body">` (moving the `<section>`
in DOM/tab order) or inject a `class` into resolved icons.
**Fix:** `component-spec.md` → `AC-5` forbids both explicitly. Reported here per ARCHITECTURE.md's
"do not silently deviate" clause.

### 10. Stored `VNode`s must be cloned before rendering
`toast.jsx`, and VNode-valued `toast.icon`/`action`/`cancel`/`ToastIcons.*`, live in
module-level state and can be rendered by **two `Toaster` instances at once** (two `<Toaster/>`s
without an `id` both receive every untagged toast). React elements tolerate this; Vue VNodes
carry mount state and cannot be mounted twice. `state-api-spec.md` §4.1 flagged the hazard for
the *asset* icons only, and solved it there; the stored-VNode case was unaddressed.
**Fix:** `component-spec.md` → `AC-7` and `state-api-spec.md` → `AC-S2` require `renderNode()`
to `cloneVNode()` VNodes (Vue's `patch()` early-returns on `n1 === n2`, so same-slot re-render
was already safe — the hazard is strictly two-Toaster / re-mount).

### 11. Missing `:key` requirements
Neither §8.7 nor §8.8 states the Vue `:key`s. `<Toast :key="toast.id">` is what makes `toast.id`
immutable per instance (an assumption §5.5.3 depends on) and what makes an in-place content
update reuse the same `<li>` — required by test 36 (`testId maintains through state changes`).
`<ol :key="position">` keeps the callback-`listRef`/focus bookkeeping in sync.
**Fix:** `component-spec.md` → `AC-9`.

### 12. Double-rAF mount flip: undocumented hidden-tab behavior
`requestAnimationFrame` doesn't fire in a hidden tab, so `data-mounted` stays `false` (opacity 0)
until the tab is shown, unlike React's MessageChannel-scheduled effect. Analysed: **benign** —
`useIsDocumentHidden()` already forces `pauseTimer()` for the whole hidden period, so no toast
can be lost; it animates in on return.
**Fix:** `component-spec.md` → `AC-8` documents it, forbids a `setTimeout` fallback race, and
requires `pretendToBeVisual`/an rAF stub for jsdom unit tests.

### 13. Test-contract factual fixes
- §6's `<ol>` render guard described as per-position; it is **per-Toaster** (`filteredToasts`
  globally). Corrected in `AC-T3` (no test outcome changes; the two specs now agree).
- Test 12's pause is via `expanded` (mouseenter → `setExpanded(true)`), **not** `interacting`
  (`page.hover()` dispatches no pointerdown). Corrected in `AC-T4`, with the consequence that the
  auto-collapse watcher must fire only on `toasts` change.
- Test 31 requires `containerAriaLabel` and `toastOptions.closeButtonAriaLabel` to be **reactive**
  (§8 only flagged `theme`). Added in `AC-T6`, including the `<script setup>` props-destructure
  reactivity caveat.
- Test 1's real timing budget with the port's own deferrals is ≈4235ms vs the 5000ms poll —
  recorded in `AC-T7` as the reason no further deferral may be added to the mount flip.

### 14. Small factual fixes inside `component-spec.md`
- §5.8 `onPointerUp`: with `dragStartTime === null`, `timeTaken` is **`NaN`** (not "near 0"),
  `velocity` is `NaN`, `NaN > 0.11` is false → `else` branch, as concluded. Port the arithmetic
  literally; do not add a null-guard that would skip the CSS-var reset.
- `--index` is set on every `<li>` but referenced **nowhere** in `styles.css` (full `var(--`
  grep). Set it anyway; only `--toasts-before` participates in the stack math.
- `remainingTime` can go **negative** via `pauseTimer()`; a negative `setTimeout` delay fires
  immediately, which is the intended catch-up. No clamp in source — do not add one.
- `component-spec.md` §10 open question 2 ("is click-after-swipe suppressed in CSS?") is now
  **closed**: `styles.css`'s only `pointer-events` rule is
  `[data-sonner-toast][data-visible='false'] { pointer-events: none }` (the overflow stack).
  There is no post-swipe click suppression in JS **or** CSS. Recorded in `AC-11` and `AC-CSS3`.
- `state-api-spec.md` → `AC-S3`: the boxed-`Number` return of `promise()` is not a usable
  `create()` id (`typeof === 'object'` mints a fresh id) and `dismiss()` stores the wrapper in
  `dismissedToasts`, so `has(rawId)` is false. Upstream behavior; preserve, don't normalize.
- `state-api-spec.md` → `AC-S4`: neither `useIsDocumentHidden`'s bare `document.hidden` read nor
  `Observer.dismiss`'s bare `requestAnimationFrame` may be SSR-guarded — upstream isn't; the
  Vitest setup file must supply the stub instead.

---

## Verified-correct (spot-checked, no change needed)

- All 8 module constants, `SWIPE_THRESHOLD` 45 / `velocity > 0.11` **OR** (not AND), dampening
  `1/(1.5 + |δ|/20)`, direction-lock threshold `> 1`, `TIME_BEFORE_UNMOUNT` 200 = CSS
  `animation-duration: 200ms`.
- Every `data-*` attribute on `<li>`/`<ol>`/`<section>`, including omit-on-`undefined`/`null`
  semantics, and the `??` vs `||` asymmetries (`richColors`/`closeButton`/`icons.close` use `??`;
  `invert`/`duration`/button styles use `||`).
- The whole of `state.ts`: id-resolution asymmetries (`create` handles `0`, `dismiss`/`custom`/
  base `toast()` don't), the `publish`-omits-`dismissible` divergence, `dismiss()` no-id not
  populating `dismissedToasts`, `Observer.toasts` never shrinking, all five `promise()` branch
  orders and the `isExtendedResult`/`null`-spread edge case, `Object.assign` boxing.
- All four SVG assets incl. the `fillRule`→`fill-rule` / `strokeWidth`→`stroke-width` JSX
  translation trap and the warning icon's distinct `viewBox="0 0 24 24"`.
- `styles.css` line-coverage in `styles-spec.md` §4: **725/725 declaration lines present**.
- All 36 Playwright tests transcribed accurately, including the deliberately-weak assertion in
  test 10 and the already-flagged broken `[data-dismiss]` selector in test 27 (for which this
  audit adds recommended option (d): add `data-dismiss` to the playground button and leave the
  ported spec byte-identical).
