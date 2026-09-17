// Catering & Bulk Buy — pure-helper acceptance tests for the admin port.
// These mirror the business rules enforced server-side
// (supabase/functions/_shared/catering.ts, deployed from the public-site
// repository) so the admin panel and the storefront agree on the defaults.

import { describe, expect, it } from 'vitest';
import {
  CATERING_UNIT, DEFAULT_CATERING, DEFAULT_CATERING_SEO, cateringServesText, cateringTrayPriceFor,
  defaultCateringSettings, isCampanelleWithPrawns, isExcludedFromCatering, looksLikeLasagna,
} from './lib/catering';

describe('catering tray pricing', () => {
  it('prices a standard tray at $75', () => {
    expect(cateringTrayPriceFor('Tagliatelle')).toBe(75);
    expect(cateringTrayPriceFor('Spaghetti Pomodoro')).toBe(75);
  });

  it('prices Campanelle with Prawns at $85', () => {
    expect(cateringTrayPriceFor('Campanelle with Prawns')).toBe(85);
    expect(isCampanelleWithPrawns('Campanelle with Prawns')).toBe(true);
    expect(isCampanelleWithPrawns('Campanelle')).toBe(false);
  });

  it('never uses the menu price for a tray', () => {
    expect(cateringTrayPriceFor('Lasagna')).toBe(75); // excluded elsewhere, but the rule is name-based
  });
});

describe('catering exclusions', () => {
  it('excludes the three removed pastas from cooked catering', () => {
    expect(isExcludedFromCatering('Spaghetti Carbonara')).toBe(true);
    expect(isExcludedFromCatering('Tagliatelle ai Funghi')).toBe(true);
    expect(isExcludedFromCatering('Tagliatelle Bolognese')).toBe(true);
  });

  it('keeps every other pasta eligible', () => {
    expect(isExcludedFromCatering('Tagliatelle')).toBe(false);
    expect(isExcludedFromCatering('Campanelle with Prawns')).toBe(false);
  });

  it('detects Lasagna by name for the raw-pasta/cooked exclusion', () => {
    expect(looksLikeLasagna('Lasagna')).toBe(true);
    expect(looksLikeLasagna('Beef Lasagna')).toBe(true);
    expect(looksLikeLasagna('Tagliatelle')).toBe(false);
  });
});

describe('default catering settings', () => {
  const settings = defaultCateringSettings();

  it('carries the agreed business rules', () => {
    expect(DEFAULT_CATERING.deliveryFee).toBe(20);
    expect(DEFAULT_CATERING.freeDeliveryThreshold).toBe(199);
    expect(DEFAULT_CATERING.serviceChargeWaiverThreshold).toBe(199);
    expect(DEFAULT_CATERING.deliveryRadiusKm).toBe(20);
    expect(DEFAULT_CATERING.rawPastaPrice).toBe(10);
    expect(DEFAULT_CATERING.rawPastaWeightGrams).toBe(200);
  });

  it('ships with the restaurant origin so the radius is enforced', () => {
    expect(settings.originLat).not.toBeNull();
    expect(settings.originLng).not.toBeNull();
    expect(settings.originAddress).toContain('Hay St');
  });

  it('describes trays consistently', () => {
    expect(CATERING_UNIT).toBe('tray');
    expect(cateringServesText).toContain('4–5');
  });
});

describe('catering SEO defaults', () => {
  it('keeps the approved title and placeholders empty by default', () => {
    expect(DEFAULT_CATERING_SEO.title).toBe('Pasta Catering Perth | Handmade Italian Pasta Trays & Bulk Buy | Vizio Food');
    const fresh = defaultCateringSettings();
    expect(fresh.seoTitle).toBe('');
    expect(fresh.seoDescription).toBe('');
    expect(fresh.seoCanonical).toBeNull();
  });
});
