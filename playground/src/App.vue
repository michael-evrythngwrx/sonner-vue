<script setup lang="ts">
// Playground app — reproduces sonner-react's test app DOM contract (test/src/app/page.tsx)
// exactly, per test-contract.md §3-§5, so the ported Playwright suite (test/e2e) runs against
// this app nearly unchanged. Every data-testid, visible button text, and toast() call below is
// transcribed from test-contract.md's button inventory (§3.2) — do not "clean up" the
// duplicated/quirky bits (e.g. `action` vs `action-prevent` sharing visible text, the
// `default-button-top` button being an exact duplicate of `default-button`'s handler): they are
// upstream fixtures, not bugs.
import { h, ref, computed } from 'vue';
import { toast, Toaster } from '@michael-evrythngwrx/sonner-vue';

// ---------------------------------------------------------------------------------------------
// §4 — URL search-param contract, read SYNCHRONOUSLY at setup (no router, no async resolution).
// Playwright's page.goto() is a full navigation, so a plain window.location.search read at
// module/setup time is both sufficient and required (parity with Next's server-parsed
// searchParams prop, which is available before first render).
// ---------------------------------------------------------------------------------------------
const urlParams = new URLSearchParams(window.location.search);

type ThemeParam = 'light' | 'dark' | 'system';
type PositionParam = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';
type DirParam = 'rtl' | 'ltr' | 'auto';

// `searchParams.theme || 'light'` — falsy fallback (matches Next's `||`, not `??`): both an
// absent param (`null`) and an explicit empty value fall through to the default.
const initialTheme = (urlParams.get('theme') || 'light') as ThemeParam;
// theme is the one param that must be a *reactive* ref — test 19 flips it at runtime via
// theme-button and expects the already-rendered <Toaster>'s data-sonner-theme to follow.
const theme = ref<ThemeParam>(initialTheme);

// position/dir are read once and never change after mount (§4: "no requirement to watch the
// URL reactively after mount") — plain consts are sufficient; <script setup> top-level bindings
// are still exposed to the template regardless of reactivity.
const position = (urlParams.get('position') || 'bottom-right') as PositionParam;
const dir = (urlParams.get('dir') || 'auto') as DirParam;

// Exact-equality against '' (not mere presence) — a bare `?customCloseIcon` flag parses to ''.
const hasCustomCloseIcon = urlParams.get('customCloseIcon') === '';

// Custom close icon SVG (test-contract.md §5): byte-identical to the library's own default
// CloseIcon (state-api-spec.md §4.4) except strokeWidth is 3 here vs. the library default 1.5 —
// that's the whole point of the fixture, a visibly-different custom icon. Built once (a single
// static VNode, mirroring the upstream test app's single JSX element reused across renders) —
// the library's own renderNode() is responsible for cloneVNode()-ing it before each render.
const customCloseIcon = h(
  'svg',
  {
    xmlns: 'http://www.w3.org/2000/svg',
    width: '12',
    height: '12',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '3',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  },
  [h('line', { x1: '18', y1: '6', x2: '6', y2: '18' }), h('line', { x1: '6', y1: '6', x2: '18', y2: '18' })],
);
const icons = { close: hasCustomCloseIcon ? customCloseIcon : undefined };

// ---------------------------------------------------------------------------------------------
// §3.1 — local component state (React useState -> ref())
// ---------------------------------------------------------------------------------------------
const showAutoClose = ref(false);
const showDismiss = ref(false);
const isFinally = ref(false);
const showAriaLabels = ref(false);

// Primary Toaster's toastOptions must itself be reactive (AC-T6): closeButtonAriaLabel flips
// undefined -> 'Yeet the notice' when showAriaLabels flips, on the same already-mounted
// Toaster instance (test 31). A computed() re-evaluates on every read once showAriaLabels
// changes, keeping the prop value live.
const toastOptions = computed(() => ({
  actionButtonStyle: { backgroundColor: 'rgb(219, 239, 255)' },
  cancelButtonStyle: { backgroundColor: 'rgb(254, 226, 226)' },
  closeButtonAriaLabel: showAriaLabels.value ? 'Yeet the notice' : undefined,
}));

// ---------------------------------------------------------------------------------------------
// §5 — shared promise helper, reused by `promise` and `testid-promise-toast-button`.
// ---------------------------------------------------------------------------------------------
const promise = () => new Promise<void>((resolve) => setTimeout(resolve, 2000));

// §5 / D7 — rsf-promise stub. Upstream backs this with a Next.js Server Action + ai/rsc
// streamable UI; there is no Vue/Vite equivalent (no server runtime in a plain Vite SPA, see
// ARCHITECTURE.md D7 and test-contract.md §9 item 3). Stubbed with a plain setTimeout-resolved
// promise that keeps the same button/testid DOM contract. Not exercised by any of the 36 tests.
const rsfPromise = () => new Promise<string>((resolve) => setTimeout(() => resolve('load complete'), 1000));

// ---------------------------------------------------------------------------------------------
// §3.2 — button handlers, one per data-testid row.
// ---------------------------------------------------------------------------------------------
function handleThemeButton() {
  theme.value = 'dark';
}

function handleDefaultButton() {
  toast('My Toast');
}

function handleSuccess() {
  toast.success('My Success Toast');
}

function handleError() {
  toast.error('My Error Toast');
}

function handleAction() {
  toast('My Message', { action: { label: 'Action', onClick: () => console.log('Action') } });
}

function handleActionPrevent() {
  toast('My Message', {
    action: {
      label: 'Action',
      onClick: (event: MouseEvent) => {
        event.preventDefault();
        console.log('Action');
      },
    },
  });
}

function handlePromise() {
  toast.promise(promise, {
    loading: 'Loading...',
    success: 'Loaded',
    error: 'Error',
    finally: () => {
      isFinally.value = true;
    },
  });
}

function handleRsfPromise() {
  toast.promise(rsfPromise(), {
    loading: 'Loading...',
    success: 'Loaded',
    error: 'Error',
    finally: () => {
      isFinally.value = true;
    },
  });
}

function handleCustom() {
  toast.custom((id) =>
    h('div', [
      h('h1', 'jsx'),
      h(
        'button',
        {
          'data-testid': 'dismiss-button',
          onClick: () => toast.dismiss(id),
        },
        'Dismiss',
      ),
    ]),
  );
}

function handleCustomCancelButtonToast() {
  toast('My Custom Cancel Button', { cancel: { label: 'Cancel', onClick: () => console.log('Cancel') } });
}

// D6: nothing upstream renders `data-dismiss` (test 27's selector matches nothing in the real
// app), so the playground's own Dismiss button inside this toast carries `data-dismiss` as a
// deliberate, documented fixture addition — the ported Playwright spec stays byte-identical.
function handleCustomWithEmptyId() {
  toast.custom(
    (id) =>
      h('div', [
        h('h1', 'jsx'),
        h(
          'button',
          {
            'data-testid': 'dismiss-button',
            'data-dismiss': '',
            onClick: () => toast.dismiss(id),
          },
          'Dismiss',
        ),
      ]),
    { id: undefined },
  );
}

function handleInfinityToast() {
  toast('My Toast', { duration: Infinity });
}

function handleAutoCloseToastCallback() {
  toast('My Toast', {
    onAutoClose: () => {
      showAutoClose.value = true;
    },
  });
}

function handleDismissToastCallback() {
  toast('My Toast', {
    onDismiss: () => {
      showDismiss.value = true;
    },
  });
}

function handleNonDismissibleToast() {
  toast('My Toast', { dismissible: false });
}

function handleUpdateToast() {
  const toastId = toast('My Unupdated Toast', { duration: 10000 });
  toast('My Updated Toast', { id: toastId, duration: 10000 });
}

function handleUpdateToastDuration() {
  const toastId = toast('My Unupdated Toast, Updated After 3 Seconds', { duration: 10000 });
  setTimeout(() => {
    toast('My Updated Toast, Close After 1 Second', { id: toastId, duration: 1000 });
  }, 3000);
}

function handleStringDescription() {
  toast('Custom Description', { description: 'string description' });
}

function handleReactNodeDescription() {
  toast('Custom Description', {
    description: () => h('div', 'This is my custom ReactNode description'),
  });
}

function handleCloseButton() {
  toast('Toast with close button', { closeButton: true });
}

interface SonnerData {
  name: string;
}

function handleExtendedPromise() {
  toast.promise<SonnerData>(new Promise((resolve) => setTimeout(() => resolve({ name: 'Sonner' }), 2000)), {
    loading: 'Loading...',
    success: (data: SonnerData) => ({
      message: `${data.name} toast has been added`,
      description: 'Custom description for the Success state',
    }),
    error: {
      message: 'An error occurred',
      description: undefined,
      action: { label: 'Retry', onClick: () => console.log('retrying') },
    },
    description: 'Global description',
  });
}

function handleExtendedPromiseError() {
  toast.promise<SonnerData>(
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Simulated error')), 2000)),
    {
      loading: 'Loading...',
      success: (data: SonnerData) => ({
        message: `${data.name} toast has been added`,
        description: 'Custom description for the Success state',
      }),
      error: {
        message: 'An error occurred',
        description: undefined,
        action: {
          label: 'Retry',
          onClick: (event: MouseEvent) => {
            event.preventDefault();
            console.log('retrying');
          },
        },
      },
      description: 'Global description',
    },
  );
}

interface ProjectResult {
  ok?: boolean;
  error?: string;
}

async function whatWillHappen(): Promise<ProjectResult | undefined> {
  throw new Error('Not implemented');
}

function handleErrorPromise() {
  toast.promise(whatWillHappen, {
    loading: 'Saving project...',
    success: (result: ProjectResult | undefined) => (result?.ok ? 'Project saved' : `${result?.error}`),
    error: (e: unknown) => `Error Raise: ${e}`,
  });
}

function handleCustomAriaLabels() {
  showAriaLabels.value = true;
  toast('Toast with custom ARIA labels', {
    closeButton: true,
    onAutoClose: () => {
      showAriaLabels.value = false;
    },
  });
}

function handleToastSecondary() {
  toast('Secondary Toaster Toast', { toasterId: 'secondary' });
}

function handleToastGlobal() {
  toast('Global Toaster Toast');
}

function handleTestIdToastButton() {
  toast('Toast with test ID', { testId: 'my-test-toast' });
}

function handleTestIdPromiseToastButton() {
  toast.promise(promise, {
    loading: 'Loading...',
    success: 'Loaded',
    error: 'Error',
    testId: 'promise-test-toast',
  });
}
</script>

<template>
  <main>
    <h1>sonner-vue playground</h1>

    <button class="button" data-testid="theme-button" @click="handleThemeButton">Change theme</button>
    <button class="button" data-testid="default-button" @click="handleDefaultButton">Render Toast</button>
    <button class="button" data-testid="default-button-top" @click="handleDefaultButton">Render Toast Top</button>
    <button class="button" data-testid="success" @click="handleSuccess">Render Success Toast</button>
    <button class="button" data-testid="error" @click="handleError">Render Error Toast</button>
    <button class="button" data-testid="action" @click="handleAction">Render Action Toast</button>
    <button class="button" data-testid="action-prevent" @click="handleActionPrevent">Render Action Toast</button>
    <button class="button" data-testid="promise" :data-finally="isFinally ? '1' : '0'" @click="handlePromise">
      Render Promise Toast
    </button>
    <button
      class="button"
      data-testid="rsf-promise"
      :data-finally="isFinally ? '1' : '0'"
      @click="handleRsfPromise"
    >
      Render React Server Function Toast
    </button>
    <button class="button" data-testid="custom" @click="handleCustom">Render Custom Toast</button>
    <button class="button" data-testid="custom-cancel-button-toast" @click="handleCustomCancelButtonToast">
      Render Custom Cancel Button
    </button>
    <button class="button" data-testid="custom-with-empty-id" @click="handleCustomWithEmptyId">
      Render Custom Toast with empty id
    </button>
    <button class="button" data-testid="infinity-toast" @click="handleInfinityToast">Render Infinity Toast</button>
    <button class="button" data-testid="auto-close-toast-callback" @click="handleAutoCloseToastCallback">
      Render Toast With onAutoClose callback
    </button>
    <button class="button" data-testid="dismiss-toast-callback" @click="handleDismissToastCallback">
      Dismiss toast callback
    </button>
    <button class="button" data-testid="non-dismissible-toast" @click="handleNonDismissibleToast">
      Non-dismissible Toast
    </button>
    <button class="button" data-testid="update-toast" @click="handleUpdateToast">Updated Toast</button>
    <button class="button" data-testid="update-toast-duration" @click="handleUpdateToastDuration">
      Updated Toast Duration
    </button>
    <button class="button" data-testid="string-description" @click="handleStringDescription">
      String Description
    </button>
    <button class="button" data-testid="react-node-description" @click="handleReactNodeDescription">
      ReactNode Description
    </button>
    <button class="button" data-testid="close-button" @click="handleCloseButton">Render close button</button>
    <button class="button" data-testid="extended-promise" @click="handleExtendedPromise">
      Extended Promise Toast
    </button>
    <button class="button" data-testid="extended-promise-error" @click="handleExtendedPromiseError">
      Extended Promise Error Toast
    </button>
    <button class="button" data-testid="error-promise" @click="handleErrorPromise">Error Promise Toast</button>
    <!-- No data-testid on purpose (test-contract.md §3.2) — located via getByRole('button', { name: ... }). -->
    <button class="button" @click="handleCustomAriaLabels">With custom ARIA labels</button>
    <button class="button" data-testid="toast-secondary" @click="handleToastSecondary">
      Render Toast in Secondary Toaster
    </button>
    <button class="button" data-testid="toast-global" @click="handleToastGlobal">
      Render Toast in Global Toaster
    </button>
    <button class="button" data-testid="testid-toast-button" @click="handleTestIdToastButton">
      Toast with testId
    </button>
    <button class="button" data-testid="testid-promise-toast-button" @click="handleTestIdPromiseToastButton">
      Promise Toast with testId
    </button>

    <div v-if="showAutoClose" data-testid="auto-close-el" />
    <div v-if="showDismiss" data-testid="dismiss-el" />

    <!-- Primary / global Toaster (test-contract.md §3.3) — no `id` prop, receives every toast
         that was not created with a `toasterId`. -->
    <Toaster
      :offset="32"
      :position="position"
      :toast-options="toastOptions"
      :theme="theme"
      :dir="dir"
      :container-aria-label="showAriaLabels ? 'Notices' : undefined"
      :icons="icons"
    />

    <!-- Secondary Toaster (test-contract.md §3.3) — id="secondary", only receives toasts
         created with { toasterId: 'secondary' }. Everything else is library default. -->
    <Toaster id="secondary" position="top-left" :toast-options="{ className: 'secondary-toaster' }" />
  </main>
</template>
