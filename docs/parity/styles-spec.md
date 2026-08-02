# styles.css — Port Spec (sonner v2.0.7 → sonner-vue)

Source file: `sonner-react/src/styles.css` (725 lines).
Also inspected: `sonner-react/package.json`, `sonner-react/src/index.tsx` (lines 1–20, 260–360,
490–550, 760–889), `sonner-react/README.md`.

**Port instruction: this file is copied VERBATIM, byte-for-byte, into `src/styles.css` of
sonner-vue.** No selector, property, value, custom-property name, keyframe name, or ordering may
change. See "Verbatim verdict" section below for the full justification and the (empty) list of
exceptions.

---

## 1. CSS delivery verdict — how styles reach consumers in sonner's shipped npm package

### Evidence

1. `sonner-react/src/index.tsx` line 9: `import './styles.css';` — a plain side-effect CSS
   import at the top of the package's single JS entry point (the same file that exports `toast`,
   `Toaster`, `useSonner`).
2. `sonner-react/package.json`:
   - `"exports"`: `"."` maps to `dist/index.mjs` (import) / `dist/index.js` (require), and
     **additionally** exposes `"./dist/styles.css": "./dist/styles.css"` as its own export
     subpath.
   - `"scripts.build"`: `"bunchee && cp src/styles.css dist/styles.css"`. Two distinct steps:
     - `bunchee` (a zero-config Rollup-based bundler used for npm libraries) bundles
       `src/index.tsx`, which drags in `styles.css` via the top-of-file import. Bunchee's default
       CSS handling for a library entry with a bare `import './x.css'` is to compile the CSS and
       **inject it into the JS output as a runtime side effect** — the bundled JS, when
       evaluated, creates a `<style>` element (or appends a `<style>` block) into
       `document.head` containing the compiled CSS. This is a `style-inject`-style pattern, not
       a `import` that a downstream bundler must additionally resolve.
     - The second shell step, `cp src/styles.css dist/styles.css`, is a **plain, unprocessed file
       copy** — it does not depend on or reuse whatever bunchee did with the CSS during JS
       bundling. It exists solely to populate the `./dist/styles.css` export subpath added to
       `package.json`.
   - No `sideEffects` field is declared in `package.json` at all (see open question below).
3. `sonner-react/README.md` "Usage" section shows only:
   ```jsx
   import { Toaster, toast } from 'sonner';
   ```
   with **no accompanying `import 'sonner/dist/styles.css'`** or any CSS-import step. This is the
   entire documented install/usage flow. If styles required a manual import, the README's minimal
   example would be broken out of the box — it isn't, which corroborates auto-injection being the
   primary/expected path.

### Verdict

Sonner ships CSS to consumers **two ways simultaneously**, with auto-injection as the primary,
zero-config path:

- **Primary (default, documented) path**: `import { Toaster, toast } from 'sonner'` alone is
  sufficient. Evaluating the package's JS entry has the side effect of injecting all of
  `styles.css`'s content into `document.head` via a `<style>` tag at runtime. No consumer action
  needed, no bundler CSS-loader configuration needed on the consumer's side.
- **Secondary (opt-in) path**: `sonner/dist/styles.css` is available as a plain, unprocessed CSS
  file for consumers who want to `<link>` it manually, feed it through their own CSS pipeline, or
  who run under a CSP that blocks runtime-inserted `<style>` tags (inline-injected styles violate
  `style-src` without `'unsafe-inline'`/nonces). This file is a byte-identical copy of
  `src/styles.css` — no build-time transform is applied to it (confirmed by the `cp` command,
  not a bundler/minifier invocation).

This exactly matches what ARCHITECTURE.md already prescribes ("styles work without a manual
consumer import ... and `./dist/styles.css` stays in the exports map for manual/CSP use") — this
spec **confirms** that prescription against the source rather than contradicting it.

### What our Vite build must do (to match sonner's DX)

- `src/index.ts` (public entry) must `import './styles.css'` at module top-level (mirrors
  `index.tsx` line 9), exactly as ARCHITECTURE.md section "Library layout" already specifies.
- The Vite lib-mode build must use `vite-plugin-css-injected-by-js` on the primary JS output
  (`dist/index.mjs`, `dist/index.cjs`) so that importing `sonner-vue` causes the bundled CSS to be
  inlined as a JS string and injected into `document.head` via a `<style>` element at
  module-evaluation time — reproducing bunchee's auto-injection behavior byte-for-byte in spirit
  (exact injected `<style>` tag markup need not match bunchee's internal helper implementation;
  what must match is the *outcome*: importing the package alone is sufficient to render fully
  styled toasts, no separate CSS import required).
- Separately (not derived from the injected-JS build step), emit an **unmodified copy** of
  `src/styles.css` to `dist/styles.css`, exactly as sonner's `cp src/styles.css dist/styles.css`
  step does — do not run this copy through PostCSS/minification/autoprefixing, to stay
  byte-identical to the source-controlled file (mirrors sonner: their copy step is also a raw
  `cp`, not a build).
- `package.json` `exports` map must mirror sonner's: `.` with `import`/`require`/`types`
  conditions pointing at the injected-CSS JS bundles, plus `"./dist/styles.css":
  "./dist/styles.css"` as its own subpath export.

---

## 2. Verbatim verdict

**Every rule in this stylesheet can be copied verbatim into a Vue project with zero modification.**
The file contains no React-specific syntax (it is plain CSS, not CSS-in-JS/styled-components), no
JSX, no build-tool-specific `@import`/`url()` that would need path rewriting relative to a new
build root (there are none — no external asset references, no `@import` statements, no
`url()`s anywhere in the file), and no dependency on React's synthetic event system or React DOM
internals. All selectors target plain HTML `data-*` attributes and CSS classes that Vue's SFC
DOM output can set identically to React's.

**List of rules that could NOT be copied verbatim: none.**

The only things that differ between the React and Vue ports are **outside this file**:
- *which framework code sets* the `data-*` attributes and inline custom properties this
  stylesheet reads (React JSX attribute props vs. Vue template bindings) — that is the concern of
  the `Toast.vue`/`Toaster.vue` slice, not this one.
- The raw CSS text itself is 100% portable and must land in `src/styles.css` of sonner-vue
  unchanged, including comments (there are none), whitespace, and rule order (rule order is
  load-bearing — see §4.5 on cascade order for `--y`).

One nuance worth flagging for the implementer (not a required change, a correctness trap):
`--scale` is assigned as a *raw, unevaluated token stream* (`--scale: var(--toasts-before) * 0.05
+ 1;` — **not** wrapped in `calc()`) and is only evaluated later when substituted inside an outer
`calc()` at the consumption site (`scale(calc(-1 * var(--scale)))`). This is valid, intentional
CSS custom-property behavior (custom properties can hold arbitrary token sequences; substitution
happens at used-value time inside the referencing `calc()`). Do **not** "fix" this by wrapping the
`--scale` declaration in its own `calc(...)` — that would still work in evergreen browsers today,
but changes the value to a different token stream than sonner's, which is out of scope for a
"verbatim" port. Copy the line exactly as written.

---

## 3. Full verbatim source (reference copy)

The implementer must copy `sonner-react/src/styles.css` verbatim. The organized walkthrough below
(§4) exists to explain *what each block does* and *how the JS side must interface with it* — it is
not a substitute for the verbatim copy. Where a code block is quoted below, it is quoted exactly
as it appears in the source (same indentation, same quote style `'...'` for attribute values,
same trailing semicolons/lack thereof).

---

## 4. Organized inventory by concern

### 4.1 RTL direction variables (lines 1–25)

Two blocks set direction-dependent custom properties, keyed off the **`dir` HTML attribute**
(not a `data-*` attribute) present on either the real `<html>` element or the toaster's own root
element (`[data-sonner-toaster][dir='ltr']` / `[dir='rtl']`):

```css
html[dir='ltr'],
[data-sonner-toaster][dir='ltr'] {
  --toast-icon-margin-start: -3px;
  --toast-icon-margin-end: 4px;
  --toast-svg-margin-start: -1px;
  --toast-svg-margin-end: 0px;
  --toast-button-margin-start: auto;
  --toast-button-margin-end: 0;
  --toast-close-button-start: 0;
  --toast-close-button-end: unset;
  --toast-close-button-transform: translate(-35%, -35%);
}

html[dir='rtl'],
[data-sonner-toaster][dir='rtl'] {
  --toast-icon-margin-start: 4px;
  --toast-icon-margin-end: -3px;
  --toast-svg-margin-start: 0px;
  --toast-svg-margin-end: -1px;
  --toast-button-margin-start: 0;
  --toast-button-margin-end: auto;
  --toast-close-button-start: unset;
  --toast-close-button-end: 0;
  --toast-close-button-transform: translate(35%, -35%);
}
```

**JS-side interface**: the toaster's root list element (`<ol>` in React) must render a `dir`
attribute (not `data-dir`) equal to `dir === 'auto' ? getDocumentDirection() : dir`, where
`getDocumentDirection()` reads `document.documentElement.getAttribute('dir')` (falling back to
`window.getComputedStyle(document.documentElement).direction` when that attribute is `'auto'` or
absent). That JS logic lives in the Toaster component slice, not here — but this stylesheet is
the reason it must be a plain `dir="ltr"|"rtl"` attribute and not `data-dir`.

There is **no separate RTL handling elsewhere in the file** beyond these two blocks plus one
mobile-media-query override (§4.10).

### 4.2 Toaster (`[data-sonner-toaster]`) base positioning & the gray scale (lines 27–79)

```css
[data-sonner-toaster] {
  position: fixed;
  width: var(--width);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial,
    Noto Sans, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji;
  --gray1: hsl(0, 0%, 99%);
  --gray2: hsl(0, 0%, 97.3%);
  --gray3: hsl(0, 0%, 95.1%);
  --gray4: hsl(0, 0%, 93%);
  --gray5: hsl(0, 0%, 90.9%);
  --gray6: hsl(0, 0%, 88.7%);
  --gray7: hsl(0, 0%, 85.8%);
  --gray8: hsl(0, 0%, 78%);
  --gray9: hsl(0, 0%, 56.1%);
  --gray10: hsl(0, 0%, 52.3%);
  --gray11: hsl(0, 0%, 43.5%);
  --gray12: hsl(0, 0%, 9%);
  --border-radius: 8px;
  box-sizing: border-box;
  padding: 0;
  margin: 0;
  list-style: none;
  outline: none;
  z-index: 999999999;
  transition: transform 400ms ease;
}
```

- `z-index: 999999999` — literal 9-digit value, copy exactly (not `2147483647` or any other
  "max" convention).
- `transition: transform 400ms ease;` — **the only transition on the toaster root itself**; only
  ever visually relevant when the (currently dead-code, see §4.2.1) `data-lifted` selector below
  applies, or if a consumer JS animates the toaster's own transform.
- The gray scale (`--gray1`…`--gray12`) is declared **once**, on `[data-sonner-toaster]`, and
  cascades down to descendants; it is **not** redeclared per-theme (light/dark theme blocks in
  §4.11 do not touch `--gray*`). Only `--gray1`, `--gray2`, `--gray3`, `--gray4`, `--gray5`,
  `--gray11`, `--gray12` are actually referenced elsewhere in the file (verified via a full
  `var(--gray*)` grep); `--gray6`–`--gray10` are declared but currently unused by this
  stylesheet — copy them anyway, verbatim, they're part of the file.
- `--border-radius: 8px` — the single source of the toast card's corner radius, consumed at
  `border-radius: var(--border-radius)` in §4.3.

#### 4.2.1 Dead-code note: `data-lifted`

```css
@media (hover: none) and (pointer: coarse) {
  [data-sonner-toaster][data-lifted='true'] {
    transform: none;
  }
}
```

This rule targets `[data-sonner-toaster][data-lifted='true']`, scoped to coarse-pointer/no-hover
(touch) devices. **Grep of `sonner-react/src/index.tsx` for `lifted` returns zero matches** — no
JS in this version of the source ever sets a `data-lifted` attribute on the toaster. This
selector is therefore currently inert/dead code in v2.0.7 (perhaps vestigial from another
version, or intended for a consumer to set manually). Copy it verbatim regardless (verbatim-port
mandate) — do not add JS in the Vue port that sets `data-lifted`, since the React source doesn't
either; adding it would be a behavioral deviation, not a fix.

#### 4.2.2 Positioning by `data-x-position` / `data-y-position` (lines 60–79)

```css
[data-sonner-toaster][data-x-position='right'] {
  right: var(--offset-right);
}

[data-sonner-toaster][data-x-position='left'] {
  left: var(--offset-left);
}

[data-sonner-toaster][data-x-position='center'] {
  left: 50%;
  transform: translateX(-50%);
}

[data-sonner-toaster][data-y-position='top'] {
  top: var(--offset-top);
}

[data-sonner-toaster][data-y-position='bottom'] {
  bottom: var(--offset-bottom);
}
```

`--offset-{top,right,bottom,left}` are inline custom properties set by JS on the toaster's root
element (`assignOffset()` in `index.tsx`, outside this slice) — see §5 interface table.

### 4.3 Toast (`[data-sonner-toast]`) base structural styles (lines 81–111)

```css
[data-sonner-toast] {
  --y: translateY(100%);
  --lift-amount: calc(var(--lift) * var(--gap));
  z-index: var(--z-index);
  position: absolute;
  opacity: 0;
  transform: var(--y);
  touch-action: none;
  transition: transform 400ms, opacity 400ms, height 400ms, box-shadow 200ms;
  box-sizing: border-box;
  outline: none;
  overflow-wrap: anywhere;
}

[data-sonner-toast][data-styled='true'] {
  padding: 16px;
  background: var(--normal-bg);
  border: 1px solid var(--normal-border);
  color: var(--normal-text);
  border-radius: var(--border-radius);
  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1);
  width: var(--width);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

[data-sonner-toast]:focus-visible {
  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 2px rgba(0, 0, 0, 0.2);
}
```

- **Transition on the toast root**: `transform 400ms, opacity 400ms, height 400ms, box-shadow
  200ms` — no explicit easing keyword on any of the four properties, so all four use the CSS
  default `ease`. No `cubic-bezier(...)` values appear here (nor anywhere else in this file — see
  §4 preamble note below).
- `transform: var(--y);` is the **only** place `transform` is set on the base rule; every other
  rule that changes toast position/scale does so by redefining the `--y` **custom property**, not
  by writing a new `transform:` declaration (the one exception is the swiping rule, §4.7, which
  layers additional `translateY`/`translateX` onto `var(--y)` directly in its own `transform:`
  declaration).
- **`data-styled='true'`** is the "styled" escape-hatch gate (see §4.13 for the escape-hatch
  explanation) — nearly the entire cosmetic skin (padding, background, border, shadow, width,
  font-size, flex layout, and all further `[data-styled='true']`-scoped descendant rules for
  title/description/icon/buttons/close-button) is conditioned on this attribute being `'true'`.
  When it is `'false'` (i.e. `toast.jsx` is set, or `toast.unstyled`, or the toaster-level
  `unstyled` prop is set), only the **unscoped** structural rules — position, `--y`
  transform, opacity, transitions, `z-index`, `touch-action` — still apply.
- `:focus-visible` box-shadow adds a `0 0 0 2px rgba(0, 0, 0, 0.2)` ring on top of the same base
  drop-shadow, applied whenever the *toast* (not a button inside it) receives keyboard focus (the
  toast `<li>` has `tabIndex={0}`, set in the Toast component, outside this slice).

**No cubic-bezier easing curves exist anywhere in this file.** Every timing function used across
the whole stylesheet is one of the CSS keywords `ease` (implicit default, or explicit as on the
toaster's `transform 400ms ease`), `ease-out` (swipe-out animations, §4.9), or `linear` (spinner
spin, §4.14). There is no third-party or custom bezier curve to preserve — if an implementer finds
themselves reaching for a `cubic-bezier(...)` value while porting this file, that is a sign they
have deviated from source; there is none in the original.

### 4.4 y-position lift setup (lines 113–125)

```css
[data-sonner-toast][data-y-position='top'] {
  top: 0;
  --y: translateY(-100%);
  --lift: 1;
  --lift-amount: calc(1 * var(--gap));
}

[data-sonner-toast][data-y-position='bottom'] {
  bottom: 0;
  --y: translateY(100%);
  --lift: -1;
  --lift-amount: calc(var(--lift) * var(--gap));
}
```

`--lift` is the sign convention used everywhere below to make the same formula work for both
top-anchored and bottom-anchored toast stacks: `+1` when toasts stack downward from a top anchor,
`-1` when they stack upward from a bottom anchor. `--lift-amount` is the per-toast vertical pixel
delta (`--lift * --gap`) used by the collapsed-stack transform (§4.6). Note the top block hardcodes
`calc(1 * var(--gap))` (not `calc(var(--lift) * var(--gap))`, even though `--lift: 1` was just set
one line above) — copy this exactly as-is; both expressions are numerically equivalent since
`--lift` is `1`, but the literal `1` is what's in source, not a `var(--lift)` reference.

### 4.5 `--y` cascade — full enumeration and why source order matters

`--y` (and therefore the toast's rendered `transform`, since `transform: var(--y)` never changes)
is redefined by **multiple, mutually-exclusive-by-runtime-state, equal-or-near-equal-specificity**
attribute-selector rules scattered through the file. Because plain CSS cascade rules apply
(specificity, then **source order** as tiebreaker), and this port is verbatim, rule order in the
copied file must be preserved exactly — do not alphabetize, group, or otherwise reorder selectors.
Full enumeration, in file order:

| Order | Selector | `--y` value | Also sets |
|---|---|---|---|
| 1 | `[data-sonner-toast]` (base) | `translateY(100%)` | `--lift-amount: calc(var(--lift) * var(--gap))` |
| 2 | `[data-sonner-toast][data-y-position='top']` | `translateY(-100%)` | `top:0`, `--lift:1`, `--lift-amount: calc(1 * var(--gap))` |
| 3 | `[data-sonner-toast][data-y-position='bottom']` | `translateY(100%)` | `bottom:0`, `--lift:-1`, `--lift-amount: calc(var(--lift) * var(--gap))` |
| 4 | `[data-sonner-toast][data-mounted='true']` | `translateY(0)` | `opacity: 1` |
| 5 | `[data-sonner-toast][data-expanded='false'][data-front='false']` | `translateY(calc(var(--lift-amount) * var(--toasts-before))) scale(calc(-1 * var(--scale)))` | `--scale: var(--toasts-before) * 0.05 + 1` (raw, unevaluated — see §2 note), `height: var(--front-toast-height)` |
| 6 | `[data-sonner-toast][data-mounted='true'][data-expanded='true']` | `translateY(calc(var(--lift) * var(--offset)))` | `height: var(--initial-height)` |
| 7 | `[data-sonner-toast][data-removed='true'][data-front='true'][data-swipe-out='false']` | `translateY(calc(var(--lift) * -100%))` | `opacity: 0` |
| 8 | `[data-sonner-toast][data-removed='true'][data-front='false'][data-swipe-out='false'][data-expanded='true']` | `translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%))` | `opacity: 0` |
| 9 | `[data-sonner-toast][data-removed='true'][data-front='false'][data-swipe-out='false'][data-expanded='false']` | `translateY(40%)` | `opacity: 0`, `transition: transform 500ms, opacity 200ms` (overrides the base 400ms transition) |

Since specificity is determined by attribute-selector count and rows 4–9 have differing counts of
matched attribute selectors (equal-specificity combos never co-apply because the `data-*` values
involved — `mounted`/`expanded`/`removed`/`front`/`swipe-out` — are mutually exclusive by the time
a real toast reaches any given state), in practice only one of rows 4–9 (plus always rows 1–3 as a
lower-specificity base) is "winning" `--y` at a time for a given toast, determined by the
component's actual current `data-*` attribute combination — but the **cascade/specificity/order
mechanics must still be preserved verbatim** because the CSS engine, not application logic, is
what resolves which declaration wins.

### 4.6 Expanded/collapsed stack layout — front/behind formulas (lines 279–297, 311–323)

**Collapsed (behind-front) stack — scale/translate formula, VERBATIM:**

```css
[data-sonner-toast][data-expanded='false'][data-front='false'] {
  --scale: var(--toasts-before) * 0.05 + 1;
  --y: translateY(calc(var(--lift-amount) * var(--toasts-before))) scale(calc(-1 * var(--scale)));
  height: var(--front-toast-height);
}
```

Reading the formula: each toast `n` positions behind the front (visible) toast (`--toasts-before`
= that toast's index, i.e. how many toasts are stacked in front of it counting from the newest) is
translated vertically by `--lift-amount * --toasts-before` px (stacking downward/upward per
`--lift` sign, §4.4) and shrunk by a **small positive** scale factor.

> **CORRECTED BY AUDIT — the previous reading of this formula was wrong.** `--scale` is a *raw
> token stream*, not a resolved number, so `calc(-1 * var(--scale))` textually expands to
> `calc(-1 * var(--toasts-before) * 0.05 + 1)`. The `-1 *` binds only to the **first term**, and
> the `+ 1` is added afterwards. The result is `1 - 0.05 × toasts-before`:
> `toasts-before = 1 → scale(0.95)`, `2 → scale(0.9)`, `3 → scale(0.85)`. It is a **positive,
> slightly-shrunk** scale — there is **no negative scale and no 180° mirror/flip anywhere in this
> stylesheet.** (The `data-front='true'` toast never matches this rule, so `toasts-before = 0`
> → `scale(1)` is not reachable here.) This is exactly why the `--scale` declaration must stay
> **outside** a `calc()` (§2): wrapping it as `--scale: calc(var(--toasts-before) * 0.05 + 1)`
> would make `calc(-1 * var(--scale))` evaluate to a genuinely negative `-1.05`, mirroring every
> stacked toast. Copy the line verbatim.

`height: var(--front-toast-height)` — while collapsed, every toast in the pile reports the height
of the *front* (topmost/most recent) toast, not its own natural height, so the stack visually
reads as uniform-height cards peeking out from behind one another.

```css
[data-sonner-toast][data-expanded='false'][data-front='false'][data-styled='true'] > * {
  opacity: 0;
}
```

While collapsed, a non-front toast's *content* (all direct children — icon, content wrapper,
buttons, close button) is hidden (`opacity: 0`), but the card chrome (background/border/shadow)
remains visible, since only children are targeted, not the toast itself. Gated behind
`data-styled='true'` — the unstyled escape hatch also escapes this content-hiding behavior.

**Expanded layout:**

```css
[data-sonner-toast][data-mounted='true'][data-expanded='true'] {
  --y: translateY(calc(var(--lift) * var(--offset)));
  height: var(--initial-height);
}
```

When expanded (stack fanned out, e.g. on hover), each toast is translated by `--lift * --offset`
px, where `--offset` is a **cumulative pixel offset** computed and set by JS per-toast (sum of
prior toasts' heights + gaps — computed outside this slice, in the Toast component's `offset`
ref), and reverts to its own natural (`--initial-height`) height instead of the front toast's
height.

**Expanded hover-gap filler:**

```css
[data-sonner-toast][data-expanded='true']::after {
  content: '';
  position: absolute;
  left: 0;
  height: calc(var(--gap) + 1px);
  bottom: 100%;
  width: 100%;
}
```

An invisible `::after` pseudo-element spans the `var(--gap) + 1px` space directly above each
expanded toast (positioned via `bottom: 100%`), full width. Purpose: without this, moving the
mouse from one expanded toast to the next across the small gap between them would leave the
toaster's hover area momentarily, causing `onMouseLeave`/collapse-on-leave logic (in the Toaster
component, outside this slice) to fire prematurely and re-collapse the stack. This filler keeps
the pointer "inside" the interactive region while crossing the gap.

### 4.7 Mounted/entry animation (lines 288–291, 299–301)

```css
[data-sonner-toast][data-mounted='true'] {
  --y: translateY(0);
  opacity: 1;
}

[data-sonner-toast] > * {
  transition: opacity 400ms;
}
```

Entry is **not** a `@keyframes` animation — it is a plain CSS transition: the toast starts (base
rule, §4.3) at `--y: translateY(100%)` (or `-100%` for top position) with `opacity: 0`; once JS
flips `data-mounted` to `'true'` (on the next animation frame after DOM insertion — timing detail
lives in the Toast component slice, not here), `--y` becomes `translateY(0)` and `opacity`
becomes `1`, and the toast root's own `transition: transform 400ms, opacity 400ms, height 400ms,
box-shadow 200ms` (§4.3) animates the change. `[data-sonner-toast] > *` additionally gives every
**direct child** of the toast its own independent `opacity 400ms` transition (relevant chiefly for
the collapsed→front content fade, §4.6, and for the swipe/removed content-fade interplay).

### 4.8 Removed / exit transforms (lines 325–343)

```css
[data-sonner-toast][data-removed='true'][data-front='true'][data-swipe-out='false'] {
  --y: translateY(calc(var(--lift) * -100%));
  opacity: 0;
}

[data-sonner-toast][data-removed='true'][data-front='false'][data-swipe-out='false'][data-expanded='true'] {
  --y: translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%));
  opacity: 0;
}

[data-sonner-toast][data-removed='true'][data-front='false'][data-swipe-out='false'][data-expanded='false'] {
  --y: translateY(40%);
  opacity: 0;
  transition: transform 500ms, opacity 200ms;
}

[data-sonner-toast][data-removed='true'][data-front='false']::before {
  height: calc(var(--initial-height) + 20%);
}
```

Three exit paths, selected by whether the removed toast is the front toast, and (if not) whether
the stack is currently expanded:

- **Front toast removed** (not swiped): translates fully off in the `--lift` direction
  (`--lift * -100%` — i.e. up and off for a top-anchored/`--lift:1` stack's sign convention, or
  the mirrored direction for bottom-anchored) while fading to `opacity: 0`. Uses the default
  400ms transition from the base rule (not overridden here).
- **Non-front toast removed while expanded**: combines its expanded offset (`--lift * --offset`)
  with the same `-100%` exit kick (`--lift * --offset + --lift * -100%`), i.e. it continues from
  wherever it currently sits in the expanded fan-out and flies off from there.
- **Non-front toast removed while collapsed**: simpler `translateY(40%)` nudge-down-and-fade,
  explicitly overriding the transition to `transform 500ms, opacity 200ms` (slower/differently
  timed than the default 400/400/400/200 base transition) — this is the only place in the file
  besides the swipe-out keyframes' `animation-duration: 200ms` where a transition duration differs
  from the toast root's base 400ms.
- The `::before` pseudo-element height bump (`var(--initial-height) + 20%`) on any non-front
  removed toast enlarges its invisible backing rectangle (used for the swipe-away
  hit-region/overscroll-mask, see §4.9) slightly beyond its own height while it's animating out,
  to avoid a visual gap/flash during the collapse re-flow of toasts below it.

### 4.9 Swipe interaction styles (lines 253–277, 345–424)

**Swiping overlay (`::before`) — created only while actively swiping or right after removal:**

```css
[data-sonner-toast][data-swiping='true']::before {
  content: '';
  position: absolute;
  left: -100%;
  right: -100%;
  height: 100%;
  z-index: -1;
}

[data-sonner-toast][data-y-position='top'][data-swiping='true']::before {
  bottom: 50%;
  transform: scaleY(3) translateY(50%);
}

[data-sonner-toast][data-y-position='bottom'][data-swiping='true']::before {
  top: 50%;
  transform: scaleY(3) translateY(-50%);
}

[data-sonner-toast][data-swiping='false'][data-removed='true']::before {
  content: '';
  position: absolute;
  inset: 0;
  transform: scaleY(2);
}
```

An invisible (`z-index: -1`, no background painted here) `::before` widens the toast's effective
hit-region horizontally to `-100%`..`+100%` of its own width (i.e. triples total width, centered)
while swiping, and vertically extends via `scaleY(3)` anchored at the appropriate edge depending
on `data-y-position`, so that fast/large swipes don't "lose" pointer capture as the card visually
moves out from under a stationary cursor position. When a toast is removed without having been
swiped (`data-swiping='false'][data-removed='true']`), a simpler `inset: 0; transform: scaleY(2)`
variant applies instead.

**Live-drag transform (finger/mouse actively down):**

```css
[data-sonner-toast][data-swiping='true'] {
  transform: var(--y) translateY(var(--swipe-amount-y, 0px)) translateX(var(--swipe-amount-x, 0px));
  transition: none;
}
```

This is the **one place in the file** where `transform:` is written as more than bare
`var(--y)` — it layers the live pointer-drag delta (`--swipe-amount-x`/`--swipe-amount-y`, both
JS-set inline px values updated every `pointermove`, see §5) on top of whatever `--y` currently
resolves to, and disables the transition entirely (`transition: none`) so the drag tracks the
pointer 1:1 with zero lag/easing. Default fallback of `0px` if the custom property is unset
(defensive; JS always sets it before/while `data-swiping='true'` is applied, but the fallback
guards against a flash-of-unset-value on the very first paint).

```css
[data-sonner-toast][data-swiped='true'] {
  -webkit-user-select: none; /* Safari 3+ */
  user-select: none;
}
```

Prevents text selection inside the toast while a swipe gesture has been registered (distinct from
`data-swiping`, which is the live in-progress drag flag — `data-swiped` marks that a swipe
occurred/is occurring at all, used to suppress accidental text selection during the gesture). The
`/* Safari 3+ */` comment is part of the verbatim source — copy it too.

**Swipe-out release animation — selection of keyframe by direction:**

```css
[data-sonner-toast][data-swipe-out='true'][data-y-position='bottom'],
[data-sonner-toast][data-swipe-out='true'][data-y-position='top'] {
  animation-duration: 200ms;
  animation-timing-function: ease-out;
  animation-fill-mode: forwards;
}

[data-sonner-toast][data-swipe-out='true'][data-swipe-direction='left'] {
  animation-name: swipe-out-left;
}

[data-sonner-toast][data-swipe-out='true'][data-swipe-direction='right'] {
  animation-name: swipe-out-right;
}

[data-sonner-toast][data-swipe-out='true'][data-swipe-direction='up'] {
  animation-name: swipe-out-up;
}

[data-sonner-toast][data-swipe-out='true'][data-swipe-direction='down'] {
  animation-name: swipe-out-down;
}
```

`animation-duration`/`-timing-function`/`-fill-mode` are declared once (shared by both y-positions
since the rule requires `data-y-position` to be present but doesn't otherwise vary duration/timing
by it), then `animation-name` is selected per `data-swipe-direction` value (`left`/`right`/`up`/
`down`, four distinct keyframe names below). All four use `200ms ease-out forwards`.

**Keyframes — VERBATIM, all four, full frames:**

```css
@keyframes swipe-out-left {
  from {
    transform: var(--y) translateX(var(--swipe-amount-x));
    opacity: 1;
  }

  to {
    transform: var(--y) translateX(calc(var(--swipe-amount-x) - 100%));
    opacity: 0;
  }
}

@keyframes swipe-out-right {
  from {
    transform: var(--y) translateX(var(--swipe-amount-x));
    opacity: 1;
  }

  to {
    transform: var(--y) translateX(calc(var(--swipe-amount-x) + 100%));
    opacity: 0;
  }
}

@keyframes swipe-out-up {
  from {
    transform: var(--y) translateY(var(--swipe-amount-y));
    opacity: 1;
  }

  to {
    transform: var(--y) translateY(calc(var(--swipe-amount-y) - 100%));
    opacity: 0;
  }
}

@keyframes swipe-out-down {
  from {
    transform: var(--y) translateY(var(--swipe-amount-y));
    opacity: 1;
  }

  to {
    transform: var(--y) translateY(calc(var(--swipe-amount-y) + 100%));
    opacity: 0;
  }
}
```

Each keyframe starts exactly where the live drag left off (`var(--swipe-amount-x/y)`, the last
value JS wrote before triggering the release) and finishes translated by a further full `100%` of
the toast's own box in the release direction (`-100%` for left/up, `+100%` for right/down),
fading to `opacity: 0` simultaneously. Note the `from`/`to` frames read the **raw**
`var(--swipe-amount-x)`/`var(--swipe-amount-y)` custom properties directly (no fallback default
here, unlike the live-drag `transform:` rule above which used `var(--swipe-amount-y, 0px)`) —
copy this discrepancy verbatim; it's safe here because `data-swipe-out='true'` is only ever
applied after a swipe has actually set those properties to real px values.

### 4.10 Mobile media query — `max-width: 600px` (lines 426–461)

```css
@media (max-width: 600px) {
  [data-sonner-toaster] {
    position: fixed;
    right: var(--mobile-offset-right);
    left: var(--mobile-offset-left);
    width: 100%;
  }

  [data-sonner-toaster][dir='rtl'] {
    left: calc(var(--mobile-offset-left) * -1);
  }

  [data-sonner-toaster] [data-sonner-toast] {
    left: 0;
    right: 0;
    width: calc(100% - var(--mobile-offset-left) * 2);
  }

  [data-sonner-toaster][data-x-position='left'] {
    left: var(--mobile-offset-left);
  }

  [data-sonner-toaster][data-y-position='bottom'] {
    bottom: var(--mobile-offset-bottom);
  }

  [data-sonner-toaster][data-y-position='top'] {
    top: var(--mobile-offset-top);
  }

  [data-sonner-toaster][data-x-position='center'] {
    left: var(--mobile-offset-left);
    right: var(--mobile-offset-right);
    transform: none;
  }
}
```

Below 600px viewport width: the toaster becomes full-width (`width: 100%`, pinned `left`/`right`
to the mobile offset vars, all four x/y-position variants collapse to using the `--mobile-offset-*`
custom properties instead of `--offset-*`), and center positioning drops its `translateX(-50%)`
transform (since it's now edge-to-edge anyway). Individual toasts inside also go full-bleed
(`left: 0; right: 0; width: calc(100% - var(--mobile-offset-left) * 2)`).

The `[dir='rtl']` override inside this media query (`left: calc(var(--mobile-offset-left) * -1)`)
applies **after** the base `[data-sonner-toaster]` mobile rule in source order and has equal
specificity margin (one extra attribute selector, `[dir='rtl']`, so it actually wins on
specificity too) — it negates the left offset for RTL, layered on top of (not replacing) the
`right`/`width: 100%` set just above. This is the **only** RTL-specific rule outside §4.1.

Note: this block sets `--mobile-offset-*`-driven layout only for the toaster/toast positioning —
it does **not** redeclare `--width`, fonts, colors, or any of the theme variables; all of those
stay exactly as set outside the media query.

### 4.11 Light/dark theme variable blocks + invert (lines 463–530)

```css
[data-sonner-toaster][data-sonner-theme='light'] {
  --normal-bg: #fff;
  --normal-border: var(--gray4);
  --normal-text: var(--gray12);

  --success-bg: hsl(143, 85%, 96%);
  --success-border: hsl(145, 92%, 87%);
  --success-text: hsl(140, 100%, 27%);

  --info-bg: hsl(208, 100%, 97%);
  --info-border: hsl(221, 91%, 93%);
  --info-text: hsl(210, 92%, 45%);

  --warning-bg: hsl(49, 100%, 97%);
  --warning-border: hsl(49, 91%, 84%);
  --warning-text: hsl(31, 92%, 45%);

  --error-bg: hsl(359, 100%, 97%);
  --error-border: hsl(359, 100%, 94%);
  --error-text: hsl(360, 100%, 45%);
}

[data-sonner-toaster][data-sonner-theme='light'] [data-sonner-toast][data-invert='true'] {
  --normal-bg: #000;
  --normal-border: hsl(0, 0%, 20%);
  --normal-text: var(--gray1);
}

[data-sonner-toaster][data-sonner-theme='dark'] [data-sonner-toast][data-invert='true'] {
  --normal-bg: #fff;
  --normal-border: var(--gray3);
  --normal-text: var(--gray12);
}

[data-sonner-toaster][data-sonner-theme='dark'] {
  --normal-bg: #000;
  --normal-bg-hover: hsl(0, 0%, 12%);
  --normal-border: hsl(0, 0%, 20%);
  --normal-border-hover: hsl(0, 0%, 25%);
  --normal-text: var(--gray1);

  --success-bg: hsl(150, 100%, 6%);
  --success-border: hsl(147, 100%, 12%);
  --success-text: hsl(150, 86%, 65%);

  --info-bg: hsl(215, 100%, 6%);
  --info-border: hsl(223, 43%, 17%);
  --info-text: hsl(216, 87%, 65%);

  --warning-bg: hsl(64, 100%, 6%);
  --warning-border: hsl(60, 100%, 9%);
  --warning-text: hsl(46, 87%, 65%);

  --error-bg: hsl(358, 76%, 10%);
  --error-border: hsl(357, 89%, 16%);
  --error-text: hsl(358, 100%, 81%);
}

[data-sonner-toaster][data-sonner-theme='dark'] [data-sonner-toast] [data-close-button] {
  background: var(--normal-bg);
  border-color: var(--normal-border);
  color: var(--normal-text);
}

[data-sonner-toaster][data-sonner-theme='dark'] [data-sonner-toast] [data-close-button]:hover {
  background: var(--normal-bg-hover);
  border-color: var(--normal-border-hover);
}
```

Notes:
- `data-sonner-theme` takes exactly two values consumed by this file: `'light'` and `'dark'`
  (whatever "system" resolution logic produces one of these two strings before it reaches the
  DOM — that resolution logic is in the Toaster component, outside this slice).
- `--normal-bg-hover` / `--normal-border-hover` are declared **only** inside the dark theme block
  — there is no light-theme equivalent custom property (the light-theme close-button hover, §4.12,
  instead uses the static `--gray2`/`--gray5` tokens directly, not a `-hover` custom property
  pair).
- `data-invert='true'` on an individual toast (JS-controlled per-toast override, independent of
  the toaster's overall theme) swaps that one toast to the *opposite* palette's `--normal-*`
  triplet — light theme + inverted toast → black bg/near-white text; dark theme + inverted toast →
  white bg/near-black text. This only overrides `--normal-*`, never the rich-color
  success/info/warning/error triplets.

### 4.12 Close button styles & hover (lines 219–251, plus dark-theme hover above)

```css
[data-sonner-toast][data-styled='true'] [data-close-button] {
  position: absolute;
  left: var(--toast-close-button-start);
  right: var(--toast-close-button-end);
  top: 0;
  height: 20px;
  width: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0;
  color: var(--normal-text);
  background: var(--normal-bg);
  border: 1px solid var(--normal-border);
  transform: var(--toast-close-button-transform);
  border-radius: 50%;
  cursor: pointer;
  z-index: 1;
  transition: opacity 100ms, background 200ms, border-color 200ms;
}

[data-sonner-toast][data-styled='true'] [data-close-button]:focus-visible {
  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 2px rgba(0, 0, 0, 0.2);
}

[data-sonner-toast][data-styled='true'] [data-disabled='true'] {
  cursor: not-allowed;
}

[data-sonner-toast][data-styled='true']:hover [data-close-button]:hover {
  background: var(--gray2);
  border-color: var(--gray5);
}
```

- 20×20px circular button (`border-radius: 50%`), positioned via the RTL-aware
  `--toast-close-button-start/-end/-transform` triplet from §4.1 (so it sits at the correct
  top-leading corner and is nudged 35% outward on both axes via `translate(±35%, -35%)` to
  overlap the toast's own top corner rather than sit fully inset).
- `transition: opacity 100ms, background 200ms, border-color 200ms` — note `opacity` here
  transitions in **100ms**, distinct from the toast root's 400ms and the buttons' (§below) 400ms —
  copy this exact number, don't harmonize it with the other opacity transitions in the file.
- Light-theme hover selector is written as a **doubled hover chain**,
  `[data-sonner-toast][data-styled='true']:hover [data-close-button]:hover` — i.e. it requires
  both the ancestor toast *and* the close button itself to match `:hover` simultaneously. In
  practice, hovering the close button (a descendant) always also satisfies `:hover` on its
  ancestor toast (CSS `:hover` bubbles to ancestors whose box contains the pointer), so this is
  operationally equivalent to just `[data-close-button]:hover` scoped under a styled toast — but
  copy the doubled-hover selector verbatim, do not simplify it to a single `:hover`.
- Dark-theme close-button hover (declared separately in §4.11, not here) uses
  `--normal-bg-hover`/`--normal-border-hover` instead of the light theme's static `--gray2`/
  `--gray5`, and is **not** written as a doubled-hover chain (`[data-sonner-toast] [data-close-button]:hover`,
  single hover only) — this asymmetry between the light and dark hover selectors is intentional
  source behavior, copy both forms exactly as given.

### 4.13 Rich colors blocks — all four type variants, verbatim (lines 532–578)

```css
[data-rich-colors='true'][data-sonner-toast][data-type='success'] {
  background: var(--success-bg);
  border-color: var(--success-border);
  color: var(--success-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='success'] [data-close-button] {
  background: var(--success-bg);
  border-color: var(--success-border);
  color: var(--success-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='info'] {
  background: var(--info-bg);
  border-color: var(--info-border);
  color: var(--info-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='info'] [data-close-button] {
  background: var(--info-bg);
  border-color: var(--info-border);
  color: var(--info-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='warning'] {
  background: var(--warning-bg);
  border-color: var(--warning-border);
  color: var(--warning-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='warning'] [data-close-button] {
  background: var(--warning-bg);
  border-color: var(--warning-border);
  color: var(--warning-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='error'] {
  background: var(--error-bg);
  border-color: var(--error-border);
  color: var(--error-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='error'] [data-close-button] {
  background: var(--error-bg);
  border-color: var(--error-border);
  color: var(--error-text);
}
```

Four types (`success`/`info`/`warning`/`error`) × two rules each (the toast body itself, and its
close button re-themed to match) = 8 rules, gated behind `[data-rich-colors='true']` on the toast
element (JS-set from `toast.richColors ?? defaultRichColors`, outside this slice). Consumes the
`--{type}-bg/-border/-text` triplets declared per-theme in §4.11 — there is no separate light/dark
duplication *here*; the same 8 rules apply in both themes because they reference the custom
properties, which are what differ by theme.

Also relevant, declared earlier in the file (§4.3 already quoted these individually, repeated here
for completeness of the "rich colors" concern since they interact with description text color):

```css
[data-sonner-toast][data-styled='true'] [data-description] {
  font-weight: 400;
  line-height: 1.4;
  color: #3f3f3f;
}

[data-rich-colors='true'][data-sonner-toast][data-styled='true'] [data-description] {
  color: inherit;
}

[data-sonner-toaster][data-sonner-theme='dark'] [data-description] {
  color: hsl(0, 0%, 91%);
}
```

Description text is `#3f3f3f` by default (light, non-rich-colors), `hsl(0, 0%, 91%)` in dark theme
(non-rich-colors), and `inherit`s the toast's own (rich-color-tinted) text color when
`data-rich-colors='true'`, overriding both of the above via matching the same specificity but
appearing later / matching more attributes depending on combination — copy source order exactly.

### 4.14 Default light/dark theme variable blocks

Already fully quoted in §4.11 (both blocks live together in source, lines 463–519) — see there.
`--normal-bg`, `--normal-border`, `--normal-text` are the three tokens consumed by the base
(non-rich-colors) toast skin (§4.3's `[data-sonner-toast][data-styled='true']` background/
border/color) and by the button/cancel/close-button rules (§4.15, §4.12).

### 4.15 Action/cancel button styles (lines 181–217)

```css
[data-sonner-toast][data-styled='true'] [data-button] {
  border-radius: 4px;
  padding-left: 8px;
  padding-right: 8px;
  height: 24px;
  font-size: 12px;
  color: var(--normal-bg);
  background: var(--normal-text);
  margin-left: var(--toast-button-margin-start);
  margin-right: var(--toast-button-margin-end);
  border: none;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition: opacity 400ms, box-shadow 200ms;
}

[data-sonner-toast][data-styled='true'] [data-button]:focus-visible {
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.4);
}

[data-sonner-toast][data-styled='true'] [data-button]:first-of-type {
  margin-left: var(--toast-button-margin-start);
  margin-right: var(--toast-button-margin-end);
}

[data-sonner-toast][data-styled='true'] [data-cancel] {
  color: var(--normal-text);
  background: rgba(0, 0, 0, 0.08);
}

[data-sonner-toaster][data-sonner-theme='dark'] [data-sonner-toast][data-styled='true'] [data-cancel] {
  background: rgba(255, 255, 255, 0.3);
}
```

`[data-button]` is the shared base for **both** the action button and the cancel button (both
elements carry `data-button` as a generic marker in the DOM structure built by the Toast
component, outside this slice); it inverts the normal toast colors (background =
`--normal-text`, text color = `--normal-bg`) to read as a solid pill button. `[data-cancel]` is
an *additional* attribute layered on the cancel button specifically (so cancel buttons match both
`[data-button]` and `[data-cancel]` selectors), overriding to a translucent black (light theme,
`rgba(0,0,0,0.08)`) or translucent white (dark theme override, `rgba(255,255,255,0.3)`) background
while keeping `color: var(--normal-text)` (not inverted, unlike the plain action button).
`:focus-visible` ring here uses `rgba(0, 0, 0, 0.4)` — a different alpha/color than the toast-root
and close-button focus rings (`rgba(0, 0, 0, 0.2)`), copy exactly, don't harmonize.
`:first-of-type` redundantly re-declares the same margin-start/-end custom properties already set
on the base `[data-button]` rule (a no-op given equal specificity/later declaration order, but
copy it verbatim — it exists in source, likely defensive/for override purposes by more specific
future rules).

### 4.16 Loader/spinner styles (lines 580–671, 713–725) — full 12-bar spinner

```css
.sonner-loading-wrapper {
  --size: 16px;
  height: var(--size);
  width: var(--size);
  position: absolute;
  inset: 0;
  z-index: 10;
}

.sonner-loading-wrapper[data-visible='false'] {
  transform-origin: center;
  animation: sonner-fade-out 0.2s ease forwards;
}

.sonner-spinner {
  position: relative;
  top: 50%;
  left: 50%;
  height: var(--size);
  width: var(--size);
}

.sonner-loading-bar {
  animation: sonner-spin 1.2s linear infinite;
  background: var(--gray11);
  border-radius: 6px;
  height: 8%;
  left: -10%;
  position: absolute;
  top: -3.9%;
  width: 24%;
}
```

These four selectors are **plain CSS classes**, not `data-sonner-*` attribute selectors, and are
**not** gated behind `[data-styled='true']` — the loader/spinner renders identically regardless
of the toast's own styled/unstyled state. `--size: 16px` is a locally-scoped custom property
(declared and consumed entirely within `.sonner-loading-wrapper`/`.sonner-spinner`, unrelated to
any toaster/toast-level custom property of a similar name).

**12 bars, each with a fixed `nth-child` rotation + negative animation-delay, VERBATIM (all 12,
do not abbreviate/loop this in source — it is 12 separate literal rules in the original and must
stay that way in the copy):**

```css
.sonner-loading-bar:nth-child(1) {
  animation-delay: -1.2s;
  transform: rotate(0.0001deg) translate(146%);
}

.sonner-loading-bar:nth-child(2) {
  animation-delay: -1.1s;
  transform: rotate(30deg) translate(146%);
}

.sonner-loading-bar:nth-child(3) {
  animation-delay: -1s;
  transform: rotate(60deg) translate(146%);
}

.sonner-loading-bar:nth-child(4) {
  animation-delay: -0.9s;
  transform: rotate(90deg) translate(146%);
}

.sonner-loading-bar:nth-child(5) {
  animation-delay: -0.8s;
  transform: rotate(120deg) translate(146%);
}

.sonner-loading-bar:nth-child(6) {
  animation-delay: -0.7s;
  transform: rotate(150deg) translate(146%);
}

.sonner-loading-bar:nth-child(7) {
  animation-delay: -0.6s;
  transform: rotate(180deg) translate(146%);
}

.sonner-loading-bar:nth-child(8) {
  animation-delay: -0.5s;
  transform: rotate(210deg) translate(146%);
}

.sonner-loading-bar:nth-child(9) {
  animation-delay: -0.4s;
  transform: rotate(240deg) translate(146%);
}

.sonner-loading-bar:nth-child(10) {
  animation-delay: -0.3s;
  transform: rotate(270deg) translate(146%);
}

.sonner-loading-bar:nth-child(11) {
  animation-delay: -0.2s;
  transform: rotate(300deg) translate(146%);
}

.sonner-loading-bar:nth-child(12) {
  animation-delay: -0.1s;
  transform: rotate(330deg) translate(146%);
}
```

Pattern (for the implementer's understanding, not a license to regenerate/shortcut it — copy the
12 literal rules): bar `n` (1-indexed) rotates by `(n-1) * 30deg` (**except bar 1, which uses
`0.0001deg`, not a literal `0deg`** — this is very likely a deliberate hack to force the browser
onto the GPU-accelerated compositing path for the transform / avoid a transform-recalc edge case
at exactly 0deg; copy `0.0001deg` exactly, do not "clean it up" to `0deg`), each translated
`146%` outward from center, and each bar's `animation-delay` is `-(1.3 - n*0.1)s` — i.e.
`-1.2s, -1.1s, -1s, -0.9s, ... -0.1s` for bars 1–12 — a **negative** delay, which in CSS means the
animation starts already partway through its cycle, which is exactly how the 12 bars appear
perpetually staggered around the circle rather than all flashing in sync. (Bar 3's delay is written
as `-1s`, not `-1.0s` — copy the exact token, no trailing zero.)

```css
.sonner-loader {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  transform-origin: center;
  transition: opacity 200ms, transform 200ms;
}

.sonner-loader[data-visible='false'] {
  opacity: 0;
  transform: scale(0.8) translate(-50%, -50%);
}
```

`.sonner-loader` (distinct class from `.sonner-loading-wrapper`/`.sonner-spinner`/
`.sonner-loading-bar` above — this is a fourth, separate loader-related class, used to
wrap/position the *custom* loading icon slot, per the assets/Toast component wiring outside this
slice) is centered via `translate(-50%, -50%)` and transitions `opacity`/`transform` over `200ms`
each (default `ease`, unspecified). When `data-visible='false'`, it fades and shrinks to `scale(0.8)`
while **still keeping** the `translate(-50%, -50%)` centering term composed into the same
`transform:` declaration (`scale(0.8) translate(-50%, -50%)`, not just `scale(0.8)` alone — order
matters: scale is applied before/outer to translate in this composed transform string exactly as
written).

### 4.17 Keyframes (lines 673–702)

```css
@keyframes sonner-fade-in {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes sonner-fade-out {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(0.8);
  }
}

@keyframes sonner-spin {
  0% {
    opacity: 1;
  }
  100% {
    opacity: 0.15;
  }
}
```

- `sonner-fade-in`: used at line 163 (§4.18 below) for a promise-toast's icon SVG entrance
  (`animation: sonner-fade-in 300ms ease forwards;`) and is the icon-level entrance, separate from
  the toast-level mount transition (§4.7).
- `sonner-fade-out`: used by `.sonner-loading-wrapper[data-visible='false']` (§4.16,
  `animation: sonner-fade-out 0.2s ease forwards;` — note this one is written as `0.2s`, not
  `200ms`, an inconsistent-but-verbatim unit choice versus other 200ms values elsewhere in the
  file — copy the unit exactly as given, do not normalize to `200ms`).
- `sonner-spin`: the 12-bar spinner's per-bar opacity pulse, `1.2s linear infinite`, oscillating
  each bar between `opacity: 1` and `opacity: 0.15` (not `0` — bars never fully disappear, they
  dim to 15% opacity at the trough) — combined with the 12 different negative `animation-delay`s
  (§4.16) this produces the classic "chasing" spinner illusion.

### 4.18 Icon styles (lines 147–173)

```css
[data-sonner-toast][data-styled='true'] [data-icon] {
  display: flex;
  height: 16px;
  width: 16px;
  position: relative;
  justify-content: flex-start;
  align-items: center;
  flex-shrink: 0;
  margin-left: var(--toast-icon-margin-start);
  margin-right: var(--toast-icon-margin-end);
}

[data-sonner-toast][data-promise='true'] [data-icon] > svg {
  opacity: 0;
  transform: scale(0.8);
  transform-origin: center;
  animation: sonner-fade-in 300ms ease forwards;
}

[data-sonner-toast][data-styled='true'] [data-icon] > * {
  flex-shrink: 0;
}

[data-sonner-toast][data-styled='true'] [data-icon] svg {
  margin-left: var(--toast-svg-margin-start);
  margin-right: var(--toast-svg-margin-end);
}
```

Note the promise-icon fade-in rule (`[data-promise='true'] [data-icon] > svg`) is **not** gated
behind `[data-styled='true']` (unlike its three siblings above/below it) — it applies even on
unstyled toasts, since it targets the icon's inner `<svg>` directly by tag rather than a
`data-*`-scoped wrapper.

### 4.19 Content wrapper / title / description structural styles (lines 127–145, 175–179)

```css
[data-sonner-toast][data-styled='true'] [data-title] {
  font-weight: 500;
  line-height: 1.5;
  color: inherit;
}

[data-sonner-toast][data-styled='true'] [data-content] {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
```

(Description rules already quoted in §4.13, since they interact with rich-colors.) `[data-content]`
is the flex column wrapper around title+description; `gap: 2px` is the vertical spacing between
them.

### 4.20 `data-visible='false'` (toast-level) — hide without unmount (line 315–318)

```css
[data-sonner-toast][data-visible='false'] {
  opacity: 0;
  pointer-events: none;
}
```

Distinct from `data-removed`/exit-animation states — this is for toasts beyond
`visibleToasts`/`VISIBLE_TOASTS_AMOUNT` cap that are still mounted in the DOM (for stacking-order
bookkeeping) but should render invisible and non-interactive rather than participate in any exit
transition.

### 4.21 `x-position` per-toast left/right pin (lines 303–309)

```css
[data-sonner-toast][data-x-position='right'] {
  right: 0;
}

[data-sonner-toast][data-x-position='left'] {
  left: 0;
}
```

Each individual `<li>` toast pins itself to its container's edge (the toaster `<ol>` already
positioned per §4.2.2); center-positioned toasters don't need a per-toast x-position rule since
the toast, being `width: var(--width)` and the toaster itself is what's centered.

### 4.22 `prefers-reduced-motion` (lines 704–711)

```css
@media (prefers-reduced-motion) {
  [data-sonner-toast],
  [data-sonner-toast] > *,
  .sonner-loading-bar {
    transition: none !important;
    animation: none !important;
  }
}
```

Note the media feature is written as the **bare boolean** `(prefers-reduced-motion)`, equivalent
to `(prefers-reduced-motion: reduce)` per the media-query spec (a boolean context on an enumerated
feature matches any non-`no-preference`/non-initial value — in practice this matches `reduce`).
Copy the bare form exactly, do not "correct" it to `(prefers-reduced-motion: reduce)` — while
functionally near-identical in current browsers, it is not what source says and this is a verbatim
port. Only three selectors are covered: the toast root, its direct children, and the loading bars
— note `.sonner-loading-wrapper`/`.sonner-spinner`/`.sonner-loader` (the other three
loader-related classes) are **not** listed here, meaning their animations/transitions are **not**
suppressed under reduced motion (this looks like it could be an oversight in upstream sonner, but
per the verbatim-port mandate this is not ours to fix — copy exactly as-is; if it needs fixing,
that's an upstream sonner issue, out of scope for this port).

### 4.23 Unstyled escape hatches — summary (cross-reference)

There is no single dedicated "unstyled" block; the escape hatch is structural, achieved by every
cosmetic rule in the file being scoped under a `[data-styled='true']` ancestor/self attribute
selector (see §4.3, §4.6, §4.12, §4.13's description color rules, §4.15, §4.18, §4.19). When
`data-styled` is `'false'`:
- Still applied (unscoped): base `[data-sonner-toast]` positioning/transform/opacity/transition
  (§4.3 first block), y-position lift vars (§4.4), the full `--y` cascade (§4.5/§4.6/§4.7/§4.8),
  swipe styles (§4.9 — none of which are `[data-styled='true']`-gated), mobile media query
  (§4.10 — toaster/toast-level, not content-level), `data-visible='false'` hide rule (§4.20),
  x-position pin (§4.21), reduced-motion kill-switch (§4.22), rich-colors toast-body/close-button
  background (§4.13's `[data-rich-colors='true']...[data-type=...]` rules — **not**
  `[data-styled='true']`-gated, meaning rich colors backgrounds **do** still apply even on an
  otherwise-unstyled toast, only the *description* rich-color rule is styled-gated), loader/spinner
  classes (§4.16 — plain classes, not styled-gated).
- Suppressed: padding/background/border/box-shadow/width/font-size/flex layout on the card itself,
  title/description/icon/content/button/cancel/close-button cosmetic rules.

### 4.24 Focus-visible styles — summary (cross-reference)

Three `:focus-visible` rules total in the file, already quoted in place above:
1. `[data-sonner-toast]:focus-visible` (§4.3) — `0px 4px 12px rgba(0,0,0,0.1), 0 0 0 2px rgba(0,0,0,0.2)`.
2. `[data-sonner-toast][data-styled='true'] [data-button]:focus-visible` (§4.15) —
   `0 0 0 2px rgba(0,0,0,0.4)` only (no drop-shadow layered under it, unlike the other two).
3. `[data-sonner-toast][data-styled='true'] [data-close-button]:focus-visible` (§4.12) — identical
   two-layer shadow to rule 1, `0px 4px 12px rgba(0,0,0,0.1), 0 0 0 2px rgba(0,0,0,0.2)`.

No theme-specific (`data-sonner-theme`) variation on any focus-visible ring — all three are theme-
invariant hardcoded `rgba(0,0,0,...)` values, even in dark theme.

---

## 5. JS ↔ CSS custom-property interface table

Every custom property referenced anywhere in `styles.css` (via `var(--x)` or as a `--x:` LHS),
with who sets it and who consumes it. "Stylesheet" in the "set by" column means the value
originates purely from another CSS rule in this same file (no JS involvement). "JS inline" means
set via an element's inline `style` attribute/`style.setProperty` call from framework code outside
this slice (React `index.tsx`, to be mirrored by the Vue `Toaster.vue`/`Toast.vue` components).

| Custom property | Set by | Where (React source, outside this slice) | Consumed by (in this file) |
|---|---|---|---|
| `--toast-icon-margin-start` / `-end` | Stylesheet | RTL block, §4.1 | `[data-icon]` margin-left/right (§4.18) |
| `--toast-svg-margin-start` / `-end` | Stylesheet | RTL block, §4.1 | `[data-icon] svg` margin-left/right (§4.18) |
| `--toast-button-margin-start` / `-end` | Stylesheet | RTL block, §4.1 | `[data-button]` margin-left/right, `:first-of-type` (§4.15) |
| `--toast-close-button-start` / `-end` | Stylesheet | RTL block, §4.1 | `[data-close-button]` left/right (§4.12) |
| `--toast-close-button-transform` | Stylesheet | RTL block, §4.1 | `[data-close-button]` transform (§4.12) |
| `--gray1`…`--gray12` | Stylesheet | Toaster root block, §4.2 | `--normal-*`/`--normal-border` refs (light/dark theme, §4.11), close-button hover (§4.12), `.sonner-loading-bar` background (`--gray11`, §4.16) |
| `--border-radius` | Stylesheet | Toaster root block, §4.2 | Toast card `border-radius` (§4.3) |
| `--width` | **JS inline** | `Toaster` `<ol>` style, `index.tsx` ~line 804: `'--width': \`${TOAST_WIDTH}px\`` (constant `TOAST_WIDTH = 356`) | `[data-sonner-toaster]` width (§4.2), `[data-sonner-toast][data-styled='true']` width (§4.3) |
| `--gap` | **JS inline** | `Toaster` `<ol>` style, `index.tsx` ~line 805: `'--gap': \`${gap}px\`` (default `gap` prop, default constant `GAP = 14`) | `--lift-amount` calc (§4.3, §4.4), `[data-expanded='true']::after` height calc (§4.6) |
| `--front-toast-height` | **JS inline** | `Toaster` `<ol>` style, `index.tsx` ~line 803: `'--front-toast-height': \`${heights[0]?.height \|\| 0}px\`` | Collapsed-stack `height` (§4.6) |
| `--offset-top` / `-right` / `-bottom` / `-left` | **JS inline** | `Toaster` `<ol>` style, via `assignOffset()` helper, `index.tsx` ~lines 520–550 (default `VIEWPORT_OFFSET = '24px'` when `offset` prop unset) | `[data-sonner-toaster][data-{x,y}-position=...]` top/right/bottom/left (§4.2.2) |
| `--mobile-offset-top` / `-right` / `-bottom` / `-left` | **JS inline** | Same `assignOffset()` call, mobile branch (default `MOBILE_VIEWPORT_OFFSET = '16px'` when `mobileOffset` prop unset) | Mobile media query block (§4.10) |
| `--index` | **JS inline** | `Toast` `<li>` style, `index.tsx` line 296: `'--index': index` | **Not referenced anywhere in this stylesheet** (verified via full `var(--` grep of the file) — set for potential consumer/debug use only; not part of this file's own layout math |
| `--toasts-before` | **JS inline** | `Toast` `<li>` style, `index.tsx` line 297: `'--toasts-before': index` (same JS `index` value as `--index`, different custom-property name) | Collapsed-stack `--scale`/`--y` formula (§4.6) |
| `--z-index` | **JS inline** | `Toast` `<li>` style, `index.tsx` line 298: `'--z-index': toasts.length - index` | `[data-sonner-toast]` `z-index` (§4.3) |
| `--offset` | **JS inline** | `Toast` `<li>` style, `index.tsx` line 299: `'--offset': \`${removed ? offsetBeforeRemove : offset.current}px\`` | Expanded-state `--y` (§4.6), removed+expanded `--y` (§4.8) |
| `--initial-height` | **JS inline** | `Toast` `<li>` style, `index.tsx` line 300: `'--initial-height': expandByDefault ? 'auto' : \`${initialHeight}px\`` | Expanded-state `height` (§4.6), `::before` height-bump calc on non-front removed toast (§4.8) |
| `--y` | Stylesheet (cascade, multiple rules) | — | `transform: var(--y)` base (§4.3); swiping/keyframes compose additional translates on top (§4.9) |
| `--lift` | Stylesheet (y-position rules) | §4.4 | `--lift-amount` calc (§4.3/§4.4), expanded `--y` (§4.6), removed-state `--y` formulas (§4.8) |
| `--lift-amount` | Stylesheet (base + y-position rules) | §4.3, §4.4 | Collapsed-stack `--y` translateY term (§4.6) |
| `--scale` | Stylesheet (raw token expr, not `calc()` — see §2) | §4.6 | `scale(calc(-1 * var(--scale)))` in collapsed-stack `--y` (§4.6) |
| `--swipe-amount-x` / `--swipe-amount-y` | **JS inline**, live-updated | `Toast` `<li>` ref, `index.tsx` lines 352–353 (reset to `0px` on drag-cancel) and lines 415–416 (`toastRef.current.style.setProperty('--swipe-amount-x', ...)` during `onPointerMove`, outside the excerpted range but referenced at lines 326/329 for read-back) | Live-drag `transform` (§4.9), swipe-out keyframes' `from`/`to` frames (§4.9) |
| `--normal-bg` / `--normal-border` / `--normal-text` | Stylesheet (theme blocks + invert override) | §4.11 | Toast card background/border/color (§4.3), close-button (§4.12), buttons (§4.15) |
| `--normal-bg-hover` / `--normal-border-hover` | Stylesheet (dark theme block only) | §4.11 | Dark-theme close-button `:hover` (§4.11/§4.12) |
| `--success-bg/-border/-text`, `--info-*`, `--warning-*`, `--error-*` | Stylesheet (theme blocks) | §4.11 | Rich-colors rules (§4.13) |
| `--size` | Stylesheet (local to `.sonner-loading-wrapper`) | §4.16 | `.sonner-loading-wrapper`/`.sonner-spinner` height/width (§4.16) |

**Summary of the JS↔CSS contract an implementer of `Toaster.vue`/`Toast.vue` must reproduce
exactly** (for cross-reference; the authoritative spec for *how* these get set is whichever spec
covers `index.tsx`, not this one):
- On the toaster root element: inline `--front-toast-height`, `--width`, `--gap`, plus the full
  `assignOffset()` output (`--offset-{top,right,bottom,left}` and
  `--mobile-offset-{top,right,bottom,left}`), merged with any consumer-supplied `style` prop
  (consumer style is spread *after* — actually *before*, per the JSX spread order
  `{...style, ...assignOffset(...)}` — so `assignOffset()`'s offset variables always win over a
  consumer's own `style` prop object if both set the same key; this ordering detail belongs to the
  Toaster component spec, flagged here only because it's directly visible in the same code region
  this slice had to read to build this table).
- On each toast `<li>`: inline `--index`, `--toasts-before`, `--z-index`, `--offset`,
  `--initial-height`, merged with `...style, ...toast.style` (per-toast consumer style spread
  *after* these five, so a consumer's own inline style *can* override any of these five — again,
  an Toast-component-spec concern, noted here for completeness of the interface table).
- `--swipe-amount-x`/`-y` are set imperatively via `element.style.setProperty(...)` during pointer
  move/up handlers (not via the Vue-reactive `:style` binding) — this must be replicated as direct
  DOM `style.setProperty` calls on the toast's root ref in the Vue port too, not as a reactive
  `ref()` feeding a `:style` binding, to avoid Vue's reactivity/patch-cycle latency interfering
  with 1:1 pointer tracking during a drag (a performance/correctness concern the React source
  clearly designed around by bypassing React state entirely for this one property).

---

## 6. Open questions / contract conflicts

1. **`sideEffects` field mismatch.** ARCHITECTURE.md says: *"`sideEffects` must include the
   CSS-injecting entry + css."* — implying an explicit `sideEffects` array in `package.json`
   naming specific files. However, `sonner-react/package.json` has **no `sideEffects` field at
   all**. The absence of this field means npm/webpack/Rollup-consumer tooling defaults to treating
   **the entire package as side-effecting** (safest possible setting — nothing is ever
   tree-shaken away, including the CSS-injection side effect), which is a *stricter/safer*
   posture than an explicit array (an explicit array could, if incomplete, let a downstream
   bundler wrongly tree-shake away the CSS-injecting module in some edge case). This isn't
   necessarily a problem — an explicit `sideEffects: ["dist/index.mjs", "dist/index.cjs",
   "*.css"]` array in sonner-vue's `package.json` would still work and would arguably be more
   correct/explicit than upstream's omission — but it **is** a literal deviation from what the
   reference source does (source: nothing; contract: something), so flagging per instructions
   rather than silently adding a field sonner itself doesn't have. Recommend the orchestrator
   confirm whether sonner-vue should (a) omit `sideEffects` entirely to match sonner's
   `package.json` byte-for-byte in this respect, or (b) keep ARCHITECTURE.md's explicit-array
   instruction as an intentional, documented improvement over upstream. This decision belongs to
   whichever spec/agent owns `package.json`, not this styles slice — flagged here only because
   this slice's investigation is what surfaced the discrepancy.

No other conflicts between this file's content/delivery mechanism and ARCHITECTURE.md were found.

---

# Audit corrections (Opus verifier pass, authoritative — overrides anything above)

## AC-CSS1 (CRITICAL — blocks the whole slice). §3 "Full verbatim source" was **empty**; the implementer cannot open the React source, and §4's blocks are ordered by *concern*, not by *source line*.

§3 says "the implementer must copy `sonner-react/src/styles.css` verbatim" but contains no copy.
The implementation agents are explicitly barred from reading the React source, so as written this
slice is unimplementable. §4's fenced blocks do cumulatively contain every declaration line of the
file (verified programmatically, 0 lines missing), but §4's sections are **not in source order**
(e.g. §4.11 covers source lines 463–530 and is followed by §4.12 covering lines 219–251), and
§4.5 itself states that **rule order is load-bearing** for the `--y` cascade. Reconstructing the
file by concatenating §4's blocks in document order would produce a stylesheet with a broken
cascade.

**AC-CSS1 supplies the missing verbatim file. Copy the block below, byte for byte, to
`src/styles.css`. It is the authoritative artifact for this slice; §4 is commentary only.**
It is 725 lines and ends with the `.sonner-loader[data-visible='false']` rule.

```css
html[dir='ltr'],
[data-sonner-toaster][dir='ltr'] {
  --toast-icon-margin-start: -3px;
  --toast-icon-margin-end: 4px;
  --toast-svg-margin-start: -1px;
  --toast-svg-margin-end: 0px;
  --toast-button-margin-start: auto;
  --toast-button-margin-end: 0;
  --toast-close-button-start: 0;
  --toast-close-button-end: unset;
  --toast-close-button-transform: translate(-35%, -35%);
}

html[dir='rtl'],
[data-sonner-toaster][dir='rtl'] {
  --toast-icon-margin-start: 4px;
  --toast-icon-margin-end: -3px;
  --toast-svg-margin-start: 0px;
  --toast-svg-margin-end: -1px;
  --toast-button-margin-start: 0;
  --toast-button-margin-end: auto;
  --toast-close-button-start: unset;
  --toast-close-button-end: 0;
  --toast-close-button-transform: translate(35%, -35%);
}

[data-sonner-toaster] {
  position: fixed;
  width: var(--width);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial,
    Noto Sans, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji;
  --gray1: hsl(0, 0%, 99%);
  --gray2: hsl(0, 0%, 97.3%);
  --gray3: hsl(0, 0%, 95.1%);
  --gray4: hsl(0, 0%, 93%);
  --gray5: hsl(0, 0%, 90.9%);
  --gray6: hsl(0, 0%, 88.7%);
  --gray7: hsl(0, 0%, 85.8%);
  --gray8: hsl(0, 0%, 78%);
  --gray9: hsl(0, 0%, 56.1%);
  --gray10: hsl(0, 0%, 52.3%);
  --gray11: hsl(0, 0%, 43.5%);
  --gray12: hsl(0, 0%, 9%);
  --border-radius: 8px;
  box-sizing: border-box;
  padding: 0;
  margin: 0;
  list-style: none;
  outline: none;
  z-index: 999999999;
  transition: transform 400ms ease;
}

@media (hover: none) and (pointer: coarse) {
  [data-sonner-toaster][data-lifted='true'] {
    transform: none;
  }
}

[data-sonner-toaster][data-x-position='right'] {
  right: var(--offset-right);
}

[data-sonner-toaster][data-x-position='left'] {
  left: var(--offset-left);
}

[data-sonner-toaster][data-x-position='center'] {
  left: 50%;
  transform: translateX(-50%);
}

[data-sonner-toaster][data-y-position='top'] {
  top: var(--offset-top);
}

[data-sonner-toaster][data-y-position='bottom'] {
  bottom: var(--offset-bottom);
}

[data-sonner-toast] {
  --y: translateY(100%);
  --lift-amount: calc(var(--lift) * var(--gap));
  z-index: var(--z-index);
  position: absolute;
  opacity: 0;
  transform: var(--y);
  touch-action: none;
  transition: transform 400ms, opacity 400ms, height 400ms, box-shadow 200ms;
  box-sizing: border-box;
  outline: none;
  overflow-wrap: anywhere;
}

[data-sonner-toast][data-styled='true'] {
  padding: 16px;
  background: var(--normal-bg);
  border: 1px solid var(--normal-border);
  color: var(--normal-text);
  border-radius: var(--border-radius);
  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1);
  width: var(--width);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

[data-sonner-toast]:focus-visible {
  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 2px rgba(0, 0, 0, 0.2);
}

[data-sonner-toast][data-y-position='top'] {
  top: 0;
  --y: translateY(-100%);
  --lift: 1;
  --lift-amount: calc(1 * var(--gap));
}

[data-sonner-toast][data-y-position='bottom'] {
  bottom: 0;
  --y: translateY(100%);
  --lift: -1;
  --lift-amount: calc(var(--lift) * var(--gap));
}

[data-sonner-toast][data-styled='true'] [data-description] {
  font-weight: 400;
  line-height: 1.4;
  color: #3f3f3f;
}

[data-rich-colors='true'][data-sonner-toast][data-styled='true'] [data-description] {
  color: inherit;
}

[data-sonner-toaster][data-sonner-theme='dark'] [data-description] {
  color: hsl(0, 0%, 91%);
}

[data-sonner-toast][data-styled='true'] [data-title] {
  font-weight: 500;
  line-height: 1.5;
  color: inherit;
}

[data-sonner-toast][data-styled='true'] [data-icon] {
  display: flex;
  height: 16px;
  width: 16px;
  position: relative;
  justify-content: flex-start;
  align-items: center;
  flex-shrink: 0;
  margin-left: var(--toast-icon-margin-start);
  margin-right: var(--toast-icon-margin-end);
}

[data-sonner-toast][data-promise='true'] [data-icon] > svg {
  opacity: 0;
  transform: scale(0.8);
  transform-origin: center;
  animation: sonner-fade-in 300ms ease forwards;
}

[data-sonner-toast][data-styled='true'] [data-icon] > * {
  flex-shrink: 0;
}

[data-sonner-toast][data-styled='true'] [data-icon] svg {
  margin-left: var(--toast-svg-margin-start);
  margin-right: var(--toast-svg-margin-end);
}

[data-sonner-toast][data-styled='true'] [data-content] {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

[data-sonner-toast][data-styled='true'] [data-button] {
  border-radius: 4px;
  padding-left: 8px;
  padding-right: 8px;
  height: 24px;
  font-size: 12px;
  color: var(--normal-bg);
  background: var(--normal-text);
  margin-left: var(--toast-button-margin-start);
  margin-right: var(--toast-button-margin-end);
  border: none;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition: opacity 400ms, box-shadow 200ms;
}

[data-sonner-toast][data-styled='true'] [data-button]:focus-visible {
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.4);
}

[data-sonner-toast][data-styled='true'] [data-button]:first-of-type {
  margin-left: var(--toast-button-margin-start);
  margin-right: var(--toast-button-margin-end);
}

[data-sonner-toast][data-styled='true'] [data-cancel] {
  color: var(--normal-text);
  background: rgba(0, 0, 0, 0.08);
}

[data-sonner-toaster][data-sonner-theme='dark'] [data-sonner-toast][data-styled='true'] [data-cancel] {
  background: rgba(255, 255, 255, 0.3);
}

[data-sonner-toast][data-styled='true'] [data-close-button] {
  position: absolute;
  left: var(--toast-close-button-start);
  right: var(--toast-close-button-end);
  top: 0;
  height: 20px;
  width: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0;
  color: var(--normal-text);
  background: var(--normal-bg);
  border: 1px solid var(--normal-border);
  transform: var(--toast-close-button-transform);
  border-radius: 50%;
  cursor: pointer;
  z-index: 1;
  transition: opacity 100ms, background 200ms, border-color 200ms;
}

[data-sonner-toast][data-styled='true'] [data-close-button]:focus-visible {
  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 2px rgba(0, 0, 0, 0.2);
}

[data-sonner-toast][data-styled='true'] [data-disabled='true'] {
  cursor: not-allowed;
}

[data-sonner-toast][data-styled='true']:hover [data-close-button]:hover {
  background: var(--gray2);
  border-color: var(--gray5);
}

[data-sonner-toast][data-swiping='true']::before {
  content: '';
  position: absolute;
  left: -100%;
  right: -100%;
  height: 100%;
  z-index: -1;
}

[data-sonner-toast][data-y-position='top'][data-swiping='true']::before {
  bottom: 50%;
  transform: scaleY(3) translateY(50%);
}

[data-sonner-toast][data-y-position='bottom'][data-swiping='true']::before {
  top: 50%;
  transform: scaleY(3) translateY(-50%);
}

[data-sonner-toast][data-swiping='false'][data-removed='true']::before {
  content: '';
  position: absolute;
  inset: 0;
  transform: scaleY(2);
}

[data-sonner-toast][data-expanded='true']::after {
  content: '';
  position: absolute;
  left: 0;
  height: calc(var(--gap) + 1px);
  bottom: 100%;
  width: 100%;
}

[data-sonner-toast][data-mounted='true'] {
  --y: translateY(0);
  opacity: 1;
}

[data-sonner-toast][data-expanded='false'][data-front='false'] {
  --scale: var(--toasts-before) * 0.05 + 1;
  --y: translateY(calc(var(--lift-amount) * var(--toasts-before))) scale(calc(-1 * var(--scale)));
  height: var(--front-toast-height);
}

[data-sonner-toast] > * {
  transition: opacity 400ms;
}

[data-sonner-toast][data-x-position='right'] {
  right: 0;
}

[data-sonner-toast][data-x-position='left'] {
  left: 0;
}

[data-sonner-toast][data-expanded='false'][data-front='false'][data-styled='true'] > * {
  opacity: 0;
}

[data-sonner-toast][data-visible='false'] {
  opacity: 0;
  pointer-events: none;
}

[data-sonner-toast][data-mounted='true'][data-expanded='true'] {
  --y: translateY(calc(var(--lift) * var(--offset)));
  height: var(--initial-height);
}

[data-sonner-toast][data-removed='true'][data-front='true'][data-swipe-out='false'] {
  --y: translateY(calc(var(--lift) * -100%));
  opacity: 0;
}

[data-sonner-toast][data-removed='true'][data-front='false'][data-swipe-out='false'][data-expanded='true'] {
  --y: translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%));
  opacity: 0;
}

[data-sonner-toast][data-removed='true'][data-front='false'][data-swipe-out='false'][data-expanded='false'] {
  --y: translateY(40%);
  opacity: 0;
  transition: transform 500ms, opacity 200ms;
}

[data-sonner-toast][data-removed='true'][data-front='false']::before {
  height: calc(var(--initial-height) + 20%);
}

[data-sonner-toast][data-swiping='true'] {
  transform: var(--y) translateY(var(--swipe-amount-y, 0px)) translateX(var(--swipe-amount-x, 0px));
  transition: none;
}

[data-sonner-toast][data-swiped='true'] {
  -webkit-user-select: none; /* Safari 3+ */
  user-select: none;
}

[data-sonner-toast][data-swipe-out='true'][data-y-position='bottom'],
[data-sonner-toast][data-swipe-out='true'][data-y-position='top'] {
  animation-duration: 200ms;
  animation-timing-function: ease-out;
  animation-fill-mode: forwards;
}

[data-sonner-toast][data-swipe-out='true'][data-swipe-direction='left'] {
  animation-name: swipe-out-left;
}

[data-sonner-toast][data-swipe-out='true'][data-swipe-direction='right'] {
  animation-name: swipe-out-right;
}

[data-sonner-toast][data-swipe-out='true'][data-swipe-direction='up'] {
  animation-name: swipe-out-up;
}

[data-sonner-toast][data-swipe-out='true'][data-swipe-direction='down'] {
  animation-name: swipe-out-down;
}

@keyframes swipe-out-left {
  from {
    transform: var(--y) translateX(var(--swipe-amount-x));
    opacity: 1;
  }

  to {
    transform: var(--y) translateX(calc(var(--swipe-amount-x) - 100%));
    opacity: 0;
  }
}

@keyframes swipe-out-right {
  from {
    transform: var(--y) translateX(var(--swipe-amount-x));
    opacity: 1;
  }

  to {
    transform: var(--y) translateX(calc(var(--swipe-amount-x) + 100%));
    opacity: 0;
  }
}

@keyframes swipe-out-up {
  from {
    transform: var(--y) translateY(var(--swipe-amount-y));
    opacity: 1;
  }

  to {
    transform: var(--y) translateY(calc(var(--swipe-amount-y) - 100%));
    opacity: 0;
  }
}

@keyframes swipe-out-down {
  from {
    transform: var(--y) translateY(var(--swipe-amount-y));
    opacity: 1;
  }

  to {
    transform: var(--y) translateY(calc(var(--swipe-amount-y) + 100%));
    opacity: 0;
  }
}

@media (max-width: 600px) {
  [data-sonner-toaster] {
    position: fixed;
    right: var(--mobile-offset-right);
    left: var(--mobile-offset-left);
    width: 100%;
  }

  [data-sonner-toaster][dir='rtl'] {
    left: calc(var(--mobile-offset-left) * -1);
  }

  [data-sonner-toaster] [data-sonner-toast] {
    left: 0;
    right: 0;
    width: calc(100% - var(--mobile-offset-left) * 2);
  }

  [data-sonner-toaster][data-x-position='left'] {
    left: var(--mobile-offset-left);
  }

  [data-sonner-toaster][data-y-position='bottom'] {
    bottom: var(--mobile-offset-bottom);
  }

  [data-sonner-toaster][data-y-position='top'] {
    top: var(--mobile-offset-top);
  }

  [data-sonner-toaster][data-x-position='center'] {
    left: var(--mobile-offset-left);
    right: var(--mobile-offset-right);
    transform: none;
  }
}

[data-sonner-toaster][data-sonner-theme='light'] {
  --normal-bg: #fff;
  --normal-border: var(--gray4);
  --normal-text: var(--gray12);

  --success-bg: hsl(143, 85%, 96%);
  --success-border: hsl(145, 92%, 87%);
  --success-text: hsl(140, 100%, 27%);

  --info-bg: hsl(208, 100%, 97%);
  --info-border: hsl(221, 91%, 93%);
  --info-text: hsl(210, 92%, 45%);

  --warning-bg: hsl(49, 100%, 97%);
  --warning-border: hsl(49, 91%, 84%);
  --warning-text: hsl(31, 92%, 45%);

  --error-bg: hsl(359, 100%, 97%);
  --error-border: hsl(359, 100%, 94%);
  --error-text: hsl(360, 100%, 45%);
}

[data-sonner-toaster][data-sonner-theme='light'] [data-sonner-toast][data-invert='true'] {
  --normal-bg: #000;
  --normal-border: hsl(0, 0%, 20%);
  --normal-text: var(--gray1);
}

[data-sonner-toaster][data-sonner-theme='dark'] [data-sonner-toast][data-invert='true'] {
  --normal-bg: #fff;
  --normal-border: var(--gray3);
  --normal-text: var(--gray12);
}

[data-sonner-toaster][data-sonner-theme='dark'] {
  --normal-bg: #000;
  --normal-bg-hover: hsl(0, 0%, 12%);
  --normal-border: hsl(0, 0%, 20%);
  --normal-border-hover: hsl(0, 0%, 25%);
  --normal-text: var(--gray1);

  --success-bg: hsl(150, 100%, 6%);
  --success-border: hsl(147, 100%, 12%);
  --success-text: hsl(150, 86%, 65%);

  --info-bg: hsl(215, 100%, 6%);
  --info-border: hsl(223, 43%, 17%);
  --info-text: hsl(216, 87%, 65%);

  --warning-bg: hsl(64, 100%, 6%);
  --warning-border: hsl(60, 100%, 9%);
  --warning-text: hsl(46, 87%, 65%);

  --error-bg: hsl(358, 76%, 10%);
  --error-border: hsl(357, 89%, 16%);
  --error-text: hsl(358, 100%, 81%);
}

[data-sonner-toaster][data-sonner-theme='dark'] [data-sonner-toast] [data-close-button] {
  background: var(--normal-bg);
  border-color: var(--normal-border);
  color: var(--normal-text);
}

[data-sonner-toaster][data-sonner-theme='dark'] [data-sonner-toast] [data-close-button]:hover {
  background: var(--normal-bg-hover);
  border-color: var(--normal-border-hover);
}

[data-rich-colors='true'][data-sonner-toast][data-type='success'] {
  background: var(--success-bg);
  border-color: var(--success-border);
  color: var(--success-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='success'] [data-close-button] {
  background: var(--success-bg);
  border-color: var(--success-border);
  color: var(--success-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='info'] {
  background: var(--info-bg);
  border-color: var(--info-border);
  color: var(--info-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='info'] [data-close-button] {
  background: var(--info-bg);
  border-color: var(--info-border);
  color: var(--info-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='warning'] {
  background: var(--warning-bg);
  border-color: var(--warning-border);
  color: var(--warning-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='warning'] [data-close-button] {
  background: var(--warning-bg);
  border-color: var(--warning-border);
  color: var(--warning-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='error'] {
  background: var(--error-bg);
  border-color: var(--error-border);
  color: var(--error-text);
}

[data-rich-colors='true'][data-sonner-toast][data-type='error'] [data-close-button] {
  background: var(--error-bg);
  border-color: var(--error-border);
  color: var(--error-text);
}

.sonner-loading-wrapper {
  --size: 16px;
  height: var(--size);
  width: var(--size);
  position: absolute;
  inset: 0;
  z-index: 10;
}

.sonner-loading-wrapper[data-visible='false'] {
  transform-origin: center;
  animation: sonner-fade-out 0.2s ease forwards;
}

.sonner-spinner {
  position: relative;
  top: 50%;
  left: 50%;
  height: var(--size);
  width: var(--size);
}

.sonner-loading-bar {
  animation: sonner-spin 1.2s linear infinite;
  background: var(--gray11);
  border-radius: 6px;
  height: 8%;
  left: -10%;
  position: absolute;
  top: -3.9%;
  width: 24%;
}

.sonner-loading-bar:nth-child(1) {
  animation-delay: -1.2s;
  transform: rotate(0.0001deg) translate(146%);
}

.sonner-loading-bar:nth-child(2) {
  animation-delay: -1.1s;
  transform: rotate(30deg) translate(146%);
}

.sonner-loading-bar:nth-child(3) {
  animation-delay: -1s;
  transform: rotate(60deg) translate(146%);
}

.sonner-loading-bar:nth-child(4) {
  animation-delay: -0.9s;
  transform: rotate(90deg) translate(146%);
}

.sonner-loading-bar:nth-child(5) {
  animation-delay: -0.8s;
  transform: rotate(120deg) translate(146%);
}

.sonner-loading-bar:nth-child(6) {
  animation-delay: -0.7s;
  transform: rotate(150deg) translate(146%);
}

.sonner-loading-bar:nth-child(7) {
  animation-delay: -0.6s;
  transform: rotate(180deg) translate(146%);
}

.sonner-loading-bar:nth-child(8) {
  animation-delay: -0.5s;
  transform: rotate(210deg) translate(146%);
}

.sonner-loading-bar:nth-child(9) {
  animation-delay: -0.4s;
  transform: rotate(240deg) translate(146%);
}

.sonner-loading-bar:nth-child(10) {
  animation-delay: -0.3s;
  transform: rotate(270deg) translate(146%);
}

.sonner-loading-bar:nth-child(11) {
  animation-delay: -0.2s;
  transform: rotate(300deg) translate(146%);
}

.sonner-loading-bar:nth-child(12) {
  animation-delay: -0.1s;
  transform: rotate(330deg) translate(146%);
}

@keyframes sonner-fade-in {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes sonner-fade-out {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(0.8);
  }
}

@keyframes sonner-spin {
  0% {
    opacity: 1;
  }
  100% {
    opacity: 0.15;
  }
}

@media (prefers-reduced-motion) {
  [data-sonner-toast],
  [data-sonner-toast] > *,
  .sonner-loading-bar {
    transition: none !important;
    animation: none !important;
  }
}

.sonner-loader {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  transform-origin: center;
  transition: opacity 200ms, transform 200ms;
}

.sonner-loader[data-visible='false'] {
  opacity: 0;
  transform: scale(0.8) translate(-50%, -50%);
}
```

(End of verbatim `src/styles.css`. 725 lines. Do not reformat, reorder, minify, autoprefix, or
run it through PostCSS — §1 requires `dist/styles.css` to be a raw copy of this file, and §4.5
requires source order to be preserved.)

## AC-CSS2. §4.6's `scale(calc(-1 * var(--scale)))` explanation was factually wrong — corrected inline.

The stacked-toast scale is **positive** (`1 - 0.05 × --toasts-before` → `0.95`, `0.9`, `0.85`),
not negative, and no element is ever mirrored/flipped. See the corrected boxed note in §4.6. The
CSS itself was already correct (it is copied verbatim); only the explanation was wrong — but it
was wrong in a way that invites an implementer to "fix" the missing `calc()` on the `--scale`
declaration, which would actually introduce a 180° flip on every stacked toast.

## AC-CSS3. `component-spec.md` open question 2 is answered by this file: **there is no post-swipe click suppression in CSS.**

The component slice could not find any JS that suppresses the click following a swipe gesture and
asked whether CSS does it. It does not. The only `pointer-events` declaration in the entire file
is `[data-sonner-toast][data-visible='false'] { opacity: 0; pointer-events: none; }` (the
beyond-`visibleToasts` overflow stack). `touch-action: none` on `[data-sonner-toast]` and
`user-select: none` under `[data-swiped='true']` exist but neither suppresses a `click`.
**Conclusion: sonner v2.0.7 has no post-swipe click suppression anywhere. The Vue port must not
invent one.** That open question is closed.

## AC-CSS4. `--index` is set by JS but consumed by nothing (already noted in §5 — restating as a cross-slice guarantee).

Confirmed by a full `var(--` grep: `--index` appears zero times as a `var()` reference. The
stack math uses `--toasts-before` exclusively. Both are still written to every `<li>` (see
`component-spec.md` §5.7) — do not drop `--index` "because it's unused."

## AC-CSS5. `data-lifted` (§4.2.1) — restated as a hard cross-slice rule.

`[data-sonner-toaster][data-lifted='true']` inside the `(hover: none) and (pointer: coarse)`
media query is dead in v2.0.7: no JS anywhere in `src/` sets `data-lifted`. Keep the CSS rule
verbatim; **do not add JS that sets `data-lifted`** in the Vue port. (Flagged again here because
an implementer reading the stylesheet in isolation may reasonably assume the attribute is
supposed to exist and "wire it up.")
