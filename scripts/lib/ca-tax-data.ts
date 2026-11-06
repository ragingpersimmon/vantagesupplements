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
 *  - SK: taxable and flagged to verify against Bulletin PST-2 until launch.env
 *    SK_SUPPLEMENTS says otherwise (exempt → no SK PST; taxable → flag cleared).
 *  - launch.env REGISTERED_PROVINCIAL limits which provincial layers (goods AND
 *    shipping) are charged at all; see parseTaxConfig / provincialLayers below.
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

/**
 * Spree requires tax rate names to be unique per store (case-insensitive,
 * across all categories), so every category but the default one carries a
 * suffix. The name is also the label customers see on each tax line.
 */
const RATE_NAME_SUFFIX: Record<CategoryKey, string> = {
  supplements: "",
  merchandise: " · Merchandise",
  zero_rated_food: " · Zero-rated",
  shipping: " · Shipping",
};

export function rateName(kind: string, percent: string, province: Province, category: CategoryKey) {
  const base = kind === "GST" ? `GST ${percent}% (${province})` : `${province} ${kind} ${percent}%`;
  return `${base}${RATE_NAME_SUFFIX[category]}`;
}

// ── launch.env inputs ───────────────────────────────────────────────────────

export const PROVINCIAL_PROVINCES = Object.keys(PROVINCIAL) as Province[];

/** Accountant's answer on SK PST for supplements (launch.env SK_SUPPLEMENTS). */
export type SkSupplements = "taxable" | "exempt" | "unknown";

export interface TaxConfig {
  shipFrom: Province;
  /** Provinces whose provincial layer (PST/RST/QST) is charged. GST/HST is always charged. */
  registeredProvincial: Province[];
  skSupplements: SkSupplements;
}

/**
 * Reads SHIP_FROM_PROVINCE, REGISTERED_PROVINCIAL and SK_SUPPLEMENTS (launch.env).
 * Blank values fall back (and say so in `warnings`); invalid values throw.
 */
export function parseTaxConfig(env: Record<string, string | undefined>): { config: TaxConfig; warnings: string[] } {
  const warnings: string[] = [];

  let shipFrom = env.SHIP_FROM_PROVINCE?.trim().toUpperCase() as Province | "" | undefined;
  if (!shipFrom) {
    shipFrom = "BC";
    warnings.push("SHIP_FROM_PROVINCE is blank: assuming BC.");
  } else if (!PROVINCES.includes(shipFrom)) {
    throw new Error(`SHIP_FROM_PROVINCE=${shipFrom} is not a province code (${PROVINCES.join(", ")}).`);
  }

  const listed = (env.REGISTERED_PROVINCIAL ?? "")
    .split(/[\s,]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  let registeredProvincial: Province[];
  if (!listed.length) {
    registeredProvincial = [...PROVINCIAL_PROVINCES];
    warnings.push(
      `REGISTERED_PROVINCIAL is blank: charging provincial tax in all of ${PROVINCIAL_PROVINCES.join(", ")} (staging only; fix before launch).`,
    );
  } else {
    const invalid = listed.filter((p) => !PROVINCIAL_PROVINCES.includes(p as Province));
    if (invalid.length) {
      throw new Error(
        `REGISTERED_PROVINCIAL has ${invalid.join(", ")}; only ${PROVINCIAL_PROVINCES.join(", ")} have a provincial layer (GST/HST is always charged).`,
      );
    }
    registeredProvincial = PROVINCIAL_PROVINCES.filter((p) => listed.includes(p));
  }

  let skSupplements = env.SK_SUPPLEMENTS?.trim().toLowerCase() as SkSupplements | "" | undefined;
  if (!skSupplements) {
    skSupplements = "unknown";
    warnings.push("SK_SUPPLEMENTS is blank: treating SK PST on supplements as taxable, flagged to verify.");
  } else if (!["taxable", "exempt", "unknown"].includes(skSupplements)) {
    throw new Error(`SK_SUPPLEMENTS=${skSupplements} must be taxable, exempt or unknown.`);
  }

  return { config: { shipFrom, registeredProvincial, skSupplements }, warnings };
}

// ── The resolved matrix ─────────────────────────────────────────────────────

type Layers = Partial<Record<Province, { verify?: boolean }>>;

/** Provincial layers charged on a category once launch.env is applied. */
export function provincialLayers(category: CategoryKey, config: TaxConfig): Layers {
  const layers: Layers = {
    ...(category === "shipping" ? shippingProvincialLayers(config.shipFrom) : CATEGORY_RULES[category].provincial),
  };
  if (category === "supplements") {
    if (config.skSupplements === "exempt") delete layers.SK;
    else layers.SK = config.skSupplements === "taxable" ? {} : { verify: true };
  }
  for (const province of Object.keys(layers) as Province[]) {
    if (!config.registeredProvincial.includes(province)) delete layers[province];
  }
  return layers;
}

export interface RateSpec {
  /** Stable id stored as metadata.vantage_key on the Spree tax rate. */
  key: string;
  category: CategoryKey;
  province: Province;
  kind: string;
  name: string;
  percent: string;
  verify: boolean;
}

/** Every tax rate the seed should hold, for all categories and provinces. */
export function taxRates(config: TaxConfig): RateSpec[] {
  const out: RateSpec[] = [];
  for (const category of Object.keys(CATEGORY_RULES) as CategoryKey[]) {
    const layers = provincialLayers(category, config);
    for (const province of PROVINCES) {
      if (CATEGORY_RULES[category].federal) {
        const fed = FEDERAL[province];
        out.push({
          key: `${category}:${province}:${fed.kind}`,
          category,
          province,
          kind: fed.kind,
          name: rateName(fed.kind, fed.percent, province, category),
          percent: fed.percent,
          verify: false,
        });
      }
      const layer = layers[province];
      const prov = PROVINCIAL[province];
      if (layer && prov) {
        out.push({
          key: `${category}:${province}:${prov.kind}`,
          category,
          province,
          kind: prov.kind,
          name: rateName(prov.kind, prov.percent, province, category),
          percent: prov.percent,
          verify: Boolean(layer.verify),
        });
      }
    }
  }
  return out;
}

/** Rates charged on one category delivered to one province. */
export function ratesFor(config: TaxConfig, category: CategoryKey, province: Province): RateSpec[] {
  return taxRates(config).filter((r) => r.category === category && r.province === province);
}

function decimal(value: string): { n: bigint; d: bigint } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`Not a non-negative decimal: ${value}`);
  const frac = m[2] ?? "";
  return { n: BigInt(m[1] + frac), d: 10n ** BigInt(frac.length) };
}

/** Converts a decimal amount ("59.99") to integer cents. */
export function toCents(amount: string): number {
  const { n, d } = decimal(amount);
  const cents = (n * 100n * 2n + d) / (2n * d);
  return Number(cents);
}

/**
 * Tax on `amountCents` at `percent`, rounded half up to the cent: the rounding
 * Spree's internal tax provider applies per line and per rate.
 */
export function taxCents(amountCents: number, percent: string): number {
  const { n, d } = decimal(percent);
  const denom = d * 100n;
  return Number((BigInt(amountCents) * n * 2n + denom) / (2n * denom));
}

export function formatCents(cents: number): string {
  return `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}
