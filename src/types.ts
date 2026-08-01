import type { Component, VNode, CSSProperties } from 'vue';

// Not present in the React source (React uses `React.ReactNode` everywhere). Per
// ARCHITECTURE.md's React -> Vue mappings and state-api-spec.md §0, this is the Vue
// port's stand-in for `React.ReactNode`.
export type Renderable = string | number | Component | VNode;

export type ToastTypes = 'normal' | 'action' | 'success' | 'info' | 'warning' | 'error' | 'loading' | 'default';

export type PromiseT<Data = any> = Promise<Data> | (() => Promise<Data>);

export interface PromiseIExtendedResult extends ExternalToast {
  message: Renderable;
}

export type PromiseTExtendedResult<Data = any> =
  | PromiseIExtendedResult
  | ((data: Data) => PromiseIExtendedResult | Promise<PromiseIExtendedResult>);

export type PromiseTResult<Data = any> =
  | string
  | Renderable
  | ((data: Data) => Renderable | string | Promise<Renderable | string>);
// NOTE: `string` is a redundant union member (Renderable already includes string). This
// redundancy exists in the original React source too (ReactNode includes string). Preserve
// it verbatim for structural fidelity — do not "clean it up".

export type PromiseExternalToast = Omit<ExternalToast, 'description'>;

export interface PromiseData<ToastData = any> extends PromiseExternalToast {
  loading?: string | Renderable;
  success?: PromiseTResult<ToastData> | PromiseTExtendedResult<ToastData>;
  error?: PromiseTResult | PromiseTExtendedResult;
  description?: PromiseTResult;
  finally?: () => void | Promise<void>;
}

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

// Deliberate, contract-directed deviation from the literal React type (state-api-spec.md
// §1.5 / ARCHITECTURE.md's React -> Vue mappings): every field here is `React.ReactNode` in
// the React source with no function variant. The Vue port widens each to also accept a
// zero-arg thunk so callers can defer VNode creation (VNodes must not be created eagerly and
// reused — see AC-S2). Strings still render as text (upstream parity).
export interface ToastIcons {
  success?: Renderable | (() => Renderable);
  info?: Renderable | (() => Renderable);
  warning?: Renderable | (() => Renderable);
  error?: Renderable | (() => Renderable);
  loading?: Renderable | (() => Renderable);
  close?: Renderable | (() => Renderable);
}

export interface Action {
  label: Renderable;
  onClick: (event: MouseEvent) => void; // React.MouseEvent<HTMLButtonElement, MouseEvent> -> native MouseEvent
  actionButtonStyle?: CSSProperties;
}

export interface ToastT {
  id: number | string;
  toasterId?: string;
  title?: (() => Renderable) | Renderable;
  type?: ToastTypes;
  icon?: Renderable | (() => Renderable);
  jsx?: Renderable;
  richColors?: boolean;
  invert?: boolean;
  closeButton?: boolean;
  dismissible?: boolean;
  description?: (() => Renderable) | Renderable;
  duration?: number;
  delete?: boolean;
  action?: Action | Renderable | (() => Renderable);
  cancel?: Action | Renderable | (() => Renderable);
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

// isAction type guard — runtime logic is byte-identical to the React source, only the type
// annotation changes.
export function isAction(action: Action | Renderable): action is Action {
  return (action as Action).label !== undefined;
}

export type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';

export interface HeightT {
  height: number;
  toastId: number | string;
  position: Position;
}

// NOT exported in the React source (no `export` keyword). Kept un-exported here too —
// internal to types.ts, referenced only by ToasterProps.toastOptions.
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

// NOT exported in the React source. Kept un-exported here too.
type Offset =
  | {
      top?: string | number;
      right?: string | number;
      bottom?: string | number;
      left?: string | number;
    }
  | string
  | number;

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

// Internal component-props interface, consumed by the Toast.vue slice.
export interface ToastProps {
  toast: ToastT;
  toasts: ToastT[];
  index: number;
  swipeDirections?: SwipeDirection[];
  expanded: boolean;
  invert: boolean;
  heights: HeightT[];
  // React's `React.Dispatch<React.SetStateAction<HeightT[]>>` (a useState setter accepting
  // either a new array or an updater function) has no direct Vue equivalent — this signature
  // preserves both call-site shapes React code uses. See state-api-spec.md §1.4: the
  // implementation behind this signature belongs to the Toast.vue/Toaster.vue slice.
  setHeights: (updater: HeightT[] | ((prev: HeightT[]) => HeightT[])) => void;
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

// Plain TS enum, no JSX/ReactNode involvement — ported verbatim.
export enum SwipeStateTypes {
  SwipedOut = 'SwipedOut',
  SwipedBack = 'SwipedBack',
  NotSwiped = 'NotSwiped',
}

export type Theme = 'light' | 'dark';

export interface ToastToDismiss {
  id: number | string;
  dismiss: boolean;
}

export type ExternalToast = Omit<ToastT, 'id' | 'type' | 'title' | 'jsx' | 'delete' | 'promise'> & {
  id?: number | string;
  toasterId?: string;
};
