import { RESERVATION_MAX_LOAVES } from "./site.ts";

export type GuardItem = { quantity: number };

/** Human-facing message if a length/quantity cap is exceeded, else null. */
export function reservationCapError(
  name: string,
  email: string,
  phone: string,
  items: GuardItem[],
): string | null {
  if (name.length > 80) return "That name is too long.";
  if (email.length > 120) return "That email address is too long.";
  if (phone.length > 32) return "That phone number is too long.";
  if (items.length > 6) return "Too many different loaves in one reservation.";
  const total = items.reduce(
    (s, i) => s + (Number.isFinite(i.quantity) ? i.quantity : 0),
    0,
  );
  if (total > RESERVATION_MAX_LOAVES) {
    return `Reservations are limited to ${RESERVATION_MAX_LOAVES} loaves — please lower the quantity.`;
  }
  return null;
}

/** True when a submission looks automated: honeypot filled, or submitted
 * implausibly fast. Timing fails OPEN (missing/NaN -> not a bot) so a stale
 * cached client never blocks a real neighbor. */
export function looksLikeBot(honeypot: string, elapsedMs: number): boolean {
  if (honeypot.trim() !== "") return true;
  if (Number.isFinite(elapsedMs) && elapsedMs < 2500) return true;
  return false;
}
