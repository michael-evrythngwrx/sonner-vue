import { expect, test, type Locator } from '@playwright/test';

/**
 * DOM-parity regression lock — sonner-vue must serialize its `data-*` attributes BYTE-FOR-BYTE
 * the way React serializes sonner-react's.
 *
 * This file is NOT a port of an upstream spec (upstream has none for this); it is a
 * sonner-vue-specific guard against a class of bug that Vue makes easy to reintroduce. Every
 * expected value below is derived from upstream `src/index.tsx` (referenced by line as
 * `index.tsx:NNN`) and React's own attribute-serialization rules — never from sonner-vue's
 * implementation. The two rules that matter:
 *
 *   1. A bare JSX attribute (`data-button`) is `={true}`. For an unknown/`data-*` attribute React
 *      stringifies the value, so it lands in the DOM as `data-button="true"` — NOT `data-button=""`.
 *      Vue's template equivalent (`data-button` with no value) is an EMPTY-STRING attribute, which
 *      is why the port has to write `data-button="true"` explicitly.
 *   2. `null`/`undefined` values are OMITTED entirely, but `false` is serialized as the string
 *      `"false"`. So `data-invert={undefined}` renders no attribute at all while
 *      `data-invert={false}` renders `data-invert="false"`. Vue's Boolean-prop runtime casting
 *      silently turns an absent optional boolean prop into `false`, collapsing that distinction —
 *      hence the explicit `undefined` prop defaults in Toaster.vue.
 *
 * An attribute upstream writes as `=""` (`data-sonner-toast=""`, index.tsx:274) must stay `""`;
 * the fix for rule 1 must not overshoot into those.
 */

/** Every attribute of the first matching element, as a plain record. */
function attributes(locator: Locator): Promise<Record<string, string>> {
  return locator.evaluate((el) =>
    Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value])),
  );
}

/**
 * Exact serialization assertion. Keys mapped to a string must be present with EXACTLY that value;
 * keys mapped to `null` must be absent from the element entirely (React's omit-on-nullish), which
 * is the same thing `getAttribute(name) === null` reports.
 */
async function expectSerialization(locator: Locator, expected: Record<string, string | null>) {
  const attrs = await attributes(locator);
  const actual: Record<string, string | null> = {};
  for (const key of Object.keys(expected)) {
    actual[key] = key in attrs ? attrs[key] : null;
  }
  expect(actual).toEqual(expected);
}

/** The single rendered toast, once its mount effect (index.tsx:149-152) has flipped data-mounted. */
async function mountedToast(page: import('@playwright/test').Page): Promise<Locator> {
  const li = page.locator('[data-sonner-toast]');
  await expect(li).toHaveCount(1);
  await expect(li).toHaveAttribute('data-mounted', 'true');
  return li;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('DOM parity: boolean data-* serialization', () => {
  test('action button serializes data-button/data-action as "true"', async ({ page }) => {
    // index.tsx:487-489 — <button data-button data-action> => data-button="true" data-action="true".
    await page.getByTestId('action').click();
    const button = page.locator('[data-sonner-toast] button[data-action]');
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute('data-button', 'true');
    await expect(button).toHaveAttribute('data-action', 'true');
    // index.tsx:487-489 renders no data-cancel on the action button.
    await expect(button).not.toHaveAttribute('data-cancel');
    // Regression lock on the exact defect: the empty-string form must never come back.
    await expect(page.locator('[data-sonner-toast] [data-button=""]')).toHaveCount(0);
    await expect(page.locator('[data-sonner-toast] [data-action=""]')).toHaveCount(0);
    await expectSerialization(button, {
      'data-button': 'true',
      'data-action': 'true',
      'data-cancel': null,
    });
  });

  test('cancel button serializes data-button/data-cancel as "true"', async ({ page }) => {
    // index.tsx:468-470 — <button data-button data-cancel>.
    await page.getByTestId('custom-cancel-button-toast').click();
    const button = page.locator('[data-sonner-toast] button[data-cancel]');
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute('data-button', 'true');
    await expect(button).toHaveAttribute('data-cancel', 'true');
    await expect(button).not.toHaveAttribute('data-action');
    await expect(page.locator('[data-sonner-toast] [data-button=""]')).toHaveCount(0);
    await expect(page.locator('[data-sonner-toast] [data-cancel=""]')).toHaveCount(0);
    await expectSerialization(button, {
      'data-button': 'true',
      'data-cancel': 'true',
      'data-action': null,
    });
  });

  test('close button serializes data-close-button="true" and data-disabled="false"', async ({ page }) => {
    // index.tsx:420-423 — data-disabled={disabled} (disabled = toastType === 'loading',
    // index.tsx:141) and a BARE data-close-button. A non-loading toast therefore renders
    // data-disabled="false" (present, not omitted — `false` is not nullish) next to
    // data-close-button="true". aria-label default is 'Close toast' (index.tsx:90).
    await page.getByTestId('close-button').click();
    const button = page.locator('[data-sonner-toast] button[data-close-button]');
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute('data-close-button', 'true');
    await expect(page.locator('[data-sonner-toast] [data-close-button=""]')).toHaveCount(0);
    await expectSerialization(button, {
      'data-close-button': 'true',
      'data-disabled': 'false',
      'aria-label': 'Close toast',
      'data-button': null,
    });
  });

  test('container-level bare attributes serialize as "true"', async ({ page }) => {
    // index.tsx:783 — <section ... data-react-aria-top-layer>; index.tsx:797 — <ol data-sonner-toaster>.
    // Both are bare JSX attributes, so both are "true" in the DOM.
    await page.getByTestId('default-button').click();
    await mountedToast(page);

    const section = page.locator('[data-react-aria-top-layer]').first();
    await expect(section).toHaveAttribute('data-react-aria-top-layer', 'true');

    const list = page.locator('[data-sonner-toaster]');
    await expect(list).toHaveCount(1);
    await expect(list).toHaveAttribute('data-sonner-toaster', 'true');
    // index.tsx:798-800 — theme/position attributes are plain strings.
    await expectSerialization(list, {
      'data-sonner-toaster': 'true',
      'data-sonner-theme': 'light',
      'data-y-position': 'bottom',
      'data-x-position': 'right',
    });
  });

  test('attributes upstream writes as "" stay empty strings', async ({ page }) => {
    // The inverse guard: index.tsx:274 (data-sonner-toast=""), :441 (data-icon=""),
    // :447 (data-content=""), :448 (data-title=""), :453 (data-description="") are EXPLICIT
    // empty strings in JSX and must not be "corrected" to "true".
    await page.getByTestId('success').click();
    const li = await mountedToast(page);
    await expectSerialization(li, { 'data-sonner-toast': '' });
    await expectSerialization(li.locator('[data-icon]'), { 'data-icon': '' });
    await expectSerialization(li.locator('[data-content]'), { 'data-content': '' });
    await expectSerialization(li.locator('[data-title]'), { 'data-title': '' });

    await page.goto('/');
    await page.getByTestId('string-description').click();
    const described = await mountedToast(page);
    await expectSerialization(described.locator('[data-description]'), { 'data-description': '' });
  });
});

test.describe('DOM parity: omitted vs "false" attributes', () => {
  // NOTE ON UNREACHABLE COVERAGE: the playground exposes no path — no button, no URL search
  // param — that sets `invert`, `richColors`, or `unstyled` on either <Toaster> or on an
  // individual toast, and the playground must not be modified for this spec. So the
  // explicitly-set half of the contract (`data-invert="false"` for an EXPLICIT
  // `invert={false}`, `"true"` for `invert`, and the same for rich colors) is NOT asserted
  // here; only the unset -> omitted half is reachable. Upstream semantics for the unreachable
  // half, for whoever wires up a fixture later: index.tsx:140 `const invert = toast.invert ||
  // ToasterInvert` (a per-toast `false` cannot override a toaster-level `true`), so an explicit
  // toaster-level `invert={false}` yields `data-invert="false"`, while BOTH being undefined
  // yields no attribute; index.tsx:275 `toast.richColors ?? defaultRichColors` (nullish, not
  // `||`) yields `data-rich-colors="false"` for an explicit `false` at either level.

  test('data-rich-colors and data-invert are absent when nothing sets them', async ({ page }) => {
    // index.tsx:275 data-rich-colors={toast.richColors ?? defaultRichColors} and :289
    // data-invert={invert}. The playground's <Toaster>s pass neither prop, and none of these
    // toasts sets a per-toast override, so both resolve to `undefined` and React emits NO
    // attribute. `false` here would be a bug (that is the Vue Boolean-cast trap).
    for (const testId of ['default-button', 'success', 'custom']) {
      await page.goto('/');
      await page.getByTestId(testId).click();
      const li = await mountedToast(page);

      await expect(li).not.toHaveAttribute('data-rich-colors');
      await expect(li).not.toHaveAttribute('data-invert');
      expect(await li.getAttribute('data-rich-colors')).toBeNull();
      expect(await li.getAttribute('data-invert')).toBeNull();
      await expectSerialization(li, { 'data-rich-colors': null, 'data-invert': null });
    }
  });

  test('a second <Toaster> instance also omits data-rich-colors/data-invert', async ({ page }) => {
    // The playground's secondary <Toaster id="secondary"> only sets position + toastOptions, so
    // it must behave identically — this catches a per-instance prop-default regression.
    await page.getByTestId('toast-secondary').click();
    const li = await mountedToast(page);
    await expect(li).toHaveClass('secondary-toaster');
    await expect(li).not.toHaveAttribute('data-rich-colors');
    await expect(li).not.toHaveAttribute('data-invert');
    await expectSerialization(li, {
      'data-rich-colors': null,
      'data-invert': null,
      // index.tsx:282-283 — position="top-left" splits into y/x.
      'data-y-position': 'top',
      'data-x-position': 'left',
    });
  });

  test('data-type is omitted for an untyped toast and stringified for typed ones', async ({ page }) => {
    // index.tsx:288 data-type={toastType} where toastType = toast.type (index.tsx:106).
    // `toast('...')` never sets `type` (state.ts message() -> create({ ...data, message })),
    // so the attribute is omitted; the typed factories set it explicitly.
    await page.getByTestId('default-button').click();
    let li = await mountedToast(page);
    await expect(li).not.toHaveAttribute('data-type');

    await page.goto('/');
    await page.getByTestId('success').click();
    li = await mountedToast(page);
    await expect(li).toHaveAttribute('data-type', 'success');

    await page.goto('/');
    await page.getByTestId('error').click();
    li = await mountedToast(page);
    await expect(li).toHaveAttribute('data-type', 'error');
  });

  test('data-testid is omitted unless toast.testId is set', async ({ page }) => {
    // index.tsx:293 data-testid={toast.testId}.
    await page.getByTestId('default-button').click();
    await expect(await mountedToast(page)).not.toHaveAttribute('data-testid');

    await page.goto('/');
    await page.getByTestId('testid-toast-button').click();
    await expect(page.locator('[data-sonner-toast]')).toHaveAttribute('data-testid', 'my-test-toast');
  });

  test('data-promise is "false"/"true", never omitted', async ({ page }) => {
    // index.tsx:278 data-promise={Boolean(toast.promise)} — Boolean() means the attribute is
    // ALWAYS present, as "false" for a plain toast and "true" for a promise toast.
    await page.getByTestId('default-button').click();
    await expect(await mountedToast(page)).toHaveAttribute('data-promise', 'false');

    await page.goto('/');
    await page.getByTestId('promise').click();
    await expect(page.locator('[data-sonner-toast]')).toHaveAttribute('data-promise', 'true');
  });

  test('data-styled is "true" for a styled toast and "false" for a jsx toast', async ({ page }) => {
    // index.tsx:276 data-styled={!Boolean(toast.jsx || toast.unstyled || unstyled)}.
    await page.getByTestId('default-button').click();
    await expect(await mountedToast(page)).toHaveAttribute('data-styled', 'true');

    await page.goto('/');
    await page.getByTestId('custom').click(); // toast.custom() sets toast.jsx
    await expect(await mountedToast(page)).toHaveAttribute('data-styled', 'false');
  });

  test('data-dismissible is "false" for a non-dismissible toast', async ({ page }) => {
    // index.tsx:287 data-dismissible={dismissible} where dismissible = toast.dismissible !== false
    // (index.tsx:107) — a boolean, so always present.
    await page.getByTestId('non-dismissible-toast').click();
    await expect(await mountedToast(page)).toHaveAttribute('data-dismissible', 'false');
  });
});

test.describe('DOM parity: fresh-toast lifecycle attributes', () => {
  test('a fresh toast carries the full upstream lifecycle attribute set', async ({ page }) => {
    // duration: Infinity keeps the toast alive for the whole assertion (index.tsx:198/217).
    await page.getByTestId('infinity-toast').click();
    const li = await mountedToast(page);

    // Derived one-for-one from index.tsx:274-293 for a single, freshly mounted, untyped,
    // non-promise, dismissible toast at index 0 in a bottom-right toaster:
    //   :274 data-sonner-toast=""              (explicit empty string)
    //   :275 data-rich-colors={undefined}      -> omitted
    //   :276 data-styled={!Boolean(...)}       -> "true"
    //   :277 data-mounted={mounted}            -> "true" once the mount effect ran
    //   :278 data-promise={Boolean(undefined)} -> "false"
    //   :279 data-swiped={isSwiped}            -> "false"
    //   :280 data-removed={removed}            -> "false"
    //   :281 data-visible={index + 1 <= visibleToasts} -> "true"
    //   :282/:283 data-y-position/data-x-position from position.split('-')
    //   :284 data-index={index}                -> "0"
    //   :285 data-front={index === 0}          -> "true"
    //   :286 data-swiping={swiping}            -> "false"
    //   :287 data-dismissible={dismissible}    -> "true"
    //   :288 data-type={undefined}             -> omitted
    //   :289 data-invert={undefined}           -> omitted
    //   :290 data-swipe-out={swipeOut}         -> "false"
    //   :291 data-swipe-direction={null}       -> omitted
    //   :292 data-expanded={Boolean(...)}      -> "false"
    //   :293 data-testid={undefined}           -> omitted
    await expectSerialization(li, {
      'data-sonner-toast': '',
      'data-rich-colors': null,
      'data-styled': 'true',
      'data-mounted': 'true',
      'data-promise': 'false',
      'data-swiped': 'false',
      'data-removed': 'false',
      'data-visible': 'true',
      'data-y-position': 'bottom',
      'data-x-position': 'right',
      'data-index': '0',
      'data-front': 'true',
      'data-swiping': 'false',
      'data-dismissible': 'true',
      'data-type': null,
      'data-invert': null,
      'data-swipe-out': 'false',
      'data-swipe-direction': null,
      'data-expanded': 'false',
      'data-testid': null,
    });
  });

  test('data-front/data-index/data-visible track stacking order', async ({ page }) => {
    // index.tsx:104-105 — isFront = index === 0, isVisible = index + 1 <= visibleToasts. New
    // toasts are unshifted to the front (state.ts addToast), so the newest is index 0.
    await page.getByTestId('infinity-toast').click();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
    await page.getByTestId('infinity-toast').click();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(2);

    const toasts = page.locator('[data-sonner-toast]');
    await expectSerialization(toasts.nth(0), {
      'data-index': '0',
      'data-front': 'true',
      'data-visible': 'true',
    });
    await expectSerialization(toasts.nth(1), {
      'data-index': '1',
      'data-front': 'false',
      'data-visible': 'true',
    });
  });
});

test.describe('DOM parity: supplemental coverage', () => {
  // Upstream's own `dismissible toast is not removed when dragged` (test/tests/basic.spec.ts:96)
  // asserts `page.getByTestId('non-dismissible-toast')` still has count 1 — but that test id
  // belongs to the trigger BUTTON in the page, not to the toast, so the assertion holds no
  // matter what the drag did. basic.spec.ts stays byte-identical to upstream, so the real
  // assertion lives here instead: the TOAST itself must survive the drag.
  test('a non-dismissible toast survives a drag that would dismiss a normal toast', async ({ page }) => {
    // Control: a dismissible toast IS removed by this gesture (upstream basic.spec.ts:87-94).
    await page.getByTestId('default-button').click();
    await page.hover('[data-sonner-toast]');
    await page.mouse.down();
    await page.mouse.move(0, 800);
    await page.mouse.up();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

    // Subject: same gesture, dismissible: false.
    await page.goto('/');
    await page.getByTestId('non-dismissible-toast').click();
    const li = await mountedToast(page);
    const box = await li.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(0, box!.y + 300);
    await page.mouse.up();

    // index.tsx:107/287 + the pointer handlers' `if (!dismissible) return` guards: the toast
    // stays in the DOM and no swipe state is recorded.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
    await expect(li).toBeVisible();
    await expectSerialization(li, {
      'data-dismissible': 'false',
      'data-removed': 'false',
      'data-swiped': 'false',
      'data-swiping': 'false',
      'data-swipe-out': 'false',
    });
  });
});
