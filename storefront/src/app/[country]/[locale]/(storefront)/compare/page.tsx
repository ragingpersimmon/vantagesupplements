import type { Product } from "@spree/sdk";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getProduct } from "@/lib/data/products";
import {
  getSupplementFacts,
  getValueMetrics,
  MAX_COMPARE,
} from "@/lib/vantage/supplement";

interface ComparePageProps {
  params: Promise<{ country: string; locale: string }>;
  searchParams: Promise<{ products?: string }>;
}

// Selection-specific page: keep it out of the index (no thin/duplicate content).
export const metadata: Metadata = {
  title: "Compare products",
  robots: { index: false, follow: true },
};

function formatCad(amount: number | null, currency: string, locale: string) {
  if (amount === null) return "—";
  return new Intl.NumberFormat(`${locale}-CA`, {
    style: "currency",
    currency,
  }).format(amount);
}

export default async function ComparePage({
  params,
  searchParams,
}: ComparePageProps) {
  const { country, locale } = await params;
  const { products: raw = "" } = await searchParams;
  const basePath = `/${country}/${locale}`;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "products",
  });

  const slugs = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_COMPARE);

  // Parallel server-side fetches: no client-side waterfall.
  const results = await Promise.allSettled(
    slugs.map((slug) => getProduct(slug, { expand: ["custom_fields"] })),
  );
  const products = results
    .filter(
      (r): r is PromiseFulfilledResult<Product> => r.status === "fulfilled",
    )
    .map((r) => r.value);

  if (products.length < 2) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-navy">
          {t("compareTitle")}
        </h1>
        <p className="mt-4 text-gray-600">{t("compareNeedTwo")}</p>
        <Link
          href={`${basePath}/products`}
          className="mt-6 inline-block text-brand-orange-dark underline"
        >
          {t("allProducts")}
        </Link>
      </div>
    );
  }

  const rows = products.map((p) => {
    const facts = getSupplementFacts(p.custom_fields);
    return { product: p, facts, metrics: getValueMetrics(p, facts) };
  });

  // Highlight the best value per row.
  const minBy = (pick: (r: (typeof rows)[number]) => number | null) => {
    const vals = rows.map(pick).filter((v): v is number => v !== null);
    return vals.length ? Math.min(...vals) : null;
  };
  const maxBy = (pick: (r: (typeof rows)[number]) => number | null) => {
    const vals = rows.map(pick).filter((v): v is number => v !== null);
    return vals.length ? Math.max(...vals) : null;
  };
  const best = {
    protein: maxBy((r) => r.facts.proteinPerServing),
    servings: maxBy((r) => r.facts.servings),
    perServing: minBy((r) => r.metrics.pricePerServing),
    per100g: minBy((r) => r.metrics.pricePer100gProtein),
  };
  const cell = (isBest: boolean) =>
    `px-4 py-3 text-sm ${isBest ? "font-semibold text-brand-orange-dark" : "text-gray-900"}`;

  const currency = products[0].price?.currency ?? "CAD";

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="mb-6 text-3xl font-bold text-brand-navy">
        {t("compareTitle")}
      </h1>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
          <caption className="sr-only">{t("compareTitle")}</caption>
          <thead className="bg-brand-navy text-white">
            <tr>
              <th scope="col" className="w-44 px-4 py-3 text-sm font-medium">
                <span className="sr-only">{t("compareAttribute")}</span>
              </th>
              {rows.map(({ product }) => (
                <th
                  key={product.id}
                  scope="col"
                  className="px-4 py-3 text-sm font-semibold"
                >
                  <Link
                    href={`${basePath}/products/${product.slug}`}
                    className="hover:underline"
                  >
                    {product.name}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <th
                scope="row"
                className="px-4 py-3 text-sm font-medium text-gray-500"
              >
                {t("price")}
              </th>
              {rows.map(({ product }) => (
                <td key={product.id} className={cell(false)}>
                  {formatCad(
                    Number(product.price?.amount ?? Number.NaN) || null,
                    currency,
                    locale,
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th
                scope="row"
                className="px-4 py-3 text-sm font-medium text-gray-500"
              >
                {t("proteinPerServing")}
              </th>
              {rows.map(({ product, facts }) => (
                <td
                  key={product.id}
                  className={cell(
                    facts.proteinPerServing !== null &&
                      facts.proteinPerServing === best.protein,
                  )}
                >
                  {facts.proteinPerServing !== null
                    ? t("gramsValue", { value: facts.proteinPerServing })
                    : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <th
                scope="row"
                className="px-4 py-3 text-sm font-medium text-gray-500"
              >
                {t("servingsPerContainer")}
              </th>
              {rows.map(({ product, facts }) => (
                <td
                  key={product.id}
                  className={cell(
                    facts.servings !== null && facts.servings === best.servings,
                  )}
                >
                  {facts.servings ?? "—"}
                </td>
              ))}
            </tr>
            <tr>
              <th
                scope="row"
                className="px-4 py-3 text-sm font-medium text-gray-500"
              >
                {t("pricePerServing")}
              </th>
              {rows.map(({ product, metrics }) => (
                <td
                  key={product.id}
                  className={cell(
                    metrics.pricePerServing !== null &&
                      metrics.pricePerServing === best.perServing,
                  )}
                >
                  {formatCad(metrics.pricePerServing, currency, locale)}
                </td>
              ))}
            </tr>
            <tr>
              <th
                scope="row"
                className="px-4 py-3 text-sm font-medium text-gray-500"
              >
                {t("pricePer100gProtein")}
              </th>
              {rows.map(({ product, metrics }) => (
                <td
                  key={product.id}
                  className={cell(
                    metrics.pricePer100gProtein !== null &&
                      metrics.pricePer100gProtein === best.per100g,
                  )}
                >
                  {formatCad(metrics.pricePer100gProtein, currency, locale)}
                </td>
              ))}
            </tr>
            <tr>
              <th
                scope="row"
                className="px-4 py-3 text-sm font-medium text-gray-500"
              >
                {t("flavors")}
              </th>
              {rows.map(({ product, facts }) => (
                <td key={product.id} className={cell(false)}>
                  {facts.flavors.length ? facts.flavors.join(", ") : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <th
                scope="row"
                className="px-4 py-3 text-sm font-medium text-gray-500"
              >
                {t("dietaryTags")}
              </th>
              {rows.map(({ product, facts }) => (
                <td key={product.id} className={cell(false)}>
                  {facts.dietaryTags.length
                    ? facts.dietaryTags.join(", ")
                    : "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">{t("compareBestHint")}</p>
    </div>
  );
}
