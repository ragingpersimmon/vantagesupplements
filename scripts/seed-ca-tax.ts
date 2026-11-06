/**
 * Seeds Canadian tax categories + rates for all 13 provinces/territories, a
 * "Canada" delivery zone, and tiered Standard / Expedited shipping.
 *
 *   pnpm seed:tax              # apply
 *   pnpm seed:tax --dry-run    # print the plan, change nothing
 *
 * Reads SHIP_FROM_PROVINCE, REGISTERED_PROVINCIAL and SK_SUPPLEMENTS from
 * ../launch.env (scripts/.env wins for SHIP_FROM_PROVINCE); see parseTaxConfig.
 *
 * Idempotent: every record the script owns is tagged (tax rates via
 * metadata.vantage_key, categories via tax_code, delivery methods via code).
 * Re-running updates changed rates in place and removes Vantage-owned rates no
 * longer in the matrix. Records created by hand in Spree Admin are never touched.
 */
import type { DeliveryMethod, TaxCategory, TaxRate } from "@spree/admin-sdk";
import { adminClient, DRY_RUN, listAll, log } from "./lib/admin";
import {
  type CategoryKey,
  parseTaxConfig,
  PROVINCES,
  type TaxConfig,
  TAX_CATEGORIES,
  taxRates,
} from "./lib/ca-tax-data";
import { SHIPPING } from "./lib/shipping-data";

const admin = adminClient();

let taxConfig: TaxConfig;
let configWarnings: string[];
try {
  ({ config: taxConfig, warnings: configWarnings } = parseTaxConfig(process.env));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

async function ensureCategories(): Promise<Record<CategoryKey, string>> {
  const existing = await listAll<TaxCategory>((page) => admin.taxCategories.list({ page, limit: 100 }));
  const ids = {} as Record<CategoryKey, string>;

  for (const [key, def] of Object.entries(TAX_CATEGORIES) as [CategoryKey, (typeof TAX_CATEGORIES)[CategoryKey]][]) {
    const found = existing.find((c) => c.tax_code === def.tax_code);
    if (found) {
      const drift =
        found.name !== def.name || found.description !== def.description || found.is_default !== Boolean(def.is_default);
      if (drift && !DRY_RUN) await admin.taxCategories.update(found.id, { ...def, is_default: Boolean(def.is_default) });
      log(drift ? "update" : "keep", `tax category ${def.name}`);
      ids[key] = found.id;
    } else {
      log("create", `tax category ${def.name}`);
      ids[key] = DRY_RUN ? `dry_${key}` : (await admin.taxCategories.create({ ...def, is_default: Boolean(def.is_default) })).id;
    }
  }
  return ids;
}

async function syncRates(categoryIds: Record<CategoryKey, string>) {
  const existing = await listAll<TaxRate>((page) => admin.taxRates.list({ page, limit: 100 }));
  const owned = new Map(
    existing
      .filter((r) => typeof r.metadata?.vantage_key === "string")
      .map((r) => [r.metadata!.vantage_key as string, r]),
  );
  const desired = taxRates(taxConfig);
  const verifyRows: string[] = [];

  // Seeded earlier but no longer in the matrix (e.g. a province left REGISTERED_PROVINCIAL).
  // Removed first so a freed name can be reused below.
  const wanted = new Set(desired.map((d) => d.key));
  for (const [key, stale] of owned) {
    if (wanted.has(key)) continue;
    log("update", `remove stale ${stale.name} (${key})`);
    if (!DRY_RUN) await admin.taxRates.delete(stale.id);
  }

  for (const d of desired) {
    if (d.verify) verifyRows.push(`${TAX_CATEGORIES[d.category].name}: ${d.name}`);
    const params = {
      name: d.name,
      rate_percent: d.percent,
      // The name already carries the percent; true would label lines "GST 5% (BC) 5%".
      show_rate_in_label: false,
      tax_category_id: categoryIds[d.category],
      country_code: "CA" as const,
      state_code: d.province,
      metadata: { vantage_key: d.key, vantage_verify: d.verify, seeded_at: new Date().toISOString() },
    };
    const current = owned.get(d.key);
    if (!current) {
      log("create", `${TAX_CATEGORIES[d.category].name} → ${d.name}`);
      if (!DRY_RUN) await admin.taxRates.create(params);
    } else {
      const changed =
        Number(current.rate_percent) !== Number(d.percent) ||
        current.name !== d.name ||
        current.tax_category_id !== params.tax_category_id ||
        current.state_code !== d.province ||
        current.show_rate_in_label !== params.show_rate_in_label ||
        Boolean(current.metadata?.vantage_verify) !== d.verify;
      if (changed && !DRY_RUN) await admin.taxRates.update(current.id, params);
      log(changed ? "update" : "keep", `${TAX_CATEGORIES[d.category].name} → ${d.name}`);
    }
  }

  return { count: desired.length, verifyRows };
}

const sameAmount = (a: unknown, b: unknown) =>
  a === null || a === undefined || a === "" ? b === null || b === undefined || b === "" : Number(a) === Number(b);

interface DesiredMethod {
  name: string;
  admin_name: string;
  fulfillment_provider: string;
  storefront_visible: boolean;
  estimated_transit_business_days_min: number;
  estimated_transit_business_days_max: number;
  tax_category_id: string;
  delivery_zone_id: string;
  calculator: { type: string; preferences: { amount: string; currency: string } };
  rules: { type: string; preferences: { minimum_amount: string | null; maximum_amount: string | null } }[];
}

/** Fields that differ between Spree's delivery method and the desired config (empty = in sync). */
function deliveryMethodDrift(found: DeliveryMethod, want: DesiredMethod): string[] {
  const drift: string[] = [];
  for (const key of [
    "name",
    "admin_name",
    "fulfillment_provider",
    "storefront_visible",
    "estimated_transit_business_days_min",
    "estimated_transit_business_days_max",
    "tax_category_id",
    "delivery_zone_id",
  ] as const) {
    if (found[key] !== want[key]) drift.push(key);
  }
  const calc = found.calculator as { type: string; preferences: Record<string, unknown> } | null;
  if (
    !calc ||
    calc.type !== want.calculator.type ||
    !sameAmount(calc.preferences.amount, want.calculator.preferences.amount) ||
    (calc.preferences.currency ?? want.calculator.preferences.currency) !== want.calculator.preferences.currency
  ) {
    drift.push("calculator");
  }
  const rules = found.rules.filter((r) => r.active);
  const [wantRule] = want.rules;
  if (
    rules.length !== 1 ||
    rules[0].type !== wantRule.type ||
    !sameAmount(rules[0].preferences.minimum_amount, wantRule.preferences.minimum_amount) ||
    !sameAmount(rules[0].preferences.maximum_amount, wantRule.preferences.maximum_amount)
  ) {
    drift.push("rules");
  }
  return drift;
}

async function ensureShipping(shippingCategoryId: string) {
  const [zones, methods, calculators, ruleTypes] = await Promise.all([
    listAll((page) => admin.deliveryZones.list({ page, limit: 100 })),
    listAll((page) => admin.deliveryMethods.list({ page, limit: 100 })),
    admin.deliveryMethods.calculators(),
    admin.deliveryMethods.ruleTypes(),
  ]);

  // Resolve wire type names from the API instead of hardcoding them.
  const flatRate = calculators.data.find((c) => /flat_rate$/.test(c.type) && !/percent/.test(c.type));
  const itemTotal = ruleTypes.data.find((r) => /item_total/.test(r.type));
  if (!flatRate || !itemTotal) {
    throw new Error(
      `Could not find flat-rate calculator or item-total rule. Calculators: ${calculators.data.map((c) => c.type)}; rules: ${ruleTypes.data.map((r) => r.type)}`,
    );
  }

  let zone = zones.find((z) => z.name === "Canada");
  if (!zone) {
    log("create", "delivery zone Canada");
    zone = DRY_RUN
      ? ({ id: "dry_zone" } as typeof zone & object)
      : await admin.deliveryZones.create({
          name: "Canada",
          description: "All provinces and territories",
          members: [{ member_type: "country", country_code: "CA" }],
        });
  } else {
    log("keep", "delivery zone Canada");
  }

  for (const s of SHIPPING) {
    const params = {
      name: s.name,
      admin_name: `${s.name} — ${s.min ? `≥ $${s.min}` : `≤ $${s.max}`}`,
      code: `vantage-${s.code}`,
      fulfillment_provider: "manual",
      storefront_visible: true,
      estimated_transit_business_days_min: s.days[0],
      estimated_transit_business_days_max: s.days[1],
      tax_category_id: shippingCategoryId,
      delivery_zone_id: zone!.id,
      calculator: { type: flatRate.type, preferences: { amount: s.amount, currency: "CAD" } },
      rules: [
        {
          type: itemTotal.type,
          active: true,
          preferences: { minimum_amount: s.min, maximum_amount: s.max },
        },
      ],
    };
    const found = methods.find((m) => m.code === params.code);
    if (found) {
      const drift = deliveryMethodDrift(found, params);
      if (drift.length && !DRY_RUN) await admin.deliveryMethods.update(found.id, params);
      log(
        drift.length ? "update" : "keep",
        `delivery method ${params.admin_name} @ $${s.amount}${drift.length ? ` (${drift.join(", ")})` : ""}`,
      );
    } else {
      log("create", `delivery method ${params.admin_name} @ $${s.amount}`);
      if (!DRY_RUN) await admin.deliveryMethods.create(params);
    }
  }
}

async function main() {
  const { shipFrom, registeredProvincial, skSupplements } = taxConfig;
  console.log(`Seeding Canadian tax + shipping${DRY_RUN ? " — DRY RUN" : ""}`);
  console.log(
    `  ship-from: ${shipFrom} · provincial tax registered in: ${registeredProvincial.join(", ") || "none"} · SK supplements: ${skSupplements}\n`,
  );
  for (const w of configWarnings) console.warn(`⚠ ${w}`);
  if (configWarnings.length) console.log("");
  const categoryIds = await ensureCategories();
  const { count, verifyRows } = await syncRates(categoryIds);
  await ensureShipping(categoryIds.shipping);

  console.log(`\n✓ ${count} tax rates across ${PROVINCES.length} provinces/territories.`);
  if (verifyRows.length) {
    console.log("\n⚠ Confirm these with your accountant before launch (vantage_verify=true):");
    for (const row of verifyRows) console.log(`   - ${row}`);
  }
  console.log(
    "\nNext: in Spree Admin, assign each product the right tax category (most products → Dietary Supplements).",
  );
}

main().catch((error) => {
  console.error("\n✗ Seed failed:", error?.message ?? error);
  if (error?.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});
