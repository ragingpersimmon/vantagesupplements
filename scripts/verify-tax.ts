/**
 * Proves the seeded tax + shipping setup end to end through the Store API.
 *
 *   pnpm verify:tax             # exit 1 on any mismatch
 *
 * For all 13 provinces × 2 carts (whey only; whey + shaker) it creates a guest
 * cart, adds items, sets a shipping address in the province, lists delivery
 * rates, picks Standard and reads the tax lines. Expected tax comes from
 * lib/ca-tax-data.ts (+ launch.env via parseTaxConfig), never a second table.
 * It also checks the shipping tiers. Prints markdown for docs/LAUNCH_LOG.md.
 *
 * Needs SPREE_PUBLISHABLE_KEY (falls back to storefront/.env.local) and
 * SPREE_SEED_API_KEY (to map tax lines back to seeded rates).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaxRate } from "@spree/admin-sdk";
import { type Cart, createClient, type DeliveryRate, type RequestOptions } from "@spree/sdk";
import { adminClient, listAll } from "./lib/admin";
import {
  type CategoryKey,
  formatCents,
  parseTaxConfig,
  PROVINCES,
  type Province,
  ratesFor,
  taxCents,
  toCents,
} from "./lib/ca-tax-data";
import { DEMO } from "./lib/demo-catalogue";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.SPREE_API_URL ?? "http://localhost:4000";

function publishableKey(): string {
  if (process.env.SPREE_PUBLISHABLE_KEY) return process.env.SPREE_PUBLISHABLE_KEY;
  const file = resolve(root, "storefront/.env.local");
  const m = existsSync(file) ? /^SPREE_PUBLISHABLE_KEY=(.*)$/m.exec(readFileSync(file, "utf8")) : null;
  if (!m?.[1]?.startsWith("pk_")) {
    console.error("Set SPREE_PUBLISHABLE_KEY (or run pnpm setup-store so storefront/.env.local has it).");
    process.exit(1);
  }
  return m[1].trim();
}

const { config, warnings } = parseTaxConfig(process.env);
const store = createClient({ baseUrl, publishableKey: publishableKey() });
const admin = adminClient();

// Shipping tiers as specified for launch (docs/phases/2.md); the seed must match.
const TIERS = {
  Standard: (itemTotal: number) => (itemTotal >= 7500 ? 0 : 1299),
  Expedited: (itemTotal: number) => (itemTotal >= 15000 ? 1499 : 2499),
} as const;
type Tier = keyof typeof TIERS;
const tierOf = (rate: DeliveryRate): Tier | undefined =>
  (Object.keys(TIERS) as Tier[]).find((t) => (rate.name ?? rate.delivery_method?.name ?? "").startsWith(t));

// Fixture addresses (one real-format postal code per province/territory).
const ADDRESSES: Record<Province, { city: string; postal_code: string }> = {
  AB: { city: "Calgary", postal_code: "T2P 1J9" },
  BC: { city: "Vancouver", postal_code: "V6B 1A1" },
  MB: { city: "Winnipeg", postal_code: "R3C 0A1" },
  NB: { city: "Moncton", postal_code: "E1C 4M3" },
  NL: { city: "St. John's", postal_code: "A1C 5M2" },
  NS: { city: "Halifax", postal_code: "B3H 1A1" },
  NT: { city: "Yellowknife", postal_code: "X1A 2L9" },
  NU: { city: "Iqaluit", postal_code: "X0A 0H0" },
  ON: { city: "Toronto", postal_code: "M5V 2T6" },
  PE: { city: "Charlottetown", postal_code: "C1A 1A1" },
  QC: { city: "Montréal", postal_code: "H2Y 1C6" },
  SK: { city: "Regina", postal_code: "S4P 3Y2" },
  YT: { city: "Whitehorse", postal_code: "Y1A 1B1" },
};

const WHEY = "vantage-whey-isolate-2lb";
const SHAKER = "vantage-shaker-700ml";
const CARTS: { label: string; items: { slug: string; quantity: number }[] }[] = [
  { label: "whey", items: [{ slug: WHEY, quantity: 1 }] },
  { label: "whey + shaker", items: [{ slug: WHEY, quantity: 1 }, { slug: SHAKER, quantity: 1 }] },
];
// Extra carts that cross the free-Standard and reduced-Expedited thresholds.
const TIER_CARTS: { label: string; items: { slug: string; quantity: number }[] }[] = [
  { label: "whey ×2", items: [{ slug: WHEY, quantity: 2 }] },
  { label: "whey ×3", items: [{ slug: WHEY, quantity: 3 }] },
];

function categoryOf(slug: string): CategoryKey {
  const product = DEMO.find((d) => d.slug === slug);
  if (!product) throw new Error(`${slug} is not in the demo catalogue`);
  return product.tax;
}

const variantIds = new Map<string, string>();
async function variantFor(slug: string): Promise<string> {
  if (!variantIds.has(slug)) {
    const product = await store.products.get(slug, { expand: ["variants"] });
    const variant = product.variants?.find((v) => v.purchasable && v.in_stock);
    variantIds.set(slug, variant?.id ?? product.default_variant_id);
  }
  return variantIds.get(slug)!;
}

/** Cart with item and fulfillment tax lines (not expandable through the SDK's carts.get). */
async function cartWithTaxLines(cart: Cart): Promise<Cart> {
  const url = `${baseUrl}/api/v3/store/carts/${cart.id}?expand=items.tax_lines,fulfillments.tax_lines`;
  const res = await fetch(url, {
    headers: { "x-spree-api-key": publishableKey(), "x-spree-token": cart.token, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET cart ${cart.id}: ${res.status} ${await res.text()}`);
  return (await res.json()) as Cart;
}

type Lines = Map<string, number>; // rate key → cents

function addLine(lines: Lines, key: string, cents: number) {
  lines.set(key, (lines.get(key) ?? 0) + cents);
}

interface CaseResult {
  province: Province;
  cart: string;
  expected: Lines;
  actual: Lines;
  cartTaxTotal: number;
  rates: { tier: Tier | undefined; cost: number }[];
  itemTotal: number;
  error?: string;
}

async function runCase(
  province: Province,
  spec: { label: string; items: { slug: string; quantity: number }[] },
  rateKeys: Map<string, string>,
): Promise<CaseResult> {
  const result: CaseResult = {
    province,
    cart: spec.label,
    expected: new Map(),
    actual: new Map(),
    cartTaxTotal: 0,
    rates: [],
    itemTotal: 0,
  };
  let cart = await store.carts.create({ currency: "CAD" });
  const opts: RequestOptions = { spreeToken: cart.token };
  try {
    for (const item of spec.items) {
      cart = await store.carts.items.create(cart.id, { variant_id: await variantFor(item.slug), quantity: item.quantity }, opts);
    }
    cart = await store.carts.update(
      cart.id,
      {
        email: "verify-tax@example.com",
        use_shipping: true,
        shipping_address: {
          first_name: "Tax",
          last_name: "Check",
          address1: "100 Main Street",
          city: ADDRESSES[province].city,
          postal_code: ADDRESSES[province].postal_code,
          phone: "6045550100",
          country_code: "CA",
          state_code: province,
        },
      },
      opts,
    );

    if (cart.fulfillments.length !== 1) throw new Error(`expected 1 fulfillment, got ${cart.fulfillments.length}`);
    const [fulfillment] = cart.fulfillments;
    result.rates = fulfillment.delivery_rates.map((r) => ({ tier: tierOf(r), cost: toCents(r.cost ?? "0") }));
    const standard = fulfillment.delivery_rates.filter((r) => tierOf(r) === "Standard");
    if (standard.length !== 1) throw new Error(`expected 1 Standard rate, got ${standard.length}`);
    cart = await store.carts.fulfillments.update(cart.id, fulfillment.id, { selected_delivery_rate_id: standard[0].id }, opts);

    cart = await cartWithTaxLines(cart);
    result.itemTotal = toCents(cart.item_total ?? "0");
    result.cartTaxTotal = toCents(cart.tax_total ?? "0");

    for (const item of cart.items) {
      const basis = toCents(item.discounted_amount ?? "0");
      for (const rate of ratesFor(config, categoryOf(item.slug), province)) {
        addLine(result.expected, rate.key, taxCents(basis, rate.percent));
      }
      for (const line of item.tax_lines ?? []) {
        addLine(result.actual, rateKeys.get(line.tax_rate_id ?? "") ?? `?${line.label}`, toCents(line.amount ?? "0"));
      }
    }
    for (const f of cart.fulfillments) {
      const basis = toCents(f.cost ?? "0");
      for (const rate of ratesFor(config, "shipping", province)) {
        addLine(result.expected, rate.key, taxCents(basis, rate.percent));
      }
      for (const line of f.tax_lines ?? []) {
        addLine(result.actual, rateKeys.get(line.tax_rate_id ?? "") ?? `?${line.label}`, toCents(line.amount ?? "0"));
      }
    }
  } catch (error) {
    result.error = (error as Error).message;
  } finally {
    await store.carts.delete(cart.id, opts).catch(() => undefined);
  }
  return result;
}

const sum = (lines: Lines) => [...lines.values()].reduce((a, b) => a + b, 0);
const sameLines = (a: Lines, b: Lines) =>
  a.size === b.size && [...a].every(([key, cents]) => b.get(key) === cents);

/** "$8.45 (GST 3.65 + PST 4.80)": total, then the breakdown by tax kind (key = category:province:kind). */
function describe(lines: Lines): string {
  const byKind = new Map<string, number>();
  for (const [key, cents] of lines) {
    const kind = key.startsWith("?") ? key : key.split(":")[2];
    byKind.set(kind, (byKind.get(kind) ?? 0) + cents);
  }
  const parts = [...byKind].map(([kind, cents]) => `${kind} ${formatCents(cents)}`);
  return `$${formatCents(sum(lines))}${parts.length ? ` (${parts.join(" + ")})` : ""}`;
}

function tierCheck(r: CaseResult): string | undefined {
  if (r.error) return r.error;
  for (const tier of Object.keys(TIERS) as Tier[]) {
    const offered = r.rates.filter((x) => x.tier === tier);
    if (offered.length !== 1) return `${offered.length} ${tier} rates offered`;
    const want = TIERS[tier](r.itemTotal);
    if (offered[0].cost !== want) return `${tier} $${formatCents(offered[0].cost)} ≠ $${formatCents(want)}`;
  }
  if (r.rates.some((x) => !x.tier)) return "unexpected delivery rate offered";
  return undefined;
}

async function main() {
  const seeded = await listAll<TaxRate>((page) => admin.taxRates.list({ page, limit: 100 }));
  const rateKeys = new Map(
    seeded.filter((r) => typeof r.metadata?.vantage_key === "string").map((r) => [r.id, r.metadata!.vantage_key as string]),
  );

  const results: CaseResult[] = [];
  for (const province of PROVINCES) {
    for (const spec of CARTS) {
      const r = await runCase(province, spec, rateKeys);
      results.push(r);
      process.stderr.write(`${province} ${spec.label}: ${r.error ?? describe(r.actual)}\n`);
    }
  }
  const tierResults: CaseResult[] = [];
  for (const spec of TIER_CARTS) tierResults.push(await runCase("ON", spec, rateKeys));

  const out: string[] = [];
  out.push(
    `Config: ship-from ${config.shipFrom} · provincial registered ${config.registeredProvincial.join(", ")} · SK supplements ${config.skSupplements}`,
  );
  for (const w of warnings) out.push(`⚠ ${w}`);
  out.push("", "| Province | Cart | Expected | Actual | |", "|---|---|---|---|---|");
  let failures = 0;
  for (const r of results) {
    const ok = !r.error && sameLines(r.expected, r.actual) && r.cartTaxTotal === sum(r.expected);
    if (!ok) failures++;
    const actual = r.error ? `error: ${r.error}` : `${describe(r.actual)}${r.cartTaxTotal === sum(r.actual) ? "" : ` · cart tax_total $${formatCents(r.cartTaxTotal)}`}`;
    out.push(`| ${r.province} | ${r.cart} | ${describe(r.expected)} | ${actual} | ${ok ? "✅" : "❌"} |`);
  }

  out.push("", "| Shipping tier check | Item total | Standard | Expedited | |", "|---|---|---|---|---|");
  const tierRow = (label: string, group: CaseResult[]) => {
    const problems = group.map((r) => tierCheck(r)).filter(Boolean);
    if (problems.length) failures++;
    const r = group[0];
    const cost = (tier: Tier) => {
      const costs = [...new Set(group.flatMap((g) => g.rates.filter((x) => x.tier === tier).map((x) => `$${formatCents(x.cost)}`)))];
      return `${costs.join(" / ") || "none"} (want $${formatCents(TIERS[tier](r.itemTotal))})`;
    };
    out.push(
      `| ${label} | $${formatCents(r.itemTotal)} | ${cost("Standard")} | ${cost("Expedited")} | ${problems.length ? `❌ ${problems[0]}` : "✅"} |`,
    );
  };
  for (const spec of CARTS) tierRow(`${spec.label}, all 13 provinces, exactly 1 Standard + 1 Expedited`, results.filter((r) => r.cart === spec.label));
  for (const r of tierResults) tierRow(`${r.cart} (ON)`, [r]);

  const cases = results.length;
  out.push("", `${cases - results.filter((r) => r.error || !sameLines(r.expected, r.actual) || r.cartTaxTotal !== sum(r.expected)).length}/${cases} cart cases ✅ · ${failures ? `${failures} failing row(s)` : "all tier checks ✅"}`);
  console.log(out.join("\n"));
  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error("\n✗ verify-tax failed:", error?.message ?? error);
  if (error?.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});
