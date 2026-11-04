/**
 * Seeds Canadian tax categories + rates for all 13 provinces/territories, a
 * "Canada" delivery zone, and tiered Standard / Expedited shipping.
 *
 *   pnpm seed:tax              # apply
 *   pnpm seed:tax --dry-run    # print the plan, change nothing
 *
 * Idempotent: every record the script owns is tagged (tax rates via
 * metadata.vantage_key, categories via tax_code, delivery methods via code).
 * Re-running updates changed rates in place and removes Vantage-owned rates no
 * longer in the matrix. Records created by hand in Spree Admin are never touched.
 */
import type { TaxCategory, TaxRate } from "@spree/admin-sdk";
import { adminClient, DRY_RUN, listAll, log } from "./lib/admin";
import {
  CATEGORY_RULES,
  type CategoryKey,
  FEDERAL,
  PROVINCES,
  PROVINCIAL,
  type Province,
  rateName,
  shippingProvincialLayers,
  TAX_CATEGORIES,
} from "./lib/ca-tax-data";

// ── Shipping configuration (CAD). Edit freely, then re-run. ─────────────────
const FREE_STANDARD_THRESHOLD = "75.00";
const EXPEDITED_DISCOUNT_THRESHOLD = "150.00";
const SHIPPING = [
  { code: "standard", name: "Standard (5–7 business days)", min: null, max: "74.99", amount: "12.99", days: [5, 7] },
  { code: "standard-free", name: "Standard (5–7 business days)", min: FREE_STANDARD_THRESHOLD, max: null, amount: "0.00", days: [5, 7] },
  { code: "expedited", name: "Expedited (2–3 business days)", min: null, max: "149.99", amount: "24.99", days: [2, 3] },
  { code: "expedited-reduced", name: "Expedited (2–3 business days)", min: EXPEDITED_DISCOUNT_THRESHOLD, max: null, amount: "14.99", days: [2, 3] },
] as const;

const admin = adminClient();

const shipFrom = process.env.SHIP_FROM_PROVINCE as Province | undefined;
if (!shipFrom || !PROVINCES.includes(shipFrom)) {
  console.error(
    "Set SHIP_FROM_PROVINCE to your warehouse province (e.g. BC, ON). It decides whether MB/SK tax shipping charges.",
  );
  process.exit(1);
}

interface DesiredRate {
  key: string;
  category: CategoryKey;
  province: Province;
  name: string;
  percent: string;
  verify: boolean;
}

function desiredRates(): DesiredRate[] {
  const out: DesiredRate[] = [];
  for (const category of Object.keys(CATEGORY_RULES) as CategoryKey[]) {
    const rule = CATEGORY_RULES[category];
    const provincialLayers =
      category === "shipping" ? shippingProvincialLayers(shipFrom!) : rule.provincial;

    for (const province of PROVINCES) {
      if (rule.federal) {
        const fed = FEDERAL[province];
        out.push({
          key: `${category}:${province}:${fed.kind}`,
          category,
          province,
          name: rateName(fed.kind, fed.percent, province),
          percent: fed.percent,
          verify: false,
        });
      }
      const layer = provincialLayers[province];
      const prov = PROVINCIAL[province];
      if (layer && prov) {
        out.push({
          key: `${category}:${province}:${prov.kind}`,
          category,
          province,
          name: rateName(prov.kind, prov.percent, province),
          percent: prov.percent,
          verify: Boolean(layer.verify),
        });
      }
    }
  }
  return out;
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
  const desired = desiredRates();
  const verifyRows: string[] = [];

  for (const d of desired) {
    if (d.verify) verifyRows.push(`${TAX_CATEGORIES[d.category].name}: ${d.name}`);
    const params = {
      name: d.name,
      rate_percent: d.percent,
      show_rate_in_label: true,
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
        current.tax_category_id !== params.tax_category_id;
      if (changed && !DRY_RUN) await admin.taxRates.update(current.id, params);
      log(changed ? "update" : "keep", `${TAX_CATEGORIES[d.category].name} → ${d.name}`);
    }
    owned.delete(d.key);
  }

  // Anything still in `owned` was seeded earlier but is no longer in the matrix.
  for (const [key, stale] of owned) {
    log("update", `remove stale ${stale.name} (${key})`);
    if (!DRY_RUN) await admin.taxRates.delete(stale.id);
  }

  return { count: desired.length, verifyRows };
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
      log("update", `delivery method ${params.admin_name} @ $${s.amount}`);
      if (!DRY_RUN) await admin.deliveryMethods.update(found.id, params);
    } else {
      log("create", `delivery method ${params.admin_name} @ $${s.amount}`);
      if (!DRY_RUN) await admin.deliveryMethods.create(params);
    }
  }
}

async function main() {
  console.log(`Seeding Canadian tax + shipping (ship-from: ${shipFrom})${DRY_RUN ? " — DRY RUN" : ""}\n`);
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
