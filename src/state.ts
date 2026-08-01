import type { ExternalToast, Renderable, ToastT, ToastToDismiss } from './types';

// STUB — placeholder Observer/toast implementation so the package compiles and links.
// The real, line-for-line-faithful port of sonner's state.ts (Observer class + `toast` function
// object) lands here; see ARCHITECTURE.md ("src/state.ts") and state-api-spec.md. Framework
// agnostic — do not introduce Vue reactivity here in the real implementation either.

type Subscriber = (toast: ToastT | ToastToDismiss) => void;

class Observer {
  subscribers: Subscriber[] = [];
  toasts: ToastT[] = [];

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.push(subscriber);
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      this.subscribers.splice(index, 1);
    };
  }
}

export const ToastState = new Observer();

function toast(_message: Renderable, _data?: ExternalToast): number | string {
  return 0;
}

toast.success = (_message: Renderable, _data?: ExternalToast) => 0;
toast.error = (_message: Renderable, _data?: ExternalToast) => 0;
toast.info = (_message: Renderable, _data?: ExternalToast) => 0;
toast.warning = (_message: Renderable, _data?: ExternalToast) => 0;
toast.loading = (_message: Renderable, _data?: ExternalToast) => 0;
toast.dismiss = (_id?: number | string) => '';
toast.custom = (_jsx: (id: number | string) => Renderable, _data?: ExternalToast) => 0;
toast.promise = (_promise: unknown, _data?: unknown) => ({ unwrap: () => Promise.resolve(undefined) });

export { toast };
