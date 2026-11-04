import { NextResponse } from "next/server";
import { getCustomer } from "@/lib/data/customer";
import { issueWelcomeDiscount } from "@/lib/vantage/welcome-discount";

/**
 * POST /api/auth/signup-discount
 *
 * Issues the first-order welcome coupon for the CURRENTLY SIGNED-IN customer.
 *
 * - Identity comes from the httpOnly Spree session cookie, never from the
 *   request body, so a caller can't request a coupon for someone else.
 * - Idempotent: repeat calls (callback refresh, retries, other tabs) return the
 *   same code with `status: "already_issued"` and send no second email.
 * - The Google sign-in server action (`loginWithGoogle`) already calls the same
 *   service; this route covers retries and other sign-up paths (e.g. email
 *   registration) that want to opt in.
 */
export async function POST() {
  const customer = await getCustomer();
  if (!customer) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const result = await issueWelcomeDiscount(customer.id);
    // Codes are only ever returned to their owner, over an authenticated call.
    return NextResponse.json(result, {
      status: result.status === "issued" ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[signup-discount] failed", customer.id, error);
    return NextResponse.json(
      { error: "discount_unavailable" },
      { status: 502 },
    );
  }
}
