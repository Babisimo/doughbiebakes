import "server-only";

import {
  getActiveDrop,
  getMemberSelectionsForDrop,
  getReservationHoldsForDrop,
} from "./catalog";
import { evaluateReservation, type EvalResult, type ReqItem } from "./reservation-eval";
import {
  sendReservationConfirmed,
  sendReservationDeclined,
} from "./reservation-email";
import { sanityClient } from "@/sanity/client";
import { DROP_BY_ID_QUERY, RESERVATION_BY_ID_QUERY } from "@/sanity/lib/queries";
import {
  decrementDropQuantities,
  redeemPromo,
  setReservationStatus,
} from "@/sanity/lib/mutations";
import type { Drop } from "./types";

const freshClient = sanityClient?.withConfig({ useCdn: false }) ?? null;

/** Validate a requested cart against the live open drop (same rules as checkout). */
export async function validateReservationCart(items: ReqItem[]): Promise<EvalResult> {
  const drop = await getActiveDrop({ fresh: true });
  const selections = await getMemberSelectionsForDrop(drop, { fresh: true });
  const holds = await getReservationHoldsForDrop(drop?.id, { fresh: true });
  return evaluateReservation(drop, selections, items, new Date(), holds);
}

type Reservation = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  dropId: string;
  status: string;
  totalCents: number;
  promoCode?: string;
  promoPercentOff?: number;
  discountedTotalCents?: number;
  items: { productSlug: string; productName: string; quantity: number; priceCents: number }[];
};

export type DecideResult =
  | { ok: true; status: "confirmed" | "declined"; idempotent?: boolean; warning?: string }
  | { ok: false; error: string };

function emailInputFor(r: Reservation, pickupDate?: string) {
  const total =
    typeof r.discountedTotalCents === "number" && r.promoCode
      ? r.discountedTotalCents
      : r.totalCents;
  const promoApplies =
    typeof r.discountedTotalCents === "number" && !!r.promoCode;
  return {
    id: r.id,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    customerPhone: r.customerPhone,
    lines: r.items.map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      priceCents: i.priceCents,
    })),
    totalCents: total,
    originalTotalCents: promoApplies ? r.totalCents : undefined,
    promoPercentOff: r.promoCode ? r.promoPercentOff : undefined,
    pickupDate,
  };
}

export async function decideReservation(
  id: string,
  action: "approve" | "decline",
): Promise<DecideResult> {
  if (!freshClient) return { ok: false, error: "Reservations are not configured." };
  try {
    const r = await freshClient.fetch<Reservation | null>(RESERVATION_BY_ID_QUERY, { id });
    if (!r) return { ok: false, error: "Reservation not found." };
    if (r.status !== "pending") {
      return { ok: true, status: r.status as "confirmed" | "declined", idempotent: true };
    }

    if (action === "decline") {
      const moved = await setReservationStatus(id, "pending", "declined");
      if (moved) await sendReservationDeclined(emailInputFor(r), "declined");
      return { ok: true, status: "declined", idempotent: !moved };
    }

    // approve — re-validate live against the reservation's own drop, reusing
    // the same (tested) evaluator the request used.
    const now = new Date();
    const drop = await freshClient.fetch<Drop | null>(DROP_BY_ID_QUERY, { id: r.dropId });
    if (!drop) {
      console.error("[reservations] drop not found for reservation", r.id, r.dropId);
    }
    const selections = drop ? await getMemberSelectionsForDrop(drop, { fresh: true }) : [];
    const recheck = evaluateReservation(
      drop,
      selections,
      r.items.map((i) => ({ slug: i.productSlug, quantity: i.quantity })),
      now,
    );
    if (!recheck.ok) {
      const declineReason = recheck.reason === "not-open" ? "unavailable" : "soldout";
      const moved = await setReservationStatus(id, "pending", "declined");
      if (moved) await sendReservationDeclined(emailInputFor(r), declineReason);
      return { ok: true, status: "declined", idempotent: !moved };
    }
    // Status is claimed `confirmed` BEFORE the decrement so two actors can't
    // both decrement. Accepted tradeoff: if the decrement throws, the doc
    // stays `confirmed` with stock not reduced — baker-visible; a retry is an
    // idempotent no-op (no double-decrement) but won't re-send the confirm
    // email. Rare at Cottage-Food scale.
    const claimed = await setReservationStatus(id, "pending", "confirmed");
    if (!claimed) {
      const fresh = await freshClient.fetch<Reservation | null>(RESERVATION_BY_ID_QUERY, { id });
      return {
        ok: true,
        status:
          fresh?.status === "confirmed" || fresh?.status === "declined"
            ? fresh.status
            : "confirmed",
        idempotent: true,
      };
    }
    let warning: string | undefined;
    if (r.promoCode) {
      const code = r.promoCode;
      // redeemPromo never throws: false = cap hit or any error (safe degrade).
      const redeemed = await redeemPromo(code);
      if (!redeemed) {
        // Cap exhausted between submit and confirm: confirm at FULL price.
        warning =
          `Founding code "${code}" is already fully redeemed — ` +
          `confirmed at full price. Honor the discount manually if you choose.`;
        // Strip the discount so the confirm email shows full price.
        r.promoCode = undefined;
        r.promoPercentOff = undefined;
        r.discountedTotalCents = undefined;
      }
    }
    try {
      await decrementDropQuantities(
        r.dropId,
        r.items.map((i) => ({ slug: i.productSlug, quantity: i.quantity })),
      );
      await sendReservationConfirmed(emailInputFor(r, drop?.pickupOrShipDate));
    } catch (err) {
      // The reservation is already `confirmed` (claimed above). If the
      // decrement/email fails here, the doc state is still authoritative —
      // report it truthfully so the admin UI/link doesn't show a misleading
      // generic failure — but log a distinct, greppable signal so the rare
      // "confirmed but stock not reduced" inconsistency is diagnosable.
      console.error(
        "[reservations] CONFIRMED BUT STOCK NOT DECREMENTED",
        r.id,
        err,
      );
    }
    return { ok: true, status: "confirmed", warning };
  } catch (err) {
    console.error("[reservations] decide failed", err);
    return {
      ok: false,
      error: "Couldn't process the reservation — please try again.",
    };
  }
}
