import type { CustomField, Product } from "@spree/sdk";

/**
 * Supplement-specific attributes, stored as Spree product Custom Fields
 * (Spree Admin → Settings → Custom Fields → Product). Keys are fixed:
 *
 *   key                   type          example
 *   protein_per_serving   number        25          (grams)
 *   servings              number        30          (per container)
 *   flavors               json | text   ["Chocolate","Vanilla"] or "Chocolate, Vanilla"
 *   dietary_tags          json | text   ["Vegan","Gluten-free"]
 *
 * Flavour is ALSO the variant option type that drives the buy box; `flavors`
 * here is the lightweight summary for cards, so listings don't have to expand
 * every variant.
 */
export const SUPPLEMENT_FIELD_KEYS = {
  proteinPerServing: "protein_per_serving",
  servings: "servings",
  flavors: "flavors",
  dietaryTags: "dietary_tags",
} as const;

export interface SupplementFacts {
  proteinPerServing: number | null;
  servings: number | null;
  flavors: string[];
  dietaryTags: string[];
}

function toNumber(value: unknown): number | null {
  const n =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toList(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        return toList(JSON.parse(trimmed));
      } catch {
        /* fall through to comma split */
      }
    }
    return trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function getSupplementFacts(
  fields: CustomField[] | undefined,
): SupplementFacts {
  // Accept both bare keys and namespaced ones ("vantage.servings").
  const byKey = new Map(
    (fields ?? []).map((f) => [f.key.split(".").pop() ?? f.key, f.value]),
  );
  return {
    proteinPerServing: toNumber(
      byKey.get(SUPPLEMENT_FIELD_KEYS.proteinPerServing),
    ),
    servings: toNumber(byKey.get(SUPPLEMENT_FIELD_KEYS.servings)),
    flavors: toList(byKey.get(SUPPLEMENT_FIELD_KEYS.flavors)),
    dietaryTags: toList(byKey.get(SUPPLEMENT_FIELD_KEYS.dietaryTags)),
  };
}

/** Value metrics shoppers actually compare on. Null when inputs are missing. */
export function getValueMetrics(
  product: Pick<Product, "price">,
  facts: SupplementFacts,
) {
  const price = toNumber(product.price?.amount);
  const pricePerServing =
    price !== null && facts.servings ? price / facts.servings : null;
  const totalProtein =
    facts.proteinPerServing !== null && facts.servings !== null
      ? facts.proteinPerServing * facts.servings
      : null;
  const pricePer100gProtein =
    price !== null && totalProtein ? (price / totalProtein) * 100 : null;
  return { pricePerServing, totalProtein, pricePer100gProtein };
}

export const MAX_COMPARE = 3;
