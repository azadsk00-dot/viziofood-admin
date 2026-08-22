# Mobile-App Readiness (future Android/iOS)

The rebuild deliberately kept business logic out of React so a native app
consumes the same backend without porting rules.

## What the app can reuse directly

| Capability | Where | Notes |
|---|---|---|
| Auth (email/password, reset) | Supabase Auth | same project; profiles row auto-created on signup with role `customer` |
| Products / categories / modifiers | `products`, `categories`, `modifier_groups`, `modifiers`, `product_modifier_groups` | RLS already serves anon/authenticated reads |
| Specials | `specials` + scheduling rules in `src/lib/specials.ts` | the resolution rules are ~80 lines of pure logic — port as-is (tests included) |
| Cart math | `src/lib/money.ts` | integer-cent formula, coupon logic — port as-is; pinned by tests |
| Validation | `src/lib/validation.ts` (Zod) | Zod schemas run natively in React Native unchanged |
| Checkout | `create-checkout` Edge Function | POST the cart + customer, open the returned Stripe URL (Stripe's mobile SDKs or a webview) |
| Payment confirmation | `verify-checkout-session` + `stripe-webhook` | server-side, already mobile-agnostic |
| Orders / tracking | `orders` realtime publication | subscribe to `postgres_changes` for the customer's email |
| Favourites / profile | `favourite_products`, `profiles` | RLS scopes to `auth.uid()` |
| Push notifications | `push-notifications` Edge Function (Expo) | register the device token via the `register` action with the user's JWT |
| Restaurant settings | `restaurant_settings` realtime | hours, pause state, fees |

## What is browser-specific today (and the migration path)

1. **Cart persistence** — `localStorage` via `cart.ts`. The reducers and
   `totals()` are pure; swap `readCart/writeCart` for AsyncStorage/MMKV.
2. **Web Notifications + sound** (`orderNotifications.ts`) — for a mobile
   app use Expo Push (already wired server-side) instead.
3. **Stripe redirect flow** — `beginStripeCheckout` returns a URL the
   browser opens. A native app should call the same Edge Function and hand
   the URL to Stripe's mobile SDK / native webview; the verification flow
   (`verify-checkout-session`) is unchanged.
4. **Image compression** (`compressImage` in `admin/supabase.ts`) uses
   canvas — replace with an expo-image-manipulator equivalent for a native
   admin app.

## Ground rules for the app team

- Never re-implement money math — port `lib/money.ts` and keep the tests.
- Never trust client-side totals: `create-checkout` recomputes everything.
- Anonymous browsing uses the anon key; ordering requires nothing extra;
  accounts use Supabase Auth sessions.
- The DB enforces roles (customer/kitchen/staff/admin) — request only what
  the RLS policies allow; there is no private API to bypass it.
