/**
 * Canadian sales-tax matrix for Vantage Supplements.
 *
 * Rates checked 2026-11-04. Rates and exemptions change (Nova Scotia's HST went
 * 15% → 14% on 2025-04-01; Manitoba widened RST food exemptions 2026-07-01), so
 * this file is the single source of truth: edit it, then re-run the seed. The
 * seed UPDATES existing rates in place.
 *
 * ⚠ Not tax advice. Have your accountant sign off on CATEGORY_RULES before launch,
 *   in particular every row marked `verify: true`.
 *
 * Sources:
 *  - Federal rates: CRA "GST/HST rates by province"
 *  - Dietary supplements are NOT zero-rated basic groceries → GST/HST applies:
 *    CRA GST/HST Info Sheet GI-001 "Products Commonly Described as Dietary
 *    Supplements"; protein powders specifically: CRA ruling on plant-based
 *    protein powder (supplements normal protein intake → taxable).
 *    Products that legally qualify as "meal replacements" / "nutritional
 *    supplements" under the Food and Drug Regulations ARE zero-rated (Memo 4.3).
 *  - BC: PST exempts orally ingestible vitamins and dietary supplements for human
 *    consumption, explicitly incl. "mineral, protein and sports supplements"
 *    (PSTERR s.3(2)(a); Bulletin PST 206/207).
 *  - MB: dietary supplements remain RST-taxable (only prenatal vitamins became
 *    exempt 2026-07-01; Budget 2026 / Bulletin RST 030).
 *  - SK: treated as taxable here pending confirmation against Bulletin PST-2.
 *  - QC: QST follows GST/HST treatment for these goods.
 *  - Shipping: GST/HST/QST follow the goods. MB RST applies to delivery charges
 *    from out-of-province vendors; SK PST applies when delivery originates outside
 *    SK; BC PST on delivery follows the taxability of the goods.
 */

export type Province =
  | "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";

export const PROVINCES: Province[] = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
];

/** Federal layer: HST replaces GST in participating provinces. */
export const FEDERAL: Record<Province, { kind: "GST" | "HST"; percent: string }> = {
  AB: { kind: "GST", percent: "5" },
  BC: { kind: "GST", percent: "5" },
  MB: { kind: "GST", percent: "5" },
  NB: { kind: "HST", percent: "15" },
  NL: { kind: "HST", percent: "15" },
  NS: { kind: "HST", percent: "14" },
  NT: { kind: "GST", percent: "5" },
  NU: { kind: "GST", percent: "5" },
  ON: { kind: "HST", percent: "13" },
  PE: { kind: "HST", percent: "15" },
  QC: { kind: "GST", percent: "5" },
  SK: { kind: "GST", percent: "5" },
  YT: { kind: "GST", percent: "5" },
};

/** Provincial layer for non-HST provinces. QST is NOT compounded on GST (since 2013). */
export const PROVINCIAL: Partial<Record<Province, { kind: "PST" | "RST" | "QST"; percent: string }>> = {
  BC: { kind: "PST", percent: "7" },
  MB: { kind: "RST", percent: "7" },
  QC: { kind: "QST", percent: "9.975" },
  SK: { kind: "PST", percent: "6" },
};

export type CategoryKey = "supplements" | "merchandise" | "zero_rated_food" | "shipping";

export const TAX_CATEGORIES: Record<
  CategoryKey,
  { name: string; tax_code: string; description: string; is_default?: boolean }
> = {
  supplements: {
    name: "Dietary Supplements",
    tax_code: "VS-SUPP",
    description:
      "Protein powders, pre-workout, BCAAs, creatine, vitamins (tablets/capsules/powders). GST/HST taxable; BC PST-exempt.",
    is_default: true,
  },
  merchandise: {
    name: "General Merchandise",
    tax_code: "VS-GEN",
    description: "Shakers, apparel, accessories. Fully taxable everywhere.",
  },
  zero_rated_food: {
    name: "Zero-Rated Food",
    tax_code: "VS-ZERO",
    description:
      "Only products that legally qualify as meal replacements / nutritional supplements under the Food and Drug Regulations, or other basic groceries. No tax. Get a CRA ruling if unsure.",
  },
  shipping: {
    name: "Shipping",
    tax_code: "VS-SHIP",
    description: "Assigned to delivery methods. Taxes shipping charges.",
  },
};

/**
 * Which layers apply per category. `federal` = GST or HST as applicable.
 * Provincial layers are listed per province; absent = exempt.
 */
export const CATEGORY_RULES: Record<
  CategoryKey,
  { federal: boolean; provincial: Partial<Record<Province, { verify?: boolean }>> }
> = {
  supplements: {
    federal: true,
    provincial: { MB: {}, QC: {}, SK: { verify: true } }, // BC exempt
  },
  merchandise: {
    federal: true,
    provincial: { BC: {}, MB: {}, QC: {}, SK: {} },
  },
  zero_rated_food: { federal: false, provincial: {} },
  // Shipping provincial layers depend on where you ship FROM; resolved below.
  shipping: { federal: true, provincial: { QC: {} } },
};

/**
 * Shipping-charge PST depends on the ship-from province.
 *
 * BC is intentionally omitted: BC PST on delivery follows the goods, and the
 * core catalogue (supplements) is BC PST-exempt. Spree's built-in engine taxes
 * shipping per delivery method, not pro rata per cart, so a mixed BC cart
 * (supplement + shaker) under-collects PST on the shaker's share of shipping.
 * If merchandise becomes material in BC, switch to a tax provider that prorates
 * (see docs/tax-compliance.md).
 */
export function shippingProvincialLayers(shipFrom: Province): Partial<Record<Province, { verify?: boolean }>> {
  const layers: Partial<Record<Province, { verify?: boolean }>> = { QC: {} };
  if (shipFrom !== "MB") layers.MB = { verify: true };
  if (shipFrom !== "SK") layers.SK = { verify: true };
  return layers;
}

export function rateName(kind: string, percent: string, province: Province) {
  return kind === "GST" ? `GST ${percent}% (${province})` : `${province} ${kind} ${percent}%`;
}
