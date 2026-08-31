// Configurable combo minimum/maximum selections — the full behaviour matrix.
// Pure logic shared by the customer builder, admin validation and cart merge.

import { describe, expect, it } from 'vitest';
import {
  atSelectionLimit,
  describeComboRule,
  enoughOptionsFor,
  isValidRule,
  selectionCountError,
  type SelectionRule,
} from './comboRules';
import { validateChoiceGroups } from '../admin/ComboEditor';
import { lineKey } from '../cart';

const rule = (minSelections: number, maxSelections: number): SelectionRule => ({ minSelections, maxSelections });

describe('selection rule matrix', () => {
  const cases: Array<{ rule: SelectionRule; label: string; under: number[]; ok: number[]; over: number[] }> = [
    { rule: rule(0, 0), label: '0/0 — nothing selectable', under: [], ok: [0], over: [1, 2] },
    { rule: rule(0, 6), label: '0/6 — fully optional up to six', under: [], ok: [0, 1, 3, 6], over: [7] },
    { rule: rule(1, 1), label: '1/1 — existing combo groups (unchanged)', under: [0], ok: [1], over: [2] },
    { rule: rule(1, 3), label: '1/3 — at least one, up to three', under: [0], ok: [1, 2, 3], over: [4] },
    { rule: rule(2, 2), label: '2/2 — Vizio Duo (exactly two)', under: [0, 1], ok: [2], over: [3] },
    { rule: rule(3, 5), label: '3/5 — at least three, up to five', under: [0, 1, 2], ok: [3, 4, 5], over: [6] },
    { rule: rule(6, 6), label: '6/6 — exactly six', under: [0, 5], ok: [6], over: [7] },
  ];

  for (const { rule: r, label, under, ok, over } of cases) {
    it(label, () => {
      expect(isValidRule(r)).toBe(true);
      for (const count of under) expect(selectionCountError(r, count)).toBe('under'); // cannot submit below minimum
      for (const count of ok) expect(selectionCountError(r, count)).toBeNull();
      for (const count of over) expect(selectionCountError(r, count)).toBe('over'); // cannot exceed maximum
      if (r.maxSelections > 0) {
        expect(atSelectionLimit(r, r.maxSelections)).toBe(true); // the (max+1)-th tick is refused
        expect(atSelectionLimit(r, r.maxSelections - 1)).toBe(false); // one below max is never blocked
      }
    });
  }

  it('rejects invalid configurations (minimum > maximum, negatives)', () => {
    expect(isValidRule(rule(3, 2))).toBe(false);
    expect(isValidRule(rule(-1, 2))).toBe(false);
    expect(isValidRule(rule(0, -1))).toBe(false);
  });
});

describe('customer-facing rule text', () => {
  it('communicates the requirement clearly', () => {
    expect(describeComboRule(rule(3, 5))).toBe('Choose 3–5');
    expect(describeComboRule(rule(2, 2))).toBe('Choose exactly 2');
    expect(describeComboRule(rule(1, 1))).toBe('Choose 1');
    expect(describeComboRule(rule(1, 3))).toBe('Choose 1–3');
    expect(describeComboRule(rule(0, 4))).toBe('Choose up to 4 (optional)');
    expect(describeComboRule(rule(0, 0))).toBe('None');
  });
});

describe('admin editor validation', () => {
  const group = (over: Partial<{ name: string; minSelections: number; maxSelections: number; options: unknown[] }>) => ({
    id: 'g1', name: 'Choose your sides', displayOrder: 0, inheritExtras: false, active: true,
    options: [], ...over,
  }) as never;

  it('accepts the configured example groups', () => {
    expect(validateChoiceGroups([
      group({ name: 'Choose Your Pizza', minSelections: 2, maxSelections: 2, options: [{ productId: 'a' }, { productId: 'b' }] }),
      group({ name: 'Choose Your Drink', minSelections: 2, maxSelections: 2, options: [{ productId: 'c' }, { productId: 'd' }] }),
    ])).toBeNull();
    expect(validateChoiceGroups([
      group({ name: 'Choose Your Sides', minSelections: 0, maxSelections: 4, options: [{ productId: 'e' }] }),
    ])).toBeNull();
  });

  it('blocks minimum > maximum', () => {
    expect(validateChoiceGroups([group({ minSelections: 5, maxSelections: 3 })])).toContain('must not exceed');
  });

  it('blocks a minimum the eligible products cannot satisfy', () => {
    expect(validateChoiceGroups([group({ minSelections: 3, maxSelections: 6, options: [{ productId: 'a' }] })])).toContain('at least 3');
  });

  it('keeps existing 1/1 groups valid', () => {
    expect(validateChoiceGroups([group({ minSelections: 1, maxSelections: 1, options: [{ productId: 'a' }] })])).toBeNull();
  });
});

describe('enoughOptionsFor', () => {
  it('requires options to cover the minimum; 0/0 needs none', () => {
    expect(enoughOptionsFor(rule(3, 6), 3)).toBe(true);
    expect(enoughOptionsFor(rule(3, 6), 2)).toBe(false);
    expect(enoughOptionsFor(rule(0, 0), 0)).toBe(true);
    expect(enoughOptionsFor(rule(0, 4), 0)).toBe(true);
  });
});

describe('cart merge with multi-selection groups', () => {
  const selection = (groupId: string, productId: string) => ({ groupId, groupName: groupId, productId, productName: productId, upgrade: 0 });

  it('identical selections in different tick order merge into one line', () => {
    const a = { productId: 'combo', modifiers: [], instructions: '', combo: [selection('g1', 'p1'), selection('g1', 'p2')] };
    const b = { productId: 'combo', modifiers: [], instructions: '', combo: [selection('g1', 'p2'), selection('g1', 'p1')] };
    expect(lineKey(a)).toBe(lineKey(b));
  });

  it('different selections stay separate lines', () => {
    const a = { productId: 'combo', modifiers: [], instructions: '', combo: [selection('g1', 'p1'), selection('g1', 'p2')] };
    const b = { productId: 'combo', modifiers: [], instructions: '', combo: [selection('g1', 'p1'), selection('g1', 'p3')] };
    expect(lineKey(a)).not.toBe(lineKey(b));
  });
});
