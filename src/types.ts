import type { Component, VNode } from 'vue';

// STUB — placeholder public type surface so the package compiles and links.
// The real port lands per ARCHITECTURE.md ("React → Vue mappings") and component-spec.md /
// state-api-spec.md. Kept intentionally loose (index signatures) here; the real implementation
// agents replace these with the exact, spec-declared shapes.

/** Anything renderable as toast content (mirrors React.ReactNode). */
export type Renderable = string | number | Component | VNode;

export interface Action {
  label: Renderable;
  onClick: (event: MouseEvent) => void;
  actionButtonStyle?: Record<string, string | number>;
  [key: string]: unknown;
}

export interface ToastT {
  id: number | string;
  title?: Renderable | (() => Renderable);
  type?: string;
  [key: string]: unknown;
}

export interface ExternalToast {
  id?: number | string;
  [key: string]: unknown;
}

export interface ToastClassnames {
  [key: string]: string | undefined;
}

export interface ToasterProps {
  [key: string]: unknown;
}

export interface ToastToDismiss {
  id: number | string;
  dismiss: true;
}
