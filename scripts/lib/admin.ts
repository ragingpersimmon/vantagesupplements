import { type Client, createAdminClient } from "@spree/admin-sdk";

/**
 * Seeding uses its OWN secret key, separate from the storefront's runtime key,
 * with setup scopes the storefront must never hold:
 *
 *   npx @spree/cli api-key create --name seed --type secret \
 *     --scopes write_settings,write_delivery_methods,write_products,read_all
 *
 * Revoke it after go-live (Spree Admin → Settings → Developers → API keys).
 */
export function adminClient(): Client {
  const baseUrl = process.env.SPREE_API_URL ?? "http://localhost:4000";
  const secretKey = process.env.SPREE_SEED_API_KEY;
  if (!secretKey) {
    console.error("SPREE_SEED_API_KEY is not set. See scripts/.env.example.");
    process.exit(1);
  }
  return createAdminClient({ baseUrl, secretKey, credentials: "omit" });
}

/** Fetches every page of a list endpoint. */
export async function listAll<T>(
  fetchPage: (page: number) => Promise<{ data: T[]; meta: { pages: number } }>,
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const res = await fetchPage(page);
    out.push(...res.data);
    if (page >= (res.meta?.pages ?? 1)) return out;
    page++;
  }
}

export const DRY_RUN = process.argv.includes("--dry-run");

export function log(action: "create" | "update" | "keep" | "skip", what: string) {
  const tag = { create: "+", update: "~", keep: "=", skip: "·" }[action];
  console.log(`${DRY_RUN ? "[dry] " : ""}${tag} ${what}`);
}
