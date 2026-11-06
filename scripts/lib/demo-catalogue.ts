import type { TAX_CATEGORIES } from "./ca-tax-data";

/** Demo catalogue shared by seed-products and local-llm product-copy. */
export type Demo = {
  slug: string;
  name: string;
  description: string;
  tax: keyof typeof TAX_CATEGORIES;
  price: string;
  compareAt?: string;
  flavors: string[];
  facts: { protein_per_serving?: number; servings?: number; dietary_tags: string[] };
  /** Placeholder only. Replace with the real licence number from Health Canada. */
  npn?: string;
};

export const DEMO: Demo[] = [
  {
    slug: "vantage-whey-isolate-2lb",
    name: "Vantage Whey Isolate — 2 lb",
    description: "Cold-filtered whey protein isolate. 25 g protein, 1 g sugar per scoop.",
    tax: "supplements",
    price: "59.99",
    compareAt: "69.99",
    flavors: ["Chocolate", "Vanilla", "Cookies & Cream"],
    facts: { protein_per_serving: 25, servings: 30, dietary_tags: ["Gluten-free", "Low sugar"] },
  },
  {
    slug: "vantage-plant-protein-2lb",
    name: "Vantage Plant Protein — 2 lb",
    description: "Pea + brown rice protein blend with a complete amino acid profile.",
    tax: "supplements",
    price: "54.99",
    flavors: ["Chocolate", "Unflavoured"],
    facts: { protein_per_serving: 21, servings: 28, dietary_tags: ["Vegan", "Gluten-free", "Dairy-free"] },
  },
  {
    slug: "vantage-pre-workout",
    name: "Vantage Ignite Pre-Workout",
    description: "200 mg caffeine, 6 g citrulline malate, 3.2 g beta-alanine per serving.",
    tax: "supplements",
    price: "44.99",
    flavors: ["Blue Raspberry", "Fruit Punch"],
    facts: { servings: 30, dietary_tags: ["Vegan", "Sugar-free"] },
  },
  {
    slug: "vantage-creatine-monohydrate-500g",
    name: "Vantage Creatine Monohydrate — 500 g",
    description: "Micronized creatine monohydrate. 5 g per serving.",
    tax: "supplements",
    price: "34.99",
    flavors: ["Unflavoured"],
    facts: { servings: 100, dietary_tags: ["Vegan", "Unflavoured"] },
  },
  {
    slug: "vantage-shaker-700ml",
    name: "Vantage Shaker Bottle — 700 ml",
    description: "Leak-proof BPA-free shaker with a stainless steel whisk ball.",
    tax: "merchandise",
    price: "14.99",
    flavors: [],
    facts: { dietary_tags: [] },
  },
];
