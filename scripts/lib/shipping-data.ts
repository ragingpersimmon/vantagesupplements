/**
 * Shipping tiers (CAD) seeded by seed-ca-tax.ts. Edit freely, then re-run.
 *
 * Each tier is its own delivery method gated by an item-total rule, so exactly
 * one Standard and one Expedited rate is offered for any cart. Spree validates
 * delivery method names as unique per store, so tiers of the same service need
 * distinct names; every name starts with its service ("Standard" / "Expedited").
 */
export const FREE_STANDARD_THRESHOLD = "75.00";
export const EXPEDITED_DISCOUNT_THRESHOLD = "150.00";

export const SHIPPING = [
  { code: "standard", name: "Standard (5–7 business days)", min: null, max: "74.99", amount: "12.99", days: [5, 7] },
  { code: "standard-free", name: "Standard (5–7 business days) — free", min: FREE_STANDARD_THRESHOLD, max: null, amount: "0.00", days: [5, 7] },
  { code: "expedited", name: "Expedited (2–3 business days)", min: null, max: "149.99", amount: "24.99", days: [2, 3] },
  { code: "expedited-reduced", name: "Expedited (2–3 business days) — reduced", min: EXPEDITED_DISCOUNT_THRESHOLD, max: null, amount: "14.99", days: [2, 3] },
] as const;
