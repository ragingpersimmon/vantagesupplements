import "server-only";

import { createHmac } from "node:crypto";
import { sendEmail } from "@/lib/emails/send";
import { WelcomeDiscountEmail } from "@/lib/emails/welcome-discount";
import { getAdminClient } from "./admin-client";

/**
 * Welcome discount issuance: one single-use, customer-locked, first-order coupon
 * per customer.
 *
 * Idempotency layers. NOTE: Spree does NOT enforce unique promotion codes (no
 * validation, non-unique index), so uniqueness is enforced here:
 *
 *  1. Flag: the customer's metadata holds `welcome_discount_issued` + the code.
 *     Set → return the existing code, send nothing.
 *  2. Lookup before create: the code is an HMAC of the customer ID, so if a
 *     promotion with that code exists (e.g. an earlier attempt created it but
 *     failed before setting the flag) we reuse it instead of creating another.
 *  3. Reconcile after create: two concurrent requests can both pass 1–2. After
 *     creating, each lists every promotion holding the code; the oldest (lowest
 *     id) survives and every other copy is deleted. Only the survivor's request
 *     sends the email. Worst case under a tight race: the same code is emailed
 *     twice. A second working coupon cannot survive.
 *  4. Eligibility: customers with completed orders are skipped, and the
 *     promotion carries `customer` + `first_order` rules, so a leaked code is
 *     unusable by anyone else or on a second order.
 */

const METADATA_FLAG = "welcome_discount_issued";
const METADATA_CODE = "welcome_discount_code";
const METADATA_ISSUED_AT = "welcome_discount_issued_at";

export type WelcomeDiscountResult =
  | { status: "issued"; code: string; expiresAt: string }
  | { status: "already_issued"; code: string | null }
  | { status: "ineligible"; reason: "has_orders" | "disabled" };

function config() {
  const secret = process.env.WELCOME_DISCOUNT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("WELCOME_DISCOUNT_SECRET must be set (≥32 chars).");
  }
  return {
    secret,
    percent: Number(process.env.WELCOME_DISCOUNT_PERCENT ?? "15"),
    ttlDays: Number(process.env.WELCOME_DISCOUNT_TTL_DAYS ?? "30"),
    promotionCategoryId: process.env.WELCOME_PROMOTION_CATEGORY_ID || null,
    enabled: process.env.WELCOME_DISCOUNT_ENABLED !== "false",
  };
}

/**
 * VANTAGE-WELCOME-XXXXXXXX. 8 chars of Crockford base32 from an HMAC of the
 * customer ID: unguessable without the secret, stable per customer.
 */
export function welcomeCodeFor(customerId: string, secret: string): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const digest = createHmac("sha256", secret)
    .update(`welcome:${customerId}`)
    .digest();
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[digest[i] % 32];
  return `VANTAGE-WELCOME-${out}`;
}

export async function issueWelcomeDiscount(
  customerId: string,
): Promise<WelcomeDiscountResult> {
  const cfg = config();
  if (!cfg.enabled) return { status: "ineligible", reason: "disabled" };

  const admin = getAdminClient();
  const customer = await admin.customers.get(customerId);
  const metadata = (customer.metadata ?? {}) as Record<string, unknown>;

  // Layer 1 — flag on the customer record.
  if (metadata[METADATA_FLAG]) {
    return {
      status: "already_issued",
      code: (metadata[METADATA_CODE] as string | undefined) ?? null,
    };
  }

  // Layer 3 — it's a FIRST-order discount.
  if (customer.orders_count > 0) {
    return { status: "ineligible", reason: "has_orders" };
  }

  const code = welcomeCodeFor(customer.id, cfg.secret);
  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + cfg.ttlDays * 86_400_000);

  // Spree stores codes lowercased; lookups must match that.
  const holders = async () =>
    (
      await admin.promotions.list({
        code_eq: code.toLowerCase(),
        sort: "id",
        limit: 25,
      })
    ).data;

  // Layer 2 — reuse a promotion an earlier, interrupted attempt created.
  const existing = await holders();
  if (existing.length > 0) {
    await markIssued(
      customer.id,
      metadata,
      code,
      new Date(existing[0].created_at),
    );
    return { status: "already_issued", code };
  }

  const created = await admin.promotions.create({
    name: `Welcome ${cfg.percent}% — ${customer.email}`,
    description: `Auto-issued on sign-up for ${customer.id}`,
    kind: "coupon_code",
    code,
    usage_limit: 1,
    starts_at: startsAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    match_policy: "all",
    promotion_category_id: cfg.promotionCategoryId,
    rules: [
      // Only this customer may redeem it…
      { type: "customer", customer_ids: [customer.id] },
      // …and only on their first completed order.
      { type: "first_order" },
    ],
    actions: [
      {
        type: "create_adjustment",
        calculator: {
          type: "flat_percent_item_total",
          preferences: { flat_percent: cfg.percent },
        },
      },
    ],
  });

  // Layer 3 — reconcile a concurrent duplicate: oldest wins, others delete.
  const all = await holders();
  const winner = all[0];
  if (winner && winner.id !== created.id) {
    await admin.promotions.delete(created.id).catch((error) => {
      console.error(
        "[welcome-discount] failed to delete duplicate",
        created.id,
        error,
      );
    });
    return { status: "already_issued", code };
  }
  await Promise.all(
    all
      .filter((p) => p.id !== created.id)
      .map((p) =>
        admin.promotions.delete(p.id).catch((error) => {
          console.error(
            "[welcome-discount] failed to delete duplicate",
            p.id,
            error,
          );
        }),
      ),
  );

  await markIssued(customer.id, metadata, code, startsAt);

  try {
    await sendEmail({
      to: customer.email,
      subject: `Your ${cfg.percent}% welcome code is inside`,
      react: WelcomeDiscountEmail({
        firstName: customer.first_name,
        code,
        percent: cfg.percent,
        expiresAt,
      }),
    });
  } catch (error) {
    // The coupon exists and is flagged; don't throw (a retry would be a no-op
    // anyway). Ops can resend from the code stored on the customer.
    console.error("[welcome-discount] email failed", customer.id, error);
  }

  return { status: "issued", code, expiresAt: expiresAt.toISOString() };
}

async function markIssued(
  customerId: string,
  metadata: Record<string, unknown>,
  code: string,
  issuedAt: Date,
) {
  // Merge, don't replace: metadata is a single JSON column on the customer.
  await getAdminClient().customers.update(customerId, {
    metadata: {
      ...metadata,
      [METADATA_FLAG]: true,
      [METADATA_CODE]: code,
      [METADATA_ISSUED_AT]: issuedAt.toISOString(),
    },
  });
}
