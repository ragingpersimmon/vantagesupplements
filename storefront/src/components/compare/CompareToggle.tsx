"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useOptionalCompare } from "@/contexts/CompareContext";
import { MAX_COMPARE } from "@/lib/vantage/supplement";

export function CompareToggle({ slug, name }: { slug: string; name: string }) {
  const compare = useOptionalCompare();
  const t = useTranslations("products");
  if (!compare) return null;

  const checked = compare.isSelected(slug);
  const disabled = !checked && compare.isFull;

  return (
    <label
      className={`relative z-10 mt-3 inline-flex cursor-pointer items-center gap-2 text-xs font-medium ${
        disabled ? "cursor-not-allowed text-gray-400" : "text-brand-navy"
      }`}
      title={disabled ? t("compareLimit", { max: MAX_COMPARE }) : undefined}
    >
      <input
        type="checkbox"
        className="size-4 accent-brand-orange"
        checked={checked}
        disabled={disabled}
        onChange={() => {
          if (!compare.toggle({ slug, name })) {
            toast.message(t("compareLimit", { max: MAX_COMPARE }));
          }
        }}
      />
      {t("compare")}
    </label>
  );
}
