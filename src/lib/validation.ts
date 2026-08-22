/**
 * Zod schemas — the validation contract shared by forms (frontend) and the
 * Edge Functions (server). The server NEVER trusts the browser: every
 * request body is re-validated with these shapes (mirrored in Deno).
 */

import { z } from 'zod';

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+0-9 ()-]{8,20}$/, 'Enter a valid phone number');

export const emailSchema = z.string().trim().email('Enter a valid email address');

export const clockSchema = z
  .string()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

export const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const cartModifierSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  price: z.number().min(0).max(1000),
});

export const cartItemSchema = z.object({
  key: z.string().max(200),
  productId: z.string().uuid(),
  name: z.string().min(1).max(200),
  price: z.number().min(0).max(10000),
  quantity: z.number().int().min(1).max(99),
  modifiers: z.array(cartModifierSchema).max(30),
  instructions: z.string().max(500),
});

export const checkoutCustomerSchema = z
  .object({
    name: z.string().trim().min(2, 'Tell us your name').max(120),
    email: emailSchema,
    phone: phoneSchema,
    address: z.string().trim().max(300).optional(),
    suburb: z.string().trim().max(120).optional(),
    postcode: z.string().trim().max(10).optional(),
    deliveryInstructions: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    // Delivery requires a usable street address.
    if (value.deliveryInstructions !== '__pickup__' && value.address !== undefined && value.address.length < 5) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['address'], message: 'Enter the delivery street address' });
    }
  });

export const checkoutRequestSchema = z.object({
  cart: z.object({
    items: z.array(cartItemSchema).min(1, 'Your cart is empty'),
    fulfilment: z.enum(['Pickup', 'Delivery']),
    couponCode: z.string().trim().max(40).optional(),
  }),
  customer: checkoutCustomerSchema,
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const specialDraftSchema = z.object({
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().max(1000),
  imageUrl: z.string().url().nullable(),
  price: z.number().min(0).max(10000),
  originalPrice: z.number().min(0).max(10000).nullable(),
  active: z.boolean(),
  archived: z.boolean(),
  startDate: dateKeySchema.nullable(),
  endDate: dateKeySchema.nullable(),
  startTime: clockSchema.nullable(),
  endTime: clockSchema.nullable(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  ctaText: z.string().trim().max(60),
  ctaLink: z.string().trim().max(300),
  category: z.string().trim().max(80),
  dietary: z.array(z.string().max(40)).max(10),
  ingredients: z.array(z.string().max(80)).max(50),
  allergens: z.array(z.string().max(40)).max(20),
  badge: z.string().trim().max(40),
  priority: z.number().int().min(0).max(999),
  displayLocation: z.enum(['homepage', 'menu', 'both']),
  productId: z.string().uuid().nullable(),
  stockQuantity: z.number().int().min(0).max(100000).nullable(),
});

export const printerConfigSchema = z.object({
  name: z.string().trim().min(2).max(80),
  station: z.enum(['kitchen', 'bar', 'coffee', 'dessert', 'pickup', 'receipt']),
  connection: z.enum(['network', 'system']),
  host: z.string().trim().max(253),
  port: z.number().int().min(1).max(65535),
  paperWidth: z.union([z.literal(32), z.literal(48), z.literal(80)]),
  enabled: z.boolean(),
  autoPrint: z.boolean(),
  copies: z.number().int().min(1).max(5),
});

export const couponDraftSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only'),
  kind: z.enum(['percent', 'fixed']),
  value: z.number().min(0.01).max(10000),
  minimumOrder: z.number().min(0).max(10000),
  productIds: z.array(z.string().uuid()).max(200),
  categoryNames: z.array(z.string().max(80)).max(50),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable(),
  active: z.boolean(),
});

export const refundRequestSchema = z.object({
  orderId: z.string().uuid(),
  amount: z.number().min(0.01).max(100000),
  reason: z.string().trim().min(3).max(500),
  acknowledgement: z.literal(true),
});

/** Flatten a ZodError into `{ field: message }` for form display. */
export const fieldErrors = (error: z.ZodError): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
};
