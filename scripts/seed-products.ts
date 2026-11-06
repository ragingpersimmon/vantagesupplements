/**
 * Seeds the supplement catalogue scaffolding + a small demo catalogue:
 *
 *  - Product custom-field definitions the storefront cards read
 *    (protein_per_serving, servings, flavors, dietary_tags)
 *  - A "Flavour" option type
 *  - Five demo products with CAD prices, flavour variants, stock, and the
 *    correct tax category
 *
 *   pnpm seed:products [--dry-run]
 *
 * Run AFTER seed:tax (it looks tax categories up by tax_code). Idempotent:
 * definitions are matched by key, products by slug; existing products are
 * left alone so manual edits in Spree Admin survive re-runs.
 */
import { adminClient, DRY_RUN, listAll, log } from "./lib/admin";
import { TAX_CATEGORIES } from "./lib/ca-tax-data";
import { FIELD_DEFS, FIELD_NAMESPACE as NAMESPACE } from "./lib/custom-fields";
import { DEMO } from "./lib/demo-catalogue";

const admin = adminClient();

async function ensureFieldDefinitions() {
  const existing = await listAll((page) => admin.customFieldDefinitions.list({ page, limit: 100 }));
  const ids: Record<string, string> = {};
  for (const def of FIELD_DEFS) {
    const found = existing.find(
      (d) => d.key === def.key && d.namespace === NAMESPACE && /product/i.test(d.resource_type),
    );
    if (found) {
      log("keep", `custom field ${NAMESPACE}.${def.key}`);
      ids[def.key] = found.id;
      continue;
    }
    log("create", `custom field ${NAMESPACE}.${def.key}`);
    ids[def.key] = DRY_RUN
      ? `dry_${def.key}`
      : (
          await admin.customFieldDefinitions.create({
            ...def,
            namespace: NAMESPACE,
            resource_type: "product",
            storefront_visible: true,
          })
        ).id;
  }
  return ids;
}

async function ensureFlavourOptionType() {
  const all = await listAll((page) => admin.optionTypes.list({ page, limit: 100 }));
  const names = [...new Set(DEMO.flatMap((d) => d.flavors))];
  const found = all.find((o) => o.name === "flavour");
  if (found) {
    log("keep", "option type flavour");
    return;
  }
  log("create", `option type flavour (${names.length} values)`);
  if (!DRY_RUN) {
    await admin.optionTypes.create({
      name: "flavour",
      label: "Flavour",
      kind: "buttons",
      filterable: true,
      option_values: names.map((n, position) => ({
        name: n.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        label: n,
        position,
      })),
    });
  }
}

async function main() {
  console.log(`Seeding products${DRY_RUN ? " — DRY RUN" : ""}\n`);

  const [taxCategories, stockLocations, channels] = await Promise.all([
    listAll((page) => admin.taxCategories.list({ page, limit: 100 })),
    listAll((page) => admin.stockLocations.list({ page, limit: 100 })),
    listAll((page) => admin.channels.list({ page, limit: 100 })),
  ]);
  const taxId = (key: keyof typeof TAX_CATEGORIES) => {
    const cat = taxCategories.find((c) => c.tax_code === TAX_CATEGORIES[key].tax_code);
    if (!cat) throw new Error(`Tax category ${TAX_CATEGORIES[key].tax_code} missing — run pnpm seed:tax first.`);
    return cat.id;
  };
  const stockLocationId = stockLocations[0]?.id;
  if (!stockLocationId) throw new Error("No stock location found. Create one in Spree Admin → Settings → Locations.");
  // The Store API only lists products published on its channel.
  const channel = channels.find((c) => c.default);
  if (!channel) throw new Error("No default sales channel found (Spree Admin → Settings → Channels).");

  const fieldIds = await ensureFieldDefinitions();
  await ensureFlavourOptionType();

  for (const p of DEMO) {
    const existing = await admin.products.list({ slug_eq: p.slug, limit: 1, expand: ["product_publications"] });
    const found = existing.data[0];
    if (found) {
      // Publish once if it never was; a product unpublished in Spree Admin stays unpublished.
      if (!found.product_publications?.length) {
        log("update", `${p.name} → publish on channel ${channel.name}`);
        if (!DRY_RUN) await admin.products.bulkAddToChannels({ ids: [found.id], channel_ids: [channel.id] });
      } else {
        log("skip", `${p.name} (exists — edit in Spree Admin)`);
      }
      continue;
    }

    const prices = [{ currency: "CAD" as const, amount: p.price, compare_at_amount: p.compareAt ?? null }];
    const custom_fields = [
      p.facts.protein_per_serving !== undefined && {
        custom_field_definition_id: fieldIds.protein_per_serving,
        value: p.facts.protein_per_serving,
      },
      p.facts.servings !== undefined && { custom_field_definition_id: fieldIds.servings, value: p.facts.servings },
      p.flavors.length && { custom_field_definition_id: fieldIds.flavors, value: p.flavors },
      p.facts.dietary_tags.length && { custom_field_definition_id: fieldIds.dietary_tags, value: p.facts.dietary_tags },
      p.npn && { custom_field_definition_id: fieldIds.npn, value: p.npn },
    ].filter(Boolean) as { custom_field_definition_id: string; value: unknown }[];

    log("create", `${p.name} — $${p.price} CAD, ${p.flavors.length || 1} variant(s), tax: ${TAX_CATEGORIES[p.tax].name}`);
    if (DRY_RUN) continue;

    await admin.products.create({
      name: p.name,
      slug: p.slug,
      description: p.description,
      status: "active",
      tax_category_id: taxId(p.tax),
      tags: p.facts.dietary_tags,
      prices,
      custom_fields,
      variants: (p.flavors.length ? p.flavors : [null]).map((flavor, i) => ({
        sku: `${p.slug.toUpperCase().replace(/-/g, "_")}_${i + 1}`,
        weight: 1,
        weight_unit: "kg" as const,
        track_inventory: true,
        options: flavor ? [{ name: "flavour", value: flavor.toLowerCase().replace(/[^a-z0-9]+/g, "-") }] : [],
        prices,
        stock_levels: [{ stock_location_id: stockLocationId, count_on_hand: 100 }],
      })),
      product_publications: [{ channel_id: channel.id }],
    });
  }

  console.log("\n✓ Done. Add product photos in Spree Admin → Products.");
}

main().catch((error) => {
  console.error("\n✗ Seed failed:", error?.message ?? error);
  if (error?.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});
