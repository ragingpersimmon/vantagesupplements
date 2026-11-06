import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseTaxConfig,
  PROVINCES,
  provincialLayers,
  ratesFor,
  type TaxConfig,
  taxCents,
  taxRates,
  toCents,
} from "./ca-tax-data";

const ALL: TaxConfig = { shipFrom: "BC", registeredProvincial: ["BC", "MB", "QC", "SK"], skSupplements: "unknown" };
const kinds = (config: TaxConfig, category: Parameters<typeof ratesFor>[1], province: Parameters<typeof ratesFor>[2]) =>
  ratesFor(config, category, province).map((r) => r.kind);

describe("parseTaxConfig", () => {
  it("falls back to all four provinces with a warning when REGISTERED_PROVINCIAL is blank", () => {
    const { config, warnings } = parseTaxConfig({ SHIP_FROM_PROVINCE: "BC", REGISTERED_PROVINCIAL: "", SK_SUPPLEMENTS: "unknown" });
    assert.deepEqual(config.registeredProvincial, ["BC", "MB", "QC", "SK"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /REGISTERED_PROVINCIAL is blank/);
  });

  it("parses a comma list case- and space-insensitively", () => {
    const { config, warnings } = parseTaxConfig({ SHIP_FROM_PROVINCE: "bc", REGISTERED_PROVINCIAL: " qc, BC ", SK_SUPPLEMENTS: "Exempt" });
    assert.deepEqual(config, { shipFrom: "BC", registeredProvincial: ["BC", "QC"], skSupplements: "exempt" });
    assert.deepEqual(warnings, []);
  });

  it("rejects provinces without a provincial layer", () => {
    assert.throws(() => parseTaxConfig({ SHIP_FROM_PROVINCE: "BC", REGISTERED_PROVINCIAL: "BC,ON" }), /ON/);
  });

  it("rejects an unknown SK_SUPPLEMENTS answer and an unknown ship-from", () => {
    assert.throws(() => parseTaxConfig({ SHIP_FROM_PROVINCE: "BC", SK_SUPPLEMENTS: "maybe" }), /SK_SUPPLEMENTS/);
    assert.throws(() => parseTaxConfig({ SHIP_FROM_PROVINCE: "XX" }), /SHIP_FROM_PROVINCE/);
  });

  it("defaults blank SHIP_FROM_PROVINCE to BC and blank SK_SUPPLEMENTS to unknown, with warnings", () => {
    const { config, warnings } = parseTaxConfig({ REGISTERED_PROVINCIAL: "BC" });
    assert.equal(config.shipFrom, "BC");
    assert.equal(config.skSupplements, "unknown");
    assert.equal(warnings.length, 2);
  });
});

describe("REGISTERED_PROVINCIAL", () => {
  it("drops goods AND shipping provincial layers for unlisted provinces", () => {
    const config: TaxConfig = { ...ALL, registeredProvincial: ["QC"] };
    assert.deepEqual(kinds(config, "merchandise", "BC"), ["GST"]);
    assert.deepEqual(kinds(config, "merchandise", "MB"), ["GST"]);
    assert.deepEqual(kinds(config, "supplements", "SK"), ["GST"]);
    assert.deepEqual(kinds(config, "shipping", "MB"), ["GST"]);
    assert.deepEqual(kinds(config, "shipping", "SK"), ["GST"]);
    assert.deepEqual(kinds(config, "merchandise", "QC"), ["GST", "QST"]);
    assert.deepEqual(kinds(config, "shipping", "QC"), ["GST", "QST"]);
  });

  it("never drops GST/HST", () => {
    const config: TaxConfig = { ...ALL, registeredProvincial: [] };
    for (const province of PROVINCES) {
      assert.equal(ratesFor(config, "supplements", province).length, 1, province);
      assert.equal(ratesFor(config, "shipping", province).length, 1, province);
    }
    assert.ok(taxRates(config).every((r) => r.kind === "GST" || r.kind === "HST"));
  });

  it("keeps every provincial layer when all four are registered", () => {
    assert.deepEqual(kinds(ALL, "merchandise", "BC"), ["GST", "PST"]);
    assert.deepEqual(kinds(ALL, "supplements", "BC"), ["GST"]); // BC PST-exempt
    assert.deepEqual(kinds(ALL, "supplements", "MB"), ["GST", "RST"]);
    assert.deepEqual(kinds(ALL, "shipping", "MB"), ["GST", "RST"]);
    assert.deepEqual(kinds(ALL, "shipping", "BC"), ["GST"]);
  });
});

describe("SK_SUPPLEMENTS", () => {
  const sk = (skSupplements: TaxConfig["skSupplements"]) => provincialLayers("supplements", { ...ALL, skSupplements }).SK;

  it("exempt removes SK PST from supplements only", () => {
    const config: TaxConfig = { ...ALL, skSupplements: "exempt" };
    assert.equal(sk("exempt"), undefined);
    assert.deepEqual(kinds(config, "supplements", "SK"), ["GST"]);
    assert.deepEqual(kinds(config, "merchandise", "SK"), ["GST", "PST"]);
  });

  it("taxable charges SK PST and clears the verify flag", () => {
    assert.deepEqual(sk("taxable"), {});
    const [, pst] = ratesFor({ ...ALL, skSupplements: "taxable" }, "supplements", "SK");
    assert.equal(pst.kind, "PST");
    assert.equal(pst.verify, false);
  });

  it("unknown charges SK PST but keeps it flagged", () => {
    assert.deepEqual(sk("unknown"), { verify: true });
    const [, pst] = ratesFor(ALL, "supplements", "SK");
    assert.equal(pst.verify, true);
  });

  it("does not charge SK PST when SK is not registered, whatever the answer", () => {
    assert.equal(provincialLayers("supplements", { ...ALL, registeredProvincial: ["BC"], skSupplements: "taxable" }).SK, undefined);
  });
});

describe("rate keys", () => {
  it("are unique, and names are unique store-wide (Spree validates tax rate names per store, across categories)", () => {
    const rates = taxRates(ALL);
    assert.equal(new Set(rates.map((r) => r.key)).size, rates.length);
    const names = rates.map((r) => r.name.toLowerCase());
    assert.equal(new Set(names).size, names.length);
  });
});

describe("money", () => {
  it("rounds tax half up per line, like Spree's internal provider", () => {
    assert.equal(toCents("59.99"), 5999);
    assert.equal(taxCents(5999, "5"), 300); // 2.9995 → 3.00
    assert.equal(taxCents(5999, "9.975"), 598); // 5.9840 → 5.98
    assert.equal(taxCents(1299, "9.975"), 130); // 1.2958 → 1.30
    assert.equal(taxCents(1499, "7"), 105); // 1.0493 → 1.05
    assert.equal(taxCents(10, "5"), 1); // 0.005 → 0.01 (half up)
    assert.equal(taxCents(0, "15"), 0);
  });
});
