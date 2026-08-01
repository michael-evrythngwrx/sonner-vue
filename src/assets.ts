import { h } from 'vue';
import type { VNode } from 'vue';
import type { ToastTypes } from './types';

// Exactly 4 ToastTypes values map to an icon: 'success', 'info', 'warning', 'error'. Every
// other value — 'normal', 'action', 'loading', 'default', and undefined/unspecified — falls
// through to `default: return null` (no icon). Note 'loading' returns null here on purpose:
// the loading state is rendered via the separate Loader component, not through getAsset.
//
// Vue-specific structural requirement (state-api-spec.md §4.1, required by how Vue's
// rendering model differs from React's): in the React source, SuccessIcon/WarningIcon/
// InfoIcon/ErrorIcon are module-level constant JSX element values (already-instantiated,
// safely shared across renders). Vue VNodes are NOT safe to share — a VNode carries
// mount-time state and cannot be mounted in two places simultaneously (e.g. two toasts of the
// same type rendered at once). So these four values are zero-argument functions (Vue
// "functional components") that build a fresh VNode on every invocation, and getAsset returns
// the function reference, not a pre-built VNode. Consumers render the result via `h(icon)`.
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

// Mandate (state-api-spec.md AC-S1, CRITICAL): Loader must be CALLED directly as a plain
// function returning a VNode (`Loader({ visible, className })`), never mounted via `h(Loader,
// {...})` as an implicit functional component — Vue would treat `className` as a fallthrough
// DOM prop and overwrite the `sonner-loading-wrapper` class this function computes, breaking
// every styles.css rule scoped to it.
export const Loader = ({ visible, className }: { visible: boolean; className?: string }) =>
  h(
    'div',
    {
      // If `className` is falsy (undefined, ''), the result is just 'sonner-loading-wrapper'
      // (no trailing space); if truthy, 'sonner-loading-wrapper ' + className. Do not always
      // concatenate — replicate the falsy-filter exactly.
      class: ['sonner-loading-wrapper', className].filter(Boolean).join(' '),
      // React stringifies a JS boolean rendered into a non-whitelisted data-* attribute to the
      // literal strings "true"/"false". Explicitly stringify here for certainty across Vue
      // versions rather than relying on Vue's own boolean-attribute coercion.
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

// Byte-identical SVG output to the React version. React's JSX camelCase attribute names
// (fillRule/clipRule/strokeWidth/...) are React's own convention that its DOM renderer
// translates to the real hyphenated SVG presentation attributes (fill-rule/clip-rule/
// stroke-width/...) — Vue's `h()` does NOT perform this translation, so the literal hyphenated
// keys must be used as object keys in every `h()` call below. `viewBox` needs no translation —
// it is natively mixed-case in the SVG spec itself.

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

// Per §4.1's VNode-reuse constraint, CloseIcon must also be a zero-arg function (not a bare
// constant VNode) — it can be rendered in multiple toasts' close buttons simultaneously (every
// toast with closeButton: true shows one).
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
