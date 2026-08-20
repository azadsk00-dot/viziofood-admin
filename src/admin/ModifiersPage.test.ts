import { describe, expect, it } from 'vitest';
import { findDuplicateInGroup, parseModifierPrice } from './ModifiersPage';

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

// Uniqueness is per GROUP, case-insensitive — mirroring the database index
// on (group_id, lower(trim(name))). The sibling list only ever contains the
// edited option's own group, so these tests pin the rule end-to-end:
// cross-group repetition never reaches the check and is always valid.
describe('findDuplicateInGroup', () => {
  it('scenario B/C: rejects an exact or case-variant duplicate within the same group', () => {
    expect(findDuplicateInGroup('Extra Pasta', ['Extra Pasta', 'Truffle'])).toBe('Extra Pasta');
    expect(findDuplicateInGroup('extra pasta', ['Extra Pasta', 'Truffle'])).toBe('Extra Pasta');
    expect(findDuplicateInGroup('EXTRA PASTA', ['Extra Pasta', 'Truffle'])).toBe('Extra Pasta');
  });
  it('ignores surrounding whitespace and empty names', () => {
    expect(findDuplicateInGroup('  Extra Pasta  ', ['Extra Pasta'])).toBe('Extra Pasta');
    expect(findDuplicateInGroup('   ', ['Extra Pasta'])).toBeUndefined();
  });
  it('scenario F: saving without renaming passes (own name is excluded)', () => {
    expect(findDuplicateInGroup('Extra Pasta', ['Extra Pasta', 'Truffle'], 'Extra Pasta')).toBeUndefined();
  });
  it('scenario G: renaming to another existing name in the same group is rejected', () => {
    expect(findDuplicateInGroup('Truffle', ['Extra Pasta', 'Truffle'], 'Extra Pasta')).toBe('Truffle');
  });
  it('scenario A/D/E: the same name in a different group is valid (different sibling list)', () => {
    expect(findDuplicateInGroup('Extra Pasta', ['Beef', 'Chicken'])).toBeUndefined();
    expect(findDuplicateInGroup('Truffle', ['Parmesan'])).toBeUndefined();
  });
});
