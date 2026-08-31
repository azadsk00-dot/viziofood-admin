// Category-based product picker grouping (combo editor + add-from-menu).
// Pure logic — mirrors how the admin picks INDIVIDUAL products per category.

import { describe, expect, it } from 'vitest';
import { groupProductsByCategory } from './ComboEditor';

const products = [
  { id: '1', name: 'Carbonara', category: 'Pasta', price: 24 },
  { id: '2', name: 'Bolognese', category: 'Pasta', price: 24 },
  { id: '3', name: 'Margherita', category: 'Pizza', price: 14 },
  { id: '4', name: 'Pepperoni', category: 'Pizza', price: 16 },
  { id: '5', name: 'Pepsi', category: 'Drinks', price: 4.5 },
  { id: '6', name: 'Tiramisu', category: '', price: 8 }, // no category → "Other"
];

describe('groupProductsByCategory', () => {
  it('groups products into sorted category sections', () => {
    const sections = groupProductsByCategory(products, '');
    expect(sections.map((s) => s.category)).toEqual(['Drinks', 'Other', 'Pasta', 'Pizza']);
    const pasta = sections.find((s) => s.category === 'Pasta');
    expect(pasta?.items.map((p) => p.name)).toEqual(['Carbonara', 'Bolognese']);
  });

  it('search filters across ALL categories and matches the category name too', () => {
    const byName = groupProductsByCategory(products, 'pep');
    expect(byName.map((s) => s.category).sort()).toEqual(['Drinks', 'Pizza']); // Pepsi + Pepperoni
    const byCategory = groupProductsByCategory(products, 'pasta');
    expect(byCategory.map((s) => s.category)).toEqual(['Pasta']);
    expect(byCategory[0]?.items).toHaveLength(2);
  });

  it('drops sections with no matches', () => {
    expect(groupProductsByCategory(products, 'zzz')).toEqual([]);
  });
});
