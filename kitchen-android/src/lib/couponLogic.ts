// Coupon discount math — mirrors web src/lib/money.ts couponDiscountCents.
// Server re-validates at checkout; this is for admin preview only.

import type { AdminCoupon } from './adminTypes';
import { toCents } from './money';

export interface CouponBasisLine {
  productId: string | null;
  category: string;
  amountCents: number;
}

export function isCouponUsable(
  coupon: AdminCoupon,
  subtotalCents: number,
  now = Date.now(),
): boolean {
  if (!coupon.active) return false;
  if (coupon.startsAt && now < Date.parse(coupon.startsAt)) return false;
  if (coupon.endsAt && now > Date.parse(coupon.endsAt)) return false;
  if (coupon.usageLimit !== null && coupon.timesUsed >= coupon.usageLimit) return false;
  if (subtotalCents < toCents(coupon.minimumOrder)) return false;
  return true;
}

export function couponDiscountCents(
  coupon: AdminCoupon,
  lines: CouponBasisLine[],
  subtotalCents: number,
  now = Date.now(),
): number {
  if (!isCouponUsable(coupon, subtotalCents, now)) return 0;
  const scoped =
    coupon.productIds.length || coupon.categoryNames.length
      ? lines.filter(
          (line) =>
            (coupon.productIds.length === 0 || (line.productId && coupon.productIds.includes(line.productId))) &&
            (coupon.categoryNames.length === 0 ||
              coupon.categoryNames.some((name) => name.toLowerCase() === line.category.toLowerCase())),
        )
      : lines;
  const basis = scoped.reduce((sum, line) => sum + line.amountCents, 0);
  if (basis <= 0) return 0;
  const raw =
    coupon.kind === 'percent' ? Math.round((basis * coupon.value) / 100) : Math.min(toCents(coupon.value), basis);
  return Math.max(0, Math.min(raw, subtotalCents));
}
