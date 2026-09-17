// Catering & Bulk Buy — frontend constants and pure helpers.
//
// DISPLAY-ONLY mirrors of the authoritative values in
// supabase/functions/_shared/catering.ts (Edge Functions, deployed from the
// public-site repository) and the 20260917120000 migration (database). When
// the admin configures different values in catering_settings the service
// layer overrides these; checkout totals are always recomputed server-side.

export type CateringEnquiryStatus = 'New' | 'Contacted' | 'Quoted' | 'Confirmed' | 'Completed' | 'Cancelled';
export interface CateringFaq { id: string; question: string; answer: string; active: boolean; displayOrder: number }
export interface CateringStep { id: string; stepTitle: string; stepDescription: string; active: boolean; displayOrder: number }

export interface CateringSettings {
  pageEnabled: boolean;
  cateringOrdersEnabled: boolean;
  rawPastaOrdersEnabled: boolean;
  heroTitle: string;
  heroDescription: string;
  heroImageUrl: string | null;
  cateringIntro: string;
  bulkBuyIntro: string;
  rawPastaIntro: string;
  howItWorksTitle: string;
  howItWorksIntro: string;
  deliveryInfo: string;
  pickupInfo: string;
  ctaText: string;
  enquiryIntro: string;
  contactPhone: string;
  contactEmail: string;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  serviceChargeWaiverThreshold: number;
  deliveryRadiusKm: number;
  rawPastaPrice: number;
  rawPastaWeightGrams: number;
  originAddress: string;
  originLat: number | null;
  originLng: number | null;
  // Admin-editable SEO (blank = built-in defaults)
  seoTitle: string;
  seoDescription: string;
  socialTitle: string;
  socialDescription: string;
  socialImageUrl: string | null;
  seoCanonical: string | null;
}

/** The requested business defaults (AUD). */
export const DEFAULT_CATERING = {
  deliveryFee: 20,
  freeDeliveryThreshold: 199,
  serviceChargeWaiverThreshold: 199,
  deliveryRadiusKm: 20,
  rawPastaPrice: 10,
  rawPastaWeightGrams: 200,
  /** Standard catering tray price; Campanelle with Prawns is the exception. */
  cateringTrayPrice: 75,
  campanelleTrayPrice: 85,
  cateringServesMin: 4,
  cateringServesMax: 5,
} as const;

/** Catering unit + serving copy, shown everywhere trays are sold. */
export const CATERING_UNIT = 'tray' as const;
export const cateringServesText = `Serves approximately ${DEFAULT_CATERING.cateringServesMin}–${DEFAULT_CATERING.cateringServesMax} people per tray.`;

/** Name-rule pricing used when the per-product catering_price flag is absent
 *  (pre-migration fallback + admin display). Mirrored by the server module. */
export const isCampanelleWithPrawns = (name: string): boolean =>
  /campanelle/i.test(name) && /prawn/i.test(name);

/** Products excluded from Catering & Bulk Buy (still on the normal menu). */
const CATERING_EXCLUDED = [/spaghetti\s+carbonara/i, /tagliatelle\s+ai\s+funghi/i, /tagliatelle\s+bolognese/i];
export const isExcludedFromCatering = (name: string): boolean =>
  CATERING_EXCLUDED.some(pattern => pattern.test(name.trim()));

/** Tray price for a product by name rule: $85 Campanelle with Prawns, else $75. */
export const cateringTrayPriceFor = (name: string): number =>
  isCampanelleWithPrawns(name) ? DEFAULT_CATERING.campanelleTrayPrice : DEFAULT_CATERING.cateringTrayPrice;

export const DEFAULT_CATERING_CONTENT = {
  heroTitle: 'Handmade Pasta Catering & Bulk Buy in Perth',
  heroDescription: 'Catering made easy with Vizio Food. Order your favourite handmade pastas in larger quantities for offices, parties, events and gatherings — or take our authentic handmade pasta home and cook it yourself.',
  cateringIntro: 'Large pasta orders for events, offices and gatherings.',
  bulkBuyIntro: 'Order larger quantities of your favourite handmade pasta.',
  rawPastaIntro: 'Fresh handmade pasta to take home and cook yourself.',
  howItWorksTitle: 'How it works',
  howItWorksIntro: 'From our kitchen to your table in five simple steps.',
  deliveryInfo: 'Delivery within 20 km of our restaurant. $20 for orders under $199 — free from $199. Beyond 20 km a flat $20 delivery fee applies.',
  pickupInfo: 'Collect your order from our restaurant — always available, no delivery fee.',
  ctaText: 'Start Your Catering Order',
  enquiryIntro: 'Planning something bigger or custom? Tell us about your event and we will help you plan it.',
} as const;

/** Built-in SEO metadata for the public /catering page (admin-overridable). */
export const DEFAULT_CATERING_SEO = {
  title: 'Pasta Catering Perth | Handmade Italian Pasta Trays & Bulk Buy | Vizio Food',
  description: 'Handmade pasta catering in Perth CBD from Vizio Food. Italian catering trays serving 4-5 people, office and party catering, plus fresh raw pasta to cook at home. Order online for pickup or local delivery.',
  socialTitle: 'Pasta Catering Perth — Handmade Italian Trays | Vizio Food',
  socialDescription: 'Italian pasta catering trays for offices, parties and events in Perth. Each tray serves 4–5. Raw handmade pasta by weight. Pickup or local delivery.',
} as const;

export const DEFAULT_HOW_IT_WORKS = [
  { stepTitle: 'Choose your favourite handmade pasta', stepDescription: 'Browse the catering menu — every pasta is available in larger quantities.' },
  { stepTitle: 'Select your quantities', stepDescription: 'Use the quantity selectors to scale each pasta to your event.' },
  { stepTitle: 'Add raw pasta if you like', stepDescription: `Fresh handmade pasta to take home — $${DEFAULT_CATERING.rawPastaPrice} per ${DEFAULT_CATERING.rawPastaWeightGrams} g portion.` },
  { stepTitle: 'Choose pickup or delivery', stepDescription: `Delivery within ${DEFAULT_CATERING.deliveryRadiusKm} km — free on orders $${DEFAULT_CATERING.freeDeliveryThreshold}+. Pickup is always available.` },
  { stepTitle: 'Review and place your order', stepDescription: 'See the full breakdown, then pay securely online or on pickup.' },
] as const;

export const defaultCateringSettings = (): CateringSettings => ({
  pageEnabled: true,
  cateringOrdersEnabled: true,
  rawPastaOrdersEnabled: true,
  heroTitle: '',
  heroDescription: '',
  heroImageUrl: null,
  cateringIntro: '',
  bulkBuyIntro: '',
  rawPastaIntro: '',
  howItWorksTitle: '',
  howItWorksIntro: '',
  deliveryInfo: '',
  pickupInfo: '',
  ctaText: '',
  enquiryIntro: '',
  contactPhone: '',
  contactEmail: '',
  deliveryEnabled: true,
  pickupEnabled: true,
  deliveryFee: DEFAULT_CATERING.deliveryFee,
  freeDeliveryThreshold: DEFAULT_CATERING.freeDeliveryThreshold,
  serviceChargeWaiverThreshold: DEFAULT_CATERING.serviceChargeWaiverThreshold,
  deliveryRadiusKm: DEFAULT_CATERING.deliveryRadiusKm,
  rawPastaPrice: DEFAULT_CATERING.rawPastaPrice,
  rawPastaWeightGrams: DEFAULT_CATERING.rawPastaWeightGrams,
  // Built-in restaurant origin (7/544 Hay St, Perth) so the delivery radius
  // is enforced from day one; the admin panel can refine it later.
  originAddress: '7/544 Hay St, Perth WA 6000',
  originLat: -31.9529,
  originLng: 115.8569,
  seoTitle: '',
  seoDescription: '',
  socialTitle: '',
  socialDescription: '',
  socialImageUrl: null,
  seoCanonical: null,
});

/** "Lasagna" detection for defensive client-side filtering (the server
 *  re-checks catering_available — this is presentation only). */
export const looksLikeLasagna = (name: string): boolean =>
  /(^|\s|-)lasagna/i.test(name.trim());
