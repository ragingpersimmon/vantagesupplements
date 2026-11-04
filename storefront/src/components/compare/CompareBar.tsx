"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCompare } from "@/contexts/CompareContext";
import { extractBasePath } from "@/lib/utils/path";
import { MAX_COMPARE } from "@/lib/vantage/supplement";

/** Sticky tray showing the current comparison selection. */
export function CompareBar() {
  const { items, remove, clear } = useCompare();
  const pathname = usePathname();
  const t = useTranslations("products");

  // Hidden when empty, on the compare page itself, and during checkout.
  if (
    items.length === 0 ||
    pathname.endsWith("/compare") ||
    pathname.includes("/checkout")
  ) {
    return null;
  }

  const basePath = extractBasePath(pathname);
  const href = `${basePath}/compare?products=${items.map((i) => encodeURIComponent(i.slug)).join(",")}`;

  return (
    <aside
      aria-label={t("compareTray")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-navy/20 bg-brand-navy text-white shadow-lg"
    >
      <div className="container mx-auto flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="text-sm font-semibold">
          {t("compareCount", { count: items.length, max: MAX_COMPARE })}
        </span>
        <ul className="flex flex-1 flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item.slug}
              className="flex items-center gap-1 rounded-full bg-white/10 py-1 pl-3 pr-1 text-xs"
            >
              <span className="max-w-[10rem] truncate">{item.name}</span>
              <button
                type="button"
                onClick={() => remove(item.slug)}
                className="rounded-full p-1 hover:bg-white/20"
                aria-label={t("compareRemove", { name: item.name })}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={clear} className="text-xs underline">
          {t("compareClear")}
        </button>
        <Link
          href={href}
          aria-disabled={items.length < 2}
          className={`rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-white ${
            items.length < 2 ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {t("compareNow")}
        </Link>
      </div>
    </aside>
  );
}
