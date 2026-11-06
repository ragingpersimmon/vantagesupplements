/**
 * One-shot, idempotent store bootstrap (run after `docker compose up` + db:seed):
 *
 *   pnpm setup-store
 *
 * 1. Mints the three least-privilege API keys (README § 2) if the env files still
 *    hold placeholders. Secret tokens are shown only once by Spree, so a key that
 *    is already in the env file is never re-minted.
 * 2. Via the Admin API: default market "Canada" (CAD, en + fr, country CA), which
 *    makes the store currency CAD and default country Canada, plus one stock
 *    location "Main warehouse" in SHIP_FROM_PROVINCE.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Market, StockLocation } from "@spree/admin-sdk";
import { adminClient, DRY_RUN, listAll, log } from "./lib/admin";
import { PROVINCES, type Province } from "./lib/ca-tax-data";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface KeySpec {
  name: string;
  type: "publishable" | "secret";
  scopes: string;
  /** env file (repo-relative) -> variable that receives the token */
  targets: Record<string, string>;
}

const KEYS: KeySpec[] = [
  {
    name: "storefront",
    type: "publishable",
    scopes: "",
    targets: { "storefront/.env.local": "SPREE_PUBLISHABLE_KEY" },
  },
  {
    name: "storefront-runtime",
    type: "secret",
    scopes: "read_customers,write_customers,read_promotions,write_promotions",
    targets: { "storefront/.env.local": "SPREE_ADMIN_API_KEY" },
  },
  {
    name: "seed",
    type: "secret",
    scopes: "write_settings,write_delivery_methods,write_products,read_all",
    targets: { "scripts/.env": "SPREE_SEED_API_KEY" },
  },
];

const isReal = (value: string | undefined, prefix: "pk_" | "sk_") =>
  Boolean(value && value.startsWith(prefix) && !/replace|your_/.test(value));

function envValue(file: string, key: string): string | undefined {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(resolve(root, file), "utf8"));
  return m?.[1];
}

function setEnvValue(file: string, key: string, value: string) {
  const path = resolve(root, file);
  const text = readFileSync(path, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(path, re.test(text) ? text.replace(re, () => `${key}=${value}`) : `${text.replace(/\n*$/, "\n")}${key}=${value}\n`);
}

function ensureKeys() {
  for (const spec of KEYS) {
    const prefix = spec.type === "publishable" ? "pk_" : "sk_";
    const [[file, variable]] = Object.entries(spec.targets);
    if (isReal(envValue(file, variable), prefix)) {
      log("keep", `API key ${spec.name}`);
      continue;
    }
    if (DRY_RUN) {
      log("create", `API key ${spec.name}`);
      continue;
    }
    const token = execFileSync(
      "docker",
      ["compose", "exec", "-T", "-e", `NAME=${spec.name}`, "-e", `KEY_TYPE=${spec.type}`, "-e", `SCOPES=${spec.scopes}`, "web", "bin/rails", "spree:cli:create_api_key"],
      { cwd: resolve(root, "backend"), encoding: "utf8" },
    )
      .trim()
      .split(/\s+/)
      .pop();
    if (!token?.startsWith(prefix)) throw new Error(`Unexpected output minting key ${spec.name}`);
    for (const [f, v] of Object.entries(spec.targets)) setEnvValue(f, v, token);
    log("create", `API key ${spec.name} -> ${Object.values(spec.targets).join(", ")}`);
  }
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

async function ensureMarket(admin: ReturnType<typeof adminClient>) {
  const desired = {
    name: "Canada",
    currency: "CAD",
    default_locale: "en",
    supported_locales: ["en", "fr"],
    country_codes: ["CA"],
    tax_inclusive: false,
    default: true,
  } as const;
  const markets = await listAll<Market>((page) => admin.markets.list({ page, limit: 100 }));
  const found = markets.find((m) => m.name === desired.name);
  if (!found) {
    log("create", "market Canada (CAD, en+fr)");
    if (!DRY_RUN) await admin.markets.create({ ...desired, supported_locales: [...desired.supported_locales], country_codes: [...desired.country_codes] });
    return;
  }
  const drift =
    found.currency !== desired.currency ||
    found.default_locale !== desired.default_locale ||
    !found.default ||
    found.tax_inclusive !== desired.tax_inclusive ||
    !sameSet(found.supported_locales, [...desired.supported_locales]) ||
    !sameSet(found.country_codes, [...desired.country_codes]);
  if (!drift) return log("keep", "market Canada");
  log("update", "market Canada");
  if (!DRY_RUN)
    await admin.markets.update(found.id, { ...desired, supported_locales: [...desired.supported_locales], country_codes: [...desired.country_codes] });
}

async function ensureStockLocation(admin: ReturnType<typeof adminClient>, province: Province) {
  const locations = await listAll<StockLocation>((page) => admin.stockLocations.list({ page, limit: 100 }));
  const found = locations.find((l) => l.name === "Main warehouse");
  if (!found) {
    log("create", `stock location Main warehouse (${province})`);
    if (!DRY_RUN) await admin.stockLocations.create({ name: "Main warehouse", kind: "warehouse", active: true, default: true, country_code: "CA", state_code: province });
    return;
  }
  if (found.country_code === "CA" && found.state_code === province && found.active) return log("keep", "stock location Main warehouse");
  log("update", `stock location Main warehouse -> ${province}`);
  if (!DRY_RUN) await admin.stockLocations.update(found.id, { country_code: "CA", state_code: province, active: true });
}

ensureKeys();

const province = process.env.SHIP_FROM_PROVINCE as Province | undefined;
if (!province || !PROVINCES.includes(province)) {
  console.error("Set SHIP_FROM_PROVINCE in scripts/.env (e.g. BC).");
  process.exit(1);
}

// The seed key was just written to scripts/.env; pick it up for this run.
process.env.SPREE_SEED_API_KEY = envValue("scripts/.env", "SPREE_SEED_API_KEY");
const admin = adminClient();
await ensureMarket(admin);
await ensureStockLocation(admin, province);
const store = await admin.store.get();
console.log(`store: currency=${store.default_currency} country=${store.default_country_code} locale=${store.default_locale}`);
