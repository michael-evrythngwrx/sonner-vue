import { h, type VNode } from 'vue';

// STUB — placeholder icon components so the package compiles and links.
// Real, byte-identical (same attributes/classes/structure) SVG icons land here per
// ARCHITECTURE.md ("src/assets.ts") — ported from sonner-react/src/assets.tsx.

export function CheckmarkIcon(): VNode {
  return h('svg');
}

export function ErrorIcon(): VNode {
  return h('svg');
}

export function InfoIcon(): VNode {
  return h('svg');
}

export function WarningIcon(): VNode {
  return h('svg');
}

export function CloseIcon(): VNode {
  return h('svg');
}

export function Loader(_props: { visible?: boolean }): VNode {
  return h('div', { class: 'sonner-loading-wrapper' });
}
