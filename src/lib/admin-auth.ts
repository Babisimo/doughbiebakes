import "server-only";

import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "doughbie_admin";

/**
 * Constant-time compare of a submitted token against the env BAKER_TOKEN.
 * Returns false when the env var is missing — fail-closed so an unset token
 * cannot accidentally expose admin pages.
 */
export function verifyBakerToken(token: string): boolean {
  const expected = process.env.BAKER_TOKEN;
  if (!expected || expected.length < 8) return false;
  if (!token || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/**
 * True if the request carries a valid admin session cookie. Reads the cookie
 * from Next's request scope, so this only works inside server components,
 * route handlers, and other request-scoped code paths.
 */
export async function getAdminSession(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(ADMIN_COOKIE)?.value;
  if (!value) return false;
  return verifyBakerToken(value);
}
