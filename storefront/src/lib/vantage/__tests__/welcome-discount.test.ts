// @vitest-environment node
import { SpreeError } from "@spree/admin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const admin = {
  customers: { get: vi.fn(), update: vi.fn() },
  promotions: { create: vi.fn() },
};
vi.mock("../admin-client", () => ({ getAdminClient: () => admin }));

const sendEmail = vi.fn();
vi.mock("@/lib/emails/send", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));
vi.mock("@/lib/emails/welcome-discount", () => ({
  WelcomeDiscountEmail: () => null,
}));

const { issueWelcomeDiscount, welcomeCodeFor } = await import(
  "../welcome-discount"
);

const SECRET = "x".repeat(40);
const customer = (over: Record<string, unknown> = {}) => ({
  id: "cus_abc",
  email: "ada@example.com",
  first_name: "Ada",
  orders_count: 0,
  metadata: { source: "google" },
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  process.env.WELCOME_DISCOUNT_SECRET = SECRET;
  process.env.WELCOME_DISCOUNT_PERCENT = "15";
});

describe("welcomeCodeFor", () => {
  it("is deterministic per customer and differs across customers", () => {
    expect(welcomeCodeFor("cus_1", SECRET)).toBe(
      welcomeCodeFor("cus_1", SECRET),
    );
    expect(welcomeCodeFor("cus_1", SECRET)).not.toBe(
      welcomeCodeFor("cus_2", SECRET),
    );
    expect(welcomeCodeFor("cus_1", SECRET)).toMatch(
      /^VANTAGE-WELCOME-[0-9A-HJKMNP-TV-Z]{8}$/,
    );
  });
});

describe("issueWelcomeDiscount", () => {
  it("creates a customer-locked, single-use, first-order promotion, flags the customer, and emails", async () => {
    admin.customers.get.mockResolvedValue(customer());

    const result = await issueWelcomeDiscount("cus_abc");

    expect(result.status).toBe("issued");
    const body = admin.promotions.create.mock.calls[0][0];
    expect(body).toMatchObject({
      kind: "coupon_code",
      usage_limit: 1,
      match_policy: "all",
    });
    expect(body.rules).toEqual([
      { type: "customer", customer_ids: ["cus_abc"] },
      { type: "first_order" },
    ]);
    expect(body.actions[0].calculator.preferences.flat_percent).toBe(15);
    // existing metadata preserved
    expect(admin.customers.update.mock.calls[0][1].metadata).toMatchObject({
      source: "google",
      welcome_discount_issued: true,
      welcome_discount_code: body.code,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the flag is already set (callback refresh)", async () => {
    admin.customers.get.mockResolvedValue(
      customer({
        metadata: {
          welcome_discount_issued: true,
          welcome_discount_code: "VANTAGE-WELCOME-AAAA0000",
        },
      }),
    );
    const result = await issueWelcomeDiscount("cus_abc");
    expect(result).toEqual({
      status: "already_issued",
      code: "VANTAGE-WELCOME-AAAA0000",
    });
    expect(admin.promotions.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("backs off without emailing when a concurrent request already created the code", async () => {
    admin.customers.get.mockResolvedValue(customer());
    admin.promotions.create.mockRejectedValue(
      new SpreeError(
        {
          error: {
            code: "validation_error",
            message: "Invalid",
            details: { code: ["has already been taken"] },
          },
        },
        422,
      ),
    );
    const result = await issueWelcomeDiscount("cus_abc");
    expect(result.status).toBe("already_issued");
    expect(admin.customers.update).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips customers who already have orders", async () => {
    admin.customers.get.mockResolvedValue(customer({ orders_count: 2 }));
    expect(await issueWelcomeDiscount("cus_abc")).toEqual({
      status: "ineligible",
      reason: "has_orders",
    });
    expect(admin.promotions.create).not.toHaveBeenCalled();
  });

  it("still succeeds when the email provider fails", async () => {
    admin.customers.get.mockResolvedValue(customer());
    sendEmail.mockRejectedValue(new Error("resend down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await issueWelcomeDiscount("cus_abc")).status).toBe("issued");
  });
});
