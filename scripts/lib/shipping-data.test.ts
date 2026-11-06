import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toCents } from "./ca-tax-data";
import { SHIPPING } from "./shipping-data";

describe("SHIPPING tiers", () => {
  it("have unique names and codes (Spree validates delivery method names per store)", () => {
    assert.equal(new Set(SHIPPING.map((s) => s.name.toLowerCase())).size, SHIPPING.length);
    assert.equal(new Set(SHIPPING.map((s) => s.code)).size, SHIPPING.length);
  });

  it("cover every item total exactly once per service, without gaps", () => {
    for (const service of ["Standard", "Expedited"]) {
      const tiers = SHIPPING.filter((s) => s.name.startsWith(service));
      assert.equal(tiers.length, 2, service);
      const [low, high] = tiers;
      assert.equal(low.min, null);
      assert.equal(high.max, null);
      assert.equal(toCents(low.max!) + 1, toCents(high.min!), service);
    }
  });
});
