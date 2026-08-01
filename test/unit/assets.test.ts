/**
 * `src/assets.ts` — byte-identical SVG/DOM output parity with `sonner-react/src/assets.tsx`
 * (state-api-spec.md §4.1-§4.6, AC-S1).
 *
 * Every expected markup string below was transcribed from the React source and then had
 * React's JSX camelCase attribute names resolved to the real hyphenated SVG presentation
 * attributes React's DOM renderer emits (`fillRule` -> `fill-rule`, `clipRule` -> `clip-rule`,
 * `strokeWidth` -> `stroke-width`, `strokeLinecap` -> `stroke-linecap`, `strokeLinejoin` ->
 * `stroke-linejoin`). `viewBox` is natively mixed-case in the SVG spec and is emitted as-is by
 * both renderers. Attribute ORDER equals JSX prop order in React and `h()` props-object order
 * in Vue, and both serialise in insertion order — so the strings are directly comparable.
 *
 * None of this is covered by the 36 Playwright specs, which never assert icon markup.
 */
import { describe, expect, it, vi } from 'vitest';
import { h, isVNode, type VNode } from 'vue';
import * as assets from '../../src/assets';
import { CloseIcon, getAsset, Loader } from '../../src/assets';
import type { ToastTypes } from '../../src/types';
import { renderVNode } from './helpers';

const SVG_NS = 'http://www.w3.org/2000/svg';

const SUCCESS_D =
  'M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z';
const WARNING_D =
  'M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z';
const INFO_D =
  'M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z';
const ERROR_D =
  'M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z';

const iconMarkup = (viewBox: string, d: string) =>
  `<svg xmlns="${SVG_NS}" viewBox="${viewBox}" fill="currentColor" height="20" width="20">` +
  `<path fill-rule="evenodd" d="${d}" clip-rule="evenodd"></path>` +
  `</svg>`;

const EXPECTED: Record<'success' | 'info' | 'warning' | 'error', { viewBox: string; markup: string }> = {
  // viewBox differs for `warning` only — verified against sonner-react/src/assets.tsx.
  success: { viewBox: '0 0 20 20', markup: iconMarkup('0 0 20 20', SUCCESS_D) },
  info: { viewBox: '0 0 20 20', markup: iconMarkup('0 0 20 20', INFO_D) },
  warning: { viewBox: '0 0 24 24', markup: iconMarkup('0 0 24 24', WARNING_D) },
  error: { viewBox: '0 0 20 20', markup: iconMarkup('0 0 20 20', ERROR_D) },
};

const CLOSE_ICON_MARKUP =
  `<svg xmlns="${SVG_NS}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
  `<line x1="18" y1="6" x2="6" y2="18"></line>` +
  `<line x1="6" y1="6" x2="18" y2="18"></line>` +
  `</svg>`;

const LOADING_BARS = '<div class="sonner-loading-bar"></div>'.repeat(12);
const loaderMarkup = (cls: string, visible: boolean) =>
  `<div class="${cls}" data-visible="${visible}"><div class="sonner-spinner">${LOADING_BARS}</div></div>`;

// =========================================================================================
// §4.1 getAsset
// =========================================================================================
describe('getAsset (§4.1)', () => {
  it.each(['success', 'info', 'warning', 'error'] as const)('returns an icon factory for "%s"', (type) => {
    const icon = getAsset(type);
    expect(typeof icon).toBe('function');
  });

  it.each(['normal', 'action', 'loading', 'default'] as const)('returns null for "%s"', (type) => {
    expect(getAsset(type)).toBeNull();
  });

  it('returns null for an unspecified / unknown type', () => {
    expect(getAsset(undefined as unknown as ToastTypes)).toBeNull();
    expect(getAsset('nonsense' as unknown as ToastTypes)).toBeNull();
  });

  it('returns the SAME factory reference for repeated calls (module-level constants, like React)', () => {
    expect(getAsset('success')).toBe(getAsset('success'));
    expect(getAsset('error')).toBe(getAsset('error'));
  });

  it('returns four DISTINCT factories', () => {
    const all = [getAsset('success'), getAsset('info'), getAsset('warning'), getAsset('error')];
    expect(new Set(all).size).toBe(4);
  });

  it('§4.1 Vue deviation: each invocation builds a FRESH VNode (React reuses one element; Vue VNodes carry mount state)', () => {
    const factory = getAsset('success')!;
    const a = factory();
    const b = factory();
    expect(isVNode(a)).toBe(true);
    expect(isVNode(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('the same icon can be mounted twice simultaneously without Vue VNode-reuse warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const icon = getAsset('success')!;

    const wrapper = renderVNode(() => h('div', [h(icon), h(icon)]));

    expect(wrapper.element.querySelectorAll('svg')).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    wrapper.unmount();
  });
});

// =========================================================================================
// §4.2 the four type icons
// =========================================================================================
describe('type icons — exact DOM parity (§4.2)', () => {
  it.each(['success', 'info', 'warning', 'error'] as const)('%s renders byte-identical markup to React', (type) => {
    const wrapper = renderVNode(() => h(getAsset(type)!));
    expect(wrapper.element.outerHTML).toBe(EXPECTED[type].markup);
    wrapper.unmount();
  });

  it.each(['success', 'info', 'warning', 'error'] as const)('%s has the exact upstream attribute set', (type) => {
    const wrapper = renderVNode(() => h(getAsset(type)!));
    const svg = wrapper.element as unknown as SVGElement;

    expect(svg.tagName).toBe('svg');
    expect(svg.getAttributeNames()).toEqual(['xmlns', 'viewBox', 'fill', 'height', 'width']);
    expect(svg.getAttribute('xmlns')).toBe(SVG_NS);
    expect(svg.getAttribute('viewBox')).toBe(EXPECTED[type].viewBox);
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.getAttribute('width')).toBe('20');

    // Exactly one <path> child, no other children.
    expect(svg.children).toHaveLength(1);
    const path = svg.firstElementChild!;
    expect(path.tagName).toBe('path');
    // KEBAB-CASE, not React's JSX camelCase: Vue's h() does not translate `fillRule`, and an
    // unrecognised `fillRule` attribute would silently fall back to fill-rule="nonzero".
    expect(path.getAttributeNames()).toEqual(['fill-rule', 'd', 'clip-rule']);
    expect(path.getAttribute('fill-rule')).toBe('evenodd');
    expect(path.getAttribute('clip-rule')).toBe('evenodd');
    expect(path.getAttribute('fillRule')).toBeNull();
    expect(path.getAttribute('clipRule')).toBeNull();

    wrapper.unmount();
  });

  it.each(['success', 'info', 'warning', 'error'] as const)('%s is created in the SVG namespace', (type) => {
    const wrapper = renderVNode(() => h(getAsset(type)!));
    expect((wrapper.element as unknown as SVGElement).namespaceURI).toBe(SVG_NS);
    expect((wrapper.element.firstElementChild as unknown as SVGElement).namespaceURI).toBe(SVG_NS);
    wrapper.unmount();
  });

  it('only `warning` uses the 24x24 viewBox', () => {
    const viewBoxes = (['success', 'info', 'warning', 'error'] as const).map((type) => {
      const wrapper = renderVNode(() => h(getAsset(type)!));
      const value = wrapper.element.getAttribute('viewBox');
      wrapper.unmount();
      return value;
    });
    expect(viewBoxes).toEqual(['0 0 20 20', '0 0 20 20', '0 0 24 24', '0 0 20 20']);
  });
});

// =========================================================================================
// §4.4 CloseIcon
// =========================================================================================
describe('CloseIcon — exact DOM parity (§4.4)', () => {
  it('renders byte-identical markup to React', () => {
    const wrapper = renderVNode(() => h(CloseIcon));
    expect(wrapper.element.outerHTML).toBe(CLOSE_ICON_MARKUP);
    wrapper.unmount();
  });

  it('has the exact upstream attribute set, with stroke attributes kebab-cased', () => {
    const wrapper = renderVNode(() => h(CloseIcon));
    const svg = wrapper.element as unknown as SVGElement;

    expect(svg.getAttributeNames()).toEqual([
      'xmlns',
      'width',
      'height',
      'viewBox',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
    ]);
    expect(svg.getAttribute('width')).toBe('12');
    expect(svg.getAttribute('height')).toBe('12');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.getAttribute('strokeWidth')).toBeNull();

    wrapper.unmount();
  });

  it('has exactly two <line> children with the upstream coordinates', () => {
    const wrapper = renderVNode(() => h(CloseIcon));
    const lines = Array.from<Element>(wrapper.element.children);

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.tagName).toBe('line');
      expect(line.getAttributeNames()).toEqual(['x1', 'y1', 'x2', 'y2']);
      expect(line.textContent).toBe('');
    }
    expect(lines.map((l) => ['x1', 'y1', 'x2', 'y2'].map((a) => l.getAttribute(a)))).toEqual([
      ['18', '6', '6', '18'],
      ['6', '6', '18', '18'],
    ]);

    wrapper.unmount();
  });

  it('§4.1: is a zero-arg factory producing a fresh VNode each call, and can render twice at once', () => {
    expect(typeof CloseIcon).toBe('function');
    expect(CloseIcon()).not.toBe(CloseIcon());

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapper = renderVNode(() => h('div', [h(CloseIcon), h(CloseIcon)]));
    expect(wrapper.element.querySelectorAll('svg')).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    wrapper.unmount();
  });
});

// =========================================================================================
// §4.3 Loader
// =========================================================================================
describe('Loader — exact DOM parity (§4.3 / AC-S1)', () => {
  it('renders the upstream wrapper/spinner/12-bar structure with data-visible="true"', () => {
    const wrapper = renderVNode(() => Loader({ visible: true }));
    expect(wrapper.element.outerHTML).toBe(loaderMarkup('sonner-loading-wrapper', true));
    wrapper.unmount();
  });

  it('stringifies `visible: false` to data-visible="false" (React`s data-* boolean behavior)', () => {
    const wrapper = renderVNode(() => Loader({ visible: false }));
    expect(wrapper.element.getAttribute('data-visible')).toBe('false');
    expect(wrapper.element.outerHTML).toBe(loaderMarkup('sonner-loading-wrapper', false));
    wrapper.unmount();
  });

  it('appends a truthy className with a single space', () => {
    const wrapper = renderVNode(() => Loader({ visible: true, className: 'custom-loader' }));
    expect(wrapper.element.getAttribute('class')).toBe('sonner-loading-wrapper custom-loader');
    expect(wrapper.element.outerHTML).toBe(loaderMarkup('sonner-loading-wrapper custom-loader', true));
    wrapper.unmount();
  });

  it('§4.3: an EMPTY-STRING className is filtered out — no trailing space', () => {
    const wrapper = renderVNode(() => Loader({ visible: true, className: '' }));
    expect(wrapper.element.getAttribute('class')).toBe('sonner-loading-wrapper');
    wrapper.unmount();
  });

  it('an undefined className is filtered out — no trailing space', () => {
    const wrapper = renderVNode(() => Loader({ visible: true, className: undefined }));
    expect(wrapper.element.getAttribute('class')).toBe('sonner-loading-wrapper');
    wrapper.unmount();
  });

  it('has exactly two attributes on the wrapper: class and data-visible', () => {
    const wrapper = renderVNode(() => Loader({ visible: true }));
    expect(wrapper.element.getAttributeNames()).toEqual(['class', 'data-visible']);
    wrapper.unmount();
  });

  it('renders exactly 12 bare `sonner-loading-bar` divs inside one `sonner-spinner`', () => {
    const wrapper = renderVNode(() => Loader({ visible: true }));

    expect(wrapper.element.children).toHaveLength(1);
    const spinner = wrapper.element.firstElementChild!;
    expect(spinner.getAttributeNames()).toEqual(['class']);
    expect(spinner.getAttribute('class')).toBe('sonner-spinner');
    expect(spinner.children).toHaveLength(12);
    for (const bar of Array.from<Element>(spinner.children)) {
      expect(bar.tagName).toBe('DIV');
      expect(bar.getAttributeNames()).toEqual(['class']);
      expect(bar.getAttribute('class')).toBe('sonner-loading-bar');
      expect(bar.children).toHaveLength(0);
    }
    wrapper.unmount();
  });

  it('uses the upstream `spinner-bar-${i}` keys on the bars', () => {
    const vnode = Loader({ visible: true }) as VNode;
    const spinner = (vnode.children as VNode[])[0]!;
    const bars = spinner.children as VNode[];
    expect(bars.map((b) => b.key)).toEqual(Array.from({ length: 12 }, (_, i) => `spinner-bar-${i}`));
  });

  it('AC-S1: is a plain function to be CALLED (returns a VNode directly), not a component to mount', () => {
    const returned = Loader({ visible: true });
    expect(isVNode(returned)).toBe(true);
    // Fresh VNode per call — mandatory for rendering multiple loading toasts at once.
    expect(Loader({ visible: true })).not.toBe(returned);
  });
});

// =========================================================================================
// Module export surface
// =========================================================================================
describe('assets module export surface (§4.2 note)', () => {
  it('exports exactly `getAsset`, `Loader` and `CloseIcon` — the four type icons stay private', () => {
    expect(Object.keys(assets).sort()).toEqual(['CloseIcon', 'Loader', 'getAsset']);
  });
});
