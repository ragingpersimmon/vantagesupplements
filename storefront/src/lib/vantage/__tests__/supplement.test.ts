import type { CustomField } from "@spree/sdk";
import { describe, expect, it } from "vitest";
import { getSupplementFacts, getValueMetrics } from "../supplement";

const field = (
  key: string,
  value: unknown,
  field_type: CustomField["field_type"] = "short_text",
): CustomField => ({
  id: key,
  key,
  label: key,
  field_type,
  value,
});

describe("getSupplementFacts", () => {
  it("parses numbers, JSON arrays and comma lists", () => {
    const facts = getSupplementFacts([
      field("protein_per_serving", "25", "number"),
      field("servings", 30, "number"),
      field("flavors", '["Chocolate","Vanilla"]', "json"),
      field("dietary_tags", "Vegan, Gluten-free"),
    ]);
    expect(facts).toEqual({
      proteinPerServing: 25,
      servings: 30,
      flavors: ["Chocolate", "Vanilla"],
      dietaryTags: ["Vegan", "Gluten-free"],
    });
  });

  it("tolerates missing or junk values", () => {
    expect(getSupplementFacts([field("servings", "lots")])).toEqual({
      proteinPerServing: null,
      servings: null,
      flavors: [],
      dietaryTags: [],
    });
    expect(getSupplementFacts(undefined).servings).toBeNull();
  });
});

describe("getValueMetrics", () => {
  it("computes price per serving and per 100 g protein", () => {
    const m = getValueMetrics(
      { price: { amount: "60.00" } as never },
      { proteinPerServing: 25, servings: 30, flavors: [], dietaryTags: [] },
    );
    expect(m.pricePerServing).toBeCloseTo(2);
    expect(m.totalProtein).toBe(750);
    expect(m.pricePer100gProtein).toBeCloseTo(8);
  });
});
