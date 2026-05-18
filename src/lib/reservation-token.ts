import { createHmac, timingSafeEqual } from "node:crypto";

export type ReservationAction = "approve" | "decline" | "verify";

function getSecret(): string {
  const secret = process.env.CLUB_LINK_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CLUB_LINK_SECRET is not set (or too short) — reservation links cannot be signed.",
    );
  }
  return secret;
}

export function signReservationToken(id: string, action: ReservationAction): string {
  return createHmac("sha256", getSecret()).update(`${id}|${action}`).digest("hex");
}

export function verifyReservationToken(
  id: string,
  action: ReservationAction,
  token: string,
): boolean {
  if (!id || !action || !token) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(signReservationToken(id, action), "hex");
  } catch {
    return false;
  }
  let actual: Buffer;
  try {
    actual = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
