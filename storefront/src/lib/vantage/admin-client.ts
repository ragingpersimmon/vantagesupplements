import "server-only";

import { type Client, createAdminClient } from "@spree/admin-sdk";

/**
 * Server-only Spree Admin API client.
 *
 * `import "server-only"` makes the build fail if any client component imports
 * this module, so SPREE_ADMIN_API_KEY can never be bundled for the browser.
 * The variable deliberately has no NEXT_PUBLIC_ prefix for the same reason.
 *
 * Mint the key with the narrowest scopes the storefront needs:
 *   npx @spree/cli api-key create --name storefront-runtime --type secret \
 *     --scopes read_customers,write_customers,read_promotions,write_promotions
 */
let _admin: Client | null = null;

export function getAdminClient(): Client {
  if (_admin) return _admin;

  const baseUrl = process.env.SPREE_API_URL;
  const secretKey = process.env.SPREE_ADMIN_API_KEY;
  if (!baseUrl || !secretKey) {
    throw new Error(
      "Spree Admin API is not configured: set SPREE_API_URL and SPREE_ADMIN_API_KEY.",
    );
  }

  _admin = createAdminClient({
    baseUrl,
    secretKey,
    // Server-to-server: no cookies should flow.
    credentials: "omit",
  });
  return _admin;
}
