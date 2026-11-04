"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MAX_COMPARE } from "@/lib/vantage/supplement";

/**
 * Product comparison selection (max 3). Holds only slug + name: the compare
 * page fetches fresh product data server-side, so prices are never stale.
 *
 * Persisted to sessionStorage so a reload keeps the selection. Storage can be
 * unavailable (private mode, embedded contexts), hence the try/catch.
 */
export interface CompareItem {
  slug: string;
  name: string;
}

interface CompareContextType {
  items: CompareItem[];
  isSelected: (slug: string) => boolean;
  /** Returns false when the limit is reached. */
  toggle: (item: CompareItem) => boolean;
  remove: (slug: string) => void;
  clear: () => void;
  isFull: boolean;
}

const STORAGE_KEY = "vantage:compare";
const CompareContext = createContext<CompareContextType | undefined>(undefined);

function readStored(): CompareItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed) ? parsed.slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
}

function writeStored(items: CompareItem[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable — selection still works for this page view */
  }
}

export function CompareProvider({ children }: { children: ReactNode }) {
  // Start empty so server and first client render match (no hydration
  // mismatch), then restore from storage once mounted.
  const [items, setItems] = useState<CompareItem[]>([]);
  useEffect(() => {
    setItems(readStored());
  }, []);

  const update = useCallback((next: CompareItem[]) => {
    setItems(next);
    writeStored(next);
  }, []);

  const isSelected = useCallback(
    (slug: string) => items.some((i) => i.slug === slug),
    [items],
  );

  const toggle = useCallback(
    (item: CompareItem) => {
      if (items.some((i) => i.slug === item.slug)) {
        update(items.filter((i) => i.slug !== item.slug));
        return true;
      }
      if (items.length >= MAX_COMPARE) return false;
      update([...items, item]);
      return true;
    },
    [items, update],
  );

  const remove = useCallback(
    (slug: string) => update(items.filter((i) => i.slug !== slug)),
    [items, update],
  );
  const clear = useCallback(() => update([]), [update]);

  const value = useMemo(
    () => ({
      items,
      isSelected,
      toggle,
      remove,
      clear,
      isFull: items.length >= MAX_COMPARE,
    }),
    [items, isSelected, toggle, remove, clear],
  );

  return (
    <CompareContext.Provider value={value}>{children}</CompareContext.Provider>
  );
}

export function useCompare() {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error("useCompare must be used within a CompareProvider");
  return ctx;
}

/** Like useCompare, but returns null outside a provider (e.g. isolated tests). */
export function useOptionalCompare() {
  return useContext(CompareContext) ?? null;
}
