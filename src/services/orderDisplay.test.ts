import { describe, expect, it } from 'vitest';

import {
  MISSING_ITEM_LABEL,
  containsUuid,
  nameLookupFromRows,
  normaliseDisplayText,
  normaliseModifierLines,
  normaliseOrderItem,
  type NameLookup,
} from './orderDisplay';

const PASTA_ID = '5acc3cbb-2df5-4c01-b808-ee1f2fc3aedf';
const DRINK_ID = '5959fcb0-7c99-4933-9843-5e28f68a8f16';
const GONE_ID = '00000000-1111-4222-8333-444444444444';

const names: NameLookup = new Map([
  [PASTA_ID, 'Fusilli al Pesto'],
  [DRINK_ID, 'Iced Tea Lemon'],
]);

describe('containsUuid', () => {
  it('recognises UUID-shaped strings', () => {
    expect(containsUuid(PASTA_ID)).toBe(true);
    expect(containsUuid(PASTA_ID.toUpperCase())).toBe(true);
  });

  it('passes through real names', () => {
    expect(containsUuid('Fusilli al Pesto')).toBe(false);
    expect(containsUuid('Choose your pasta: Carbonara')).toBe(false);
    expect(containsUuid('')).toBe(false);
  });
});

describe('normaliseDisplayText', () => {
  it('leaves plain display text untouched', () => {
    expect(normaliseDisplayText('Extra pasta', names)).toBe('Extra pasta');
    expect(normaliseDisplayText('Choose your drink: Pepsi Max', names)).toBe('Choose your drink: Pepsi Max');
  });

  it('resolves a UUID suffix to the product name (the legacy combo-case bug)', () => {
    expect(normaliseDisplayText(`Choose your pasta: ${PASTA_ID}`, names)).toBe('Choose your pasta: Fusilli al Pesto');
  });

  it('resolves a bare UUID line to just the product name', () => {
    expect(normaliseDisplayText(PASTA_ID, names)).toBe('Fusilli al Pesto');
  });

  it('resolves several UUIDs inside one line', () => {
    expect(normaliseDisplayText(`${PASTA_ID} + ${DRINK_ID}`, names)).toBe('Fusilli al Pesto + Iced Tea Lemon');
  });

  it('never shows a UUID when the product no longer exists', () => {
    expect(normaliseDisplayText(`Choose your pasta: ${GONE_ID}`, names)).toBe(`Choose your pasta: ${MISSING_ITEM_LABEL}`);
    expect(normaliseDisplayText(GONE_ID, names)).toBe(MISSING_ITEM_LABEL);
  });

  it('matches UUID tokens case-insensitively', () => {
    expect(normaliseDisplayText(`Choose your pasta: ${PASTA_ID.toUpperCase()}`, names)).toBe('Choose your pasta: Fusilli al Pesto');
  });

  it('returns empty strings unchanged', () => {
    expect(normaliseDisplayText('', names)).toBe('');
  });
});

describe('normaliseModifierLines', () => {
  it('normalises every line and keeps order', () => {
    expect(normaliseModifierLines(
      [`Choose your pasta: ${PASTA_ID}`, 'Extra pasta', `Choose your drink: ${DRINK_ID}`],
      names,
    )).toEqual(['Choose your pasta: Fusilli al Pesto', 'Extra pasta', 'Choose your drink: Iced Tea Lemon']);
  });
});

describe('normaliseOrderItem', () => {
  it('repairs a legacy combo item end to end', () => {
    const item = {
      id: 'row-1',
      name: 'Pasta Lunch Combo',
      quantity: 1,
      unitPrice: 25,
      notes: '',
      modifiers: [`Choose your pasta: ${PASTA_ID}`, `Choose your drink: ${DRINK_ID}`],
    };
    expect(normaliseOrderItem(item, names)).toEqual({
      id: 'row-1',
      name: 'Pasta Lunch Combo',
      quantity: 1,
      unitPrice: 25,
      notes: '',
      modifiers: ['Choose your pasta: Fusilli al Pesto', 'Choose your drink: Iced Tea Lemon'],
    });
  });

  it('repairs a UUID item name and never mutates pricing fields', () => {
    const item = { name: PASTA_ID, quantity: 3, unitPrice: 17.5, modifiers: [] };
    const fixed = normaliseOrderItem(item, names);
    expect(fixed.name).toBe('Fusilli al Pesto');
    expect(fixed.quantity).toBe(3);
    expect(fixed.unitPrice).toBe(17.5);
  });

  it('handles multiple quantities and repeated selections independently', () => {
    const item = { name: 'VIZIO DUO', quantity: 2, unitPrice: 36, modifiers: [`choice of pizza 1: ${GONE_ID}`, `choice of pizza 2: ${DRINK_ID}`] };
    expect(normaliseOrderItem(item, names).modifiers).toEqual([
      `choice of pizza 1: ${MISSING_ITEM_LABEL}`,
      'choice of pizza 2: Iced Tea Lemon',
    ]);
  });
});

describe('nameLookupFromRows', () => {
  it('builds a lowercase-keyed lookup from raw select rows', () => {
    const lookup = nameLookupFromRows([{ id: PASTA_ID, name: 'Fusilli al Pesto' }, { id: DRINK_ID.toUpperCase(), name: 'Iced Tea Lemon' }]);
    expect(lookup.get(PASTA_ID)).toBe('Fusilli al Pesto');
    expect(normaliseDisplayText(DRINK_ID, lookup)).toBe('Iced Tea Lemon');
  });
});
