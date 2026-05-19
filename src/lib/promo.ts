import "server-only";

import { sanityClient } from "@/sanity/client";
import { groq } from "next-sanity";

export type Promo = {
  id: string;
  code: string;
  percentOff: number;
  maxRedemptions: number;
  redeemedCount: number;
  active: boolean;
};

const fresh = sanityClient?.withConfig({ useCdn: false }) ?? null;

const ALL_PROMOS_QUERY = groq`*[_type == "promoCode"]{
  "id": _id, code, percentOff, maxRedemptions,
  "redeemedCount": coalesce(redeemedCount, 0),
  "active": coalesce(active, true)
}`;

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Live lookup by normalized code. `null` when Sanity/code absent (zero-config
 * parity: codes simply don't apply, never crash). */
export async function getPromoByCode(code: string): Promise<Promo | null> {
  const norm = normalizeCode(code);
  if (!norm || !sanityClient) return null;
  const client = fresh ?? sanityClient;
  const all = await client.fetch<Promo[]>(
    ALL_PROMOS_QUERY,
    {},
    { cache: "no-store" as const },
  );
  return all.find((p) => normalizeCode(p.code) === norm) ?? null;
}

export function isRedeemable(p: Promo | null): p is Promo {
  return !!p && p.active && p.redeemedCount < p.maxRedemptions;
}
