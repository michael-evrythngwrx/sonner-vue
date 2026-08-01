/**
 * `src/types.ts` runtime surface (state-api-spec.md §1.1) plus the `src/index.ts` public entry
 * contract (ARCHITECTURE.md "Repo layout" / public export list).
 *
 * `types.ts` is almost entirely type-level; the only two runtime artifacts it emits are the
 * `isAction` type guard and the `SwipeStateTypes` string enum. Both are ported byte-identically
 * from `sonner-react/src/types.ts` and neither is touched by the 36 Playwright specs.
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import * as publicApi from '../../src/index';
import { SwipeStateTypes, isAction } from '../../src/types';
import type { Action, Renderable } from '../../src/types';
import { toast } from '../../src/state';
import { useSonner } from '../../src/hooks';

describe('isAction type guard (§1.1)', () => {
  it('accepts a full Action object', () => {
    const action: Action = { label: 'Undo', onClick: () => {} };
    expect(isAction(action)).toBe(true);
  });

  it('QUIRK: the guard checks ONLY `label !== undefined` — `onClick` is never inspected', () => {
    expect(isAction({ label: 'Undo' } as unknown as Action)).toBe(true);
  });

  it.each([
    ['falsy but defined label 0', { label: 0 }],
    ['falsy but defined label ""', { label: '' }],
    ['falsy but defined label false', { label: false }],
  ])('treats a %s as an Action (`!== undefined`, not truthiness)', (_name, value) => {
    expect(isAction(value as unknown as Action)).toBe(true);
  });

  it('rejects an object with an explicitly undefined label', () => {
    expect(isAction({ label: undefined, onClick: () => {} } as unknown as Action)).toBe(false);
  });

  it('rejects a plain object with no label', () => {
    expect(isAction({} as unknown as Action)).toBe(false);
  });

  it.each([
    ['string', 'Undo'],
    ['number', 42],
  ])('rejects a bare %s Renderable', (_name, value) => {
    expect(isAction(value as Renderable)).toBe(false);
  });

  it('rejects a VNode', () => {
    expect(isAction(h('button', 'Undo'))).toBe(false);
  });

  it('rejects a Vue component definition', () => {
    expect(isAction(defineComponent({ render: () => h('button') }))).toBe(false);
  });
});

describe('SwipeStateTypes enum (§1.1)', () => {
  it('has the three upstream string values', () => {
    expect(SwipeStateTypes.SwipedOut).toBe('SwipedOut');
    expect(SwipeStateTypes.SwipedBack).toBe('SwipedBack');
    expect(SwipeStateTypes.NotSwiped).toBe('NotSwiped');
  });

  it('is a string enum, so it has no reverse mapping', () => {
    expect(Object.keys(SwipeStateTypes)).toEqual(['SwipedOut', 'SwipedBack', 'NotSwiped']);
    expect((SwipeStateTypes as unknown as Record<string, unknown>).SwipedOut).toBe('SwipedOut');
  });
});

describe('public entry surface (ARCHITECTURE.md)', () => {
  it('exports exactly { toast, Toaster, useSonner } at runtime (everything else is type-only)', () => {
    expect(Object.keys(publicApi).sort()).toEqual(['Toaster', 'toast', 'useSonner']);
  });

  it('re-exports the same `toast` singleton as src/state.ts', () => {
    expect(publicApi.toast).toBe(toast);
  });

  it('re-exports the same `useSonner` composable as src/hooks.ts', () => {
    expect(publicApi.useSonner).toBe(useSonner);
  });

  it('exports `Toaster` as a Vue component', () => {
    expect(publicApi.Toaster).toBeTruthy();
    expect(['object', 'function']).toContain(typeof publicApi.Toaster);
  });
});
