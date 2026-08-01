import { isVNode } from 'vue';
import type { Component, VNode } from 'vue';
import type {
  ExternalToast,
  PromiseData,
  PromiseIExtendedResult,
  PromiseT,
  Renderable,
  ToastT,
  ToastToDismiss,
  ToastTypes,
} from './types';

// Single mutable module-level counter, starts at 1, shared across every toast created via
// create(), the base toast() call, and custom(). Never resets (not even between different
// Toaster instances/toasterIds — it's global to the module).
let toastsCounter = 1;

type titleT = (() => Renderable) | Renderable;

class Observer {
  // Source-fidelity note (state-api-spec.md §2.2): the React source's field declaration for
  // `subscribers` types the callback parameter as `ExternalToast | ToastToDismiss`, but the
  // `subscribe()` method itself (and every actual call site) uses `ToastT | ToastToDismiss`.
  // This is an internal inconsistency in the upstream .ts file (not user-visible, Observer is
  // never exported). Ported using `ToastT | ToastToDismiss` consistently — this is what's
  // actually published at runtime.
  subscribers: Array<(toast: ToastT | ToastToDismiss) => void>;
  toasts: Array<ToastT | ToastToDismiss>;
  dismissedToasts: Set<string | number>;

  constructor() {
    this.subscribers = [];
    this.toasts = [];
    this.dismissedToasts = new Set();
  }

  // Arrow-function class field (correct `this` binding regardless of how the method is later
  // detached/called — important since the exported `toast` object relies on this, see §2.15).
  subscribe = (subscriber: (toast: ToastT | ToastToDismiss) => void) => {
    this.subscribers.push(subscriber);
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      // If the subscriber was already removed (index -1), splice(-1, 1) removes the LAST
      // element of the array instead of doing nothing — this is the literal behavior of the
      // source and must be preserved (no `if (index === -1) return;` guard).
      this.subscribers.splice(index, 1);
    };
  };

  publish = (data: ToastT) => {
    this.subscribers.forEach((subscriber) => subscriber(data));
  };

  addToast = (data: ToastT) => {
    this.publish(data);
    // New array via spread, not mutation — `this.toasts` is reassigned, so anything holding a
    // reference to the old array won't see the update.
    this.toasts = [...this.toasts, data];
  };

  create = (
    data: ExternalToast & {
      message?: titleT;
      type?: ToastTypes;
      promise?: PromiseT;
      jsx?: VNode | Component;
    },
  ) => {
    const { message, ...rest } = data;
    // Strict-TS-safe rewrite of upstream's `typeof data?.id === 'number' || data.id?.length >
    // 0` (state-api-spec.md §2.6 step 2) — behaviorally identical: `number` (including `0`)
    // used as-is; non-empty `string` used as-is; otherwise a fresh id is minted from
    // `toastsCounter++` (post-increment).
    const id =
      typeof data?.id === 'number'
        ? data.id
        : typeof data?.id === 'string' && data.id.length > 0
          ? data.id
          : toastsCounter++;
    const alreadyExists = this.toasts.find((toast) => toast.id === id);
    const dismissible = data.dismissible === undefined ? true : data.dismissible;

    if (this.dismissedToasts.has(id)) {
      this.dismissedToasts.delete(id);
    }

    if (alreadyExists) {
      this.toasts = this.toasts.map((toast) => {
        if (toast.id === id) {
          // Publishes the OLD toast merged with the new call's data, WITHOUT the freshly
          // computed `dismissible` — if `data` didn't include an explicit `dismissible`, the
          // published object's `dismissible` comes from the previously stored value, not the
          // just-computed default. This is a genuine, subtle discrepancy in upstream sonner;
          // it must be preserved exactly (do not add `dismissible` to the published object).
          this.publish({ ...toast, ...data, id, title: message } as ToastT);
          return {
            ...toast,
            ...data,
            id,
            dismissible,
            title: message,
          } as ToastT;
        }
        return toast;
      });
    } else {
      // `id` is placed last so it always wins over any `id` that might have survived into
      // `rest`.
      this.addToast({ title: message, ...rest, dismissible, id } as ToastT);
    }

    return id;
  };

  dismiss = (id?: number | string) => {
    // Truthiness check (not `typeof id !== 'undefined'`) — `id === 0` falls into the `else`
    // branch, i.e. `toast.dismiss(0)` dismisses ALL toasts, not the toast with id `0`. This is
    // the same "falsy zero" characteristic that create()'s id resolution gets right and
    // dismiss() does not. Preserve exactly.
    if (id) {
      this.dismissedToasts.add(id);
      requestAnimationFrame(() => this.subscribers.forEach((subscriber) => subscriber({ id, dismiss: true })));
    } else {
      // Does NOT add any of these ids to `dismissedToasts` — intentional/as-is in the source.
      this.toasts.forEach((toast) => {
        this.subscribers.forEach((subscriber) => subscriber({ id: toast.id, dismiss: true }));
      });
    }

    return id;
  };

  message = (message: titleT, data?: ExternalToast) => {
    return this.create({ ...data, message });
  };

  error = (message: titleT, data?: ExternalToast) => {
    return this.create({ ...data, message, type: 'error' });
  };

  success = (message: titleT, data?: ExternalToast) => {
    return this.create({ ...data, type: 'success', message });
  };

  info = (message: titleT, data?: ExternalToast) => {
    return this.create({ ...data, type: 'info', message });
  };

  warning = (message: titleT, data?: ExternalToast) => {
    return this.create({ ...data, type: 'warning', message });
  };

  loading = (message: titleT, data?: ExternalToast) => {
    return this.create({ ...data, type: 'loading', message });
  };

  promise = <ToastData,>(promise: PromiseT<ToastData>, data?: PromiseData<ToastData>) => {
    if (!data) return;

    let id: string | number | undefined = undefined;
    if (data.loading !== undefined) {
      id = this.create({
        ...data,
        promise,
        type: 'loading',
        message: data.loading,
        description: typeof data.description !== 'function' ? data.description : undefined,
      });
    }

    const p = Promise.resolve(promise instanceof Function ? promise() : promise);

    let shouldDismiss = id !== undefined;
    let result: ['resolve', ToastData] | ['reject', unknown];

    const originalPromise = p
      .then(async (response) => {
        result = ['resolve', response];
        const isVNodeResponse = isVNode(response as any);

        if (isVNodeResponse) {
          shouldDismiss = false;
          this.create({ id, type: 'default', message: response as unknown as Renderable });
        } else if (isHttpResponse(response) && !(response as any).ok) {
          shouldDismiss = false;
          const promiseData =
            typeof data.error === 'function'
              ? await (data.error as any)(`HTTP error! status: ${(response as any).status}`)
              : data.error;
          const description =
            typeof data.description === 'function'
              ? await (data.description as any)(`HTTP error! status: ${(response as any).status}`)
              : data.description;
          const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData as any);
          const toastSettings: PromiseIExtendedResult = isExtendedResult
            ? (promiseData as PromiseIExtendedResult)
            : ({ message: promiseData } as PromiseIExtendedResult);
          this.create({ id, type: 'error', description, ...toastSettings });
        } else if (response instanceof Error) {
          shouldDismiss = false;
          const promiseData = typeof data.error === 'function' ? await (data.error as any)(response) : data.error;
          const description =
            typeof data.description === 'function' ? await (data.description as any)(response) : data.description;
          const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData as any);
          const toastSettings: PromiseIExtendedResult = isExtendedResult
            ? (promiseData as PromiseIExtendedResult)
            : ({ message: promiseData } as PromiseIExtendedResult);
          this.create({ id, type: 'error', description, ...toastSettings });
        } else if (data.success !== undefined) {
          shouldDismiss = false;
          const promiseData =
            typeof data.success === 'function' ? await (data.success as any)(response) : data.success;
          const description =
            typeof data.description === 'function' ? await (data.description as any)(response) : data.description;
          const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData as any);
          const toastSettings: PromiseIExtendedResult = isExtendedResult
            ? (promiseData as PromiseIExtendedResult)
            : ({ message: promiseData } as PromiseIExtendedResult);
          this.create({ id, type: 'success', description, ...toastSettings });
        }
        // else: no branch matched -> no this.create() call at all. shouldDismiss unchanged.
      })
      .catch(async (error) => {
        result = ['reject', error];
        // Unlike the .then() branch's HTTP/Error sub-cases, this DOES gate on
        // `data.error !== undefined` before doing anything.
        if (data.error !== undefined) {
          shouldDismiss = false;
          const promiseData = typeof data.error === 'function' ? await (data.error as any)(error) : data.error;
          const description =
            typeof data.description === 'function' ? await (data.description as any)(error) : data.description;
          const isExtendedResult = typeof promiseData === 'object' && !isVNode(promiseData as any);
          const toastSettings: PromiseIExtendedResult = isExtendedResult
            ? (promiseData as PromiseIExtendedResult)
            : ({ message: promiseData } as PromiseIExtendedResult);
          this.create({ id, type: 'error', description, ...toastSettings });
        }
      })
      .finally(() => {
        if (shouldDismiss) {
          this.dismiss(id);
          id = undefined;
        }
        data.finally?.();
      });

    const unwrap = () =>
      new Promise<ToastData>((resolve, reject) =>
        originalPromise
          .then(() => (result[0] === 'reject' ? reject(result[1]) : resolve(result[1] as ToastData)))
          .catch(reject),
      );

    // Synchronous return, evaluated immediately after the chain is constructed, using `id`'s
    // value from before any async .then/.catch/.finally callback has had a chance to run.
    if (typeof id !== 'string' && typeof id !== 'number') {
      return { unwrap };
    } else {
      // `Object.assign`'s target argument gets boxed via ToObject — the return value is a
      // boxed Number/String wrapper object (not a primitive!) with an own `unwrap` property
      // attached. This is a real, documented quirk of upstream sonner. Preserve exactly — do
      // not "fix" it into a plain `{ id, unwrap }` shape.
      return Object.assign(id, { unwrap });
    }
  };

  custom = (jsx: (id: number | string) => VNode | Component, data?: ExternalToast) => {
    // Truthiness check (`||`), not the careful `typeof === 'number'` check create() uses
    // internally — `toast.custom(cb, {id: 0})` does NOT reuse id `0`, it mints a fresh id.
    // Preserve exactly — do not harmonize with create()'s logic.
    const id = data?.id || toastsCounter++;
    this.create({ jsx: jsx(id), ...data, id });
    return id;
  };

  getActiveToasts = () => {
    return this.toasts.filter((toast) => !this.dismissedToasts.has(toast.id));
  };
}

export const ToastState = new Observer();

// This is the single most important asymmetry in the module: calling the base export as a
// function does NOT go through Observer.create(). It calls ToastState.addToast() directly —
// no dedupe, no dismissible default, no un-dismiss-on-recreate, and it uses the truthy `||`
// id-resolution (same falsy-zero quirk as custom()/dismiss()).
const toastFunction = (message: titleT, data?: ExternalToast) => {
  const id = data?.id || toastsCounter++;

  ToastState.addToast({
    title: message,
    ...data,
    id,
  } as ToastT);
  return id;
};

// Module-private, duck-types anything shaped like a Fetch Response (has boolean `.ok` and
// numeric `.status`) — used only by promise()'s .then() branch.
const isHttpResponse = (data: any): data is Response => {
  return (
    data &&
    typeof data === 'object' &&
    'ok' in data &&
    typeof data.ok === 'boolean' &&
    'status' in data &&
    typeof data.status === 'number'
  );
};

const basicToast = toastFunction;

const getHistory = () => ToastState.toasts;
const getToasts = () => ToastState.getActiveToasts();

// Object.assign called with three arguments: target = the plain function `basicToast`
// (mutated in place and returned), source 1 = 9 methods torn off ToastState (safe because
// they're arrow-function class fields, already bound to the ToastState instance), source 2 =
// `{ getHistory, getToasts }` (plain closures over ToastState). End result: `toast` is
// simultaneously callable and has 11 own properties. There is deliberately no `toast.create`
// or `toast.getActiveToasts` exposed on the public object.
export const toast = Object.assign(
  basicToast,
  {
    success: ToastState.success,
    info: ToastState.info,
    warning: ToastState.warning,
    error: ToastState.error,
    custom: ToastState.custom,
    message: ToastState.message,
    promise: ToastState.promise,
    dismiss: ToastState.dismiss,
    loading: ToastState.loading,
  },
  { getHistory, getToasts },
);
