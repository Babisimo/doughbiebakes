"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { CartLine } from "@/lib/types";

const STORAGE_KEY = "doughbie-cart";
const PROMO_KEY = "doughbie-promo";

type CartContextValue = {
  lines: CartLine[];
  count: number;
  /**
   * Increment a line. `max` is the per-product ceiling (typically `remaining`
   * loaves in the drop) — without it the global 20-per-line cap applies. Using
   * a functional setState here is what makes rapid-fire clicks safe: each
   * queued update sees the previous queued quantity, not a stale snapshot.
   */
  add: (slug: string, quantity?: number, max?: number) => void;
  setQuantity: (slug: string, quantity: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
  ready: boolean;
  /** Promo code the customer entered. Shared across /cart and /reserve and
   * persisted, so it's entered once and carried through the whole order. */
  promoCode: string;
  /** Validated discount for `promoCode` (0 when absent / invalid / unchecked). */
  promoPercentOff: number;
  /** True while `promoCode` is being validated against /api/promo. */
  promoChecking: boolean;
  setPromoCode: (code: string) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function sanitize(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CartLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const slug = (item as { slug?: unknown }).slug;
    const quantity = Math.floor(Number((item as { quantity?: unknown }).quantity));
    if (typeof slug !== "string" || seen.has(slug)) continue;
    if (!Number.isFinite(quantity) || quantity < 1) continue;
    seen.add(slug);
    out.push({ slug, quantity: Math.min(quantity, 20) });
  }
  return out;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoPercentOff, setPromoPercentOff] = useState(0);
  const [promoChecking, setPromoChecking] = useState(false);

  // One-time hydration from localStorage after mount. We deliberately render an
  // empty cart on the server (and on the first client render) to avoid a
  // hydration mismatch, then sync from storage here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setLines(sanitize(JSON.parse(stored)));
    } catch {
      /* ignore */
    }
    try {
      const storedPromo = window.localStorage.getItem(PROMO_KEY);
      if (storedPromo) setPromoCode(storedPromo);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* ignore */
    }
  }, [lines, ready]);

  useEffect(() => {
    if (!ready) return;
    try {
      if (promoCode.trim()) window.localStorage.setItem(PROMO_KEY, promoCode);
      else window.localStorage.removeItem(PROMO_KEY);
    } catch {
      /* ignore */
    }
  }, [promoCode, ready]);

  // Validate the promo code (debounced) so /cart and /reserve can show a live
  // discounted total. The server routes still re-validate authoritatively.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const code = promoCode.trim();
    if (!code) {
      setPromoPercentOff(0);
      setPromoChecking(false);
      return;
    }
    setPromoChecking(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/promo?code=${encodeURIComponent(code)}`)
        .then((r) => r.json())
        .then((d: { valid?: boolean; percentOff?: number }) => {
          if (!cancelled) {
            setPromoPercentOff(d?.valid ? Number(d.percentOff) || 0 : 0);
          }
        })
        .catch(() => {
          if (!cancelled) setPromoPercentOff(0);
        })
        .finally(() => {
          if (!cancelled) setPromoChecking(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [promoCode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const add = useCallback((slug: string, quantity = 1, max?: number) => {
    setLines((prev) => {
      const cap = Math.min(20, max ?? 20);
      const existing = prev.find((l) => l.slug === slug);
      if (existing) {
        return prev.map((l) =>
          l.slug === slug
            ? { ...l, quantity: Math.min(cap, l.quantity + quantity) }
            : l,
        );
      }
      return [...prev, { slug, quantity: Math.min(cap, Math.max(1, quantity)) }];
    });
  }, []);

  const setQuantity = useCallback((slug: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.slug !== slug)
        : prev.map((l) =>
            l.slug === slug ? { ...l, quantity: Math.min(20, quantity) } : l,
          ),
    );
  }, []);

  const remove = useCallback((slug: string) => {
    setLines((prev) => prev.filter((l) => l.slug !== slug));
  }, []);

  // Clearing the cart after a completed order also drops the promo code — the
  // code was tied to that order, the next one starts fresh.
  //
  // Synchronously wipe localStorage too, not just state. The state→useEffect→
  // localStorage path is async (one render later), and if the user navigates
  // away before that effect commits, the next page's hydration reads the stale
  // cart/promo back in. Removing both keys here is belt-and-suspenders that
  // makes clearing the cart bulletproof across navigation timing.
  const clear = useCallback(() => {
    setLines([]);
    setPromoCode("");
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(PROMO_KEY);
    } catch {
      /* SSR / privacy-mode — state reset alone will handle it */
    }
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      count: lines.reduce((sum, l) => sum + l.quantity, 0),
      add,
      setQuantity,
      remove,
      clear,
      ready,
      promoCode,
      promoPercentOff,
      promoChecking,
      setPromoCode,
    }),
    [
      lines,
      add,
      setQuantity,
      remove,
      clear,
      ready,
      promoCode,
      promoPercentOff,
      promoChecking,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
