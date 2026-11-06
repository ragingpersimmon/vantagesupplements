/** Product custom-field definitions the storefront cards read (namespace "vantage"). */
export const FIELD_NAMESPACE = "vantage";

/**
 * Field types Spree 6 allows `searchable: true` on (CustomFieldDefinition::
 * SearchCapabilities rejects others with "Searchable is only supported for
 * field types: short text, long text, number").
 */
export const SEARCHABLE_FIELD_TYPES: readonly string[] = ["short_text", "long_text", "number"];

export const FIELD_DEFS = [
  { key: "protein_per_serving", label: "Protein per serving (g)", field_type: "number", searchable: false },
  { key: "servings", label: "Servings per container", field_type: "number", searchable: false },
  { key: "flavors", label: "Flavours", field_type: "json", searchable: false },
  // json can't be searchable; shoppers filter by dietary tag through the
  // product tags, which seed-products sets from the same list.
  { key: "dietary_tags", label: "Dietary tags", field_type: "json", searchable: false },
  // Health Canada Natural Product Number (8 digits). Shown on the product page
  // via the storefront's custom-fields block. Required before selling.
  { key: "npn", label: "NPN", field_type: "short_text", searchable: false },
] as const;
