// Public entry point — mirrors sonner-react's src/index.tsx.
// Imports styles.css as a side effect so consumers get styled toasts with zero config (see
// styles-spec.md §1 for the CSS delivery verdict this build is designed to reproduce).
import './styles.css';

export { toast } from './state';
export { useSonner } from './hooks';

export { default as Toaster } from './Toaster.vue';

export type { Action, ExternalToast, ToastClassnames, ToasterProps, ToastT, ToastToDismiss } from './types';
