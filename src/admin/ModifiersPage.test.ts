import { describe, expect, it } from 'vitest';
import { parseModifierPrice } from './ModifiersPage';

// The price field edits as text; these tests pin the save-time conversion:
// intermediate states stay typable in the UI, only Number() semantics at save.
describe('parseModifierPrice', () => {
  it('treats an empty field as 0 (established default)', () => {
    expect(parseModifierPrice('')).toEqual({ price: 0 });
    expect(parseModifierPrice('   ')).toEqual({ price: 0 });
  });
  it('accepts valid decimal prices exactly as typed', () => {
    expect(parseModifierPrice('0')).toEqual({ price: 0 });
    expect(parseModifierPrice('2')).toEqual({ price: 2 });
    expect(parseModifierPrice('2.5')).toEqual({ price: 2.5 });
    expect(parseModifierPrice('2.50')).toEqual({ price: 2.5 });
    expect(parseModifierPrice('2.')).toEqual({ price: 2 });
    expect(parseModifierPrice(' 4.75 ')).toEqual({ price: 4.75 });
  });
  it('rejects negative and non-numeric prices with a clear error', () => {
    expect(parseModifierPrice('-1')).toEqual({ error: 'Price cannot be negative.' });
    expect(parseModifierPrice('-0.5')).toEqual({ error: 'Price cannot be negative.' });
    expect(parseModifierPrice('abc')).toEqual({ error: 'Enter a valid price (e.g. 2.50).' });
    expect(parseModifierPrice('2,50')).toEqual({ error: 'Enter a valid price (e.g. 2.50).' });
  });
});
