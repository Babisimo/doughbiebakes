import "server-only";

import { cookies } from "next/headers";

import { ADMIN_COOKIE, verifyBakerToken } from "@/lib/admin-auth";
import { rateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

const THIRTY_DAYS = 60 * 60 * 24 * 30;
// Per-IP rate limit. The token is high-entropy (48 hex chars = 192 bits) so
// brute force is infeasible anyway; this is primarily defense-in-depth against
// credential-stuffing and a UX guard against runaway scripts hammering /admin.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60_000;

function safeNext(raw: string | null): string {
  // Only allow same-origin paths under /admin to avoid open-redirect abuse.
  if (!raw) return "/admin";
  return raw.startsWith("/admin") ? raw : "/admin";
}

function clientKey(req: Request): string {
  // Cloudflare sets `cf-connecting-ip`; most other proxies set
  // `x-forwarded-for` (left-most entry is the original client).
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return "unknown";
}

export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));

  // Rate-limit BEFORE the token compare — otherwise an attacker can probe at
  // wire speed and we'd only be slowing them down by the compare itself.
  if (rateLimited(`admin-login:${clientKey(req)}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS)) {
    const errUrl = new URL("/admin/login", req.url);
    errUrl.searchParams.set("error", "ratelimited");
    // Tell the client when it can try again so the form re-enables itself
    // without a refresh. Conservative upper bound — actual rate-limit window
    // can end sooner if older attempts age out.
    errUrl.searchParams.set("until", String(Date.now() + LOGIN_WINDOW_MS));
    if (next) errUrl.searchParams.set("next", next);
    return Response.redirect(errUrl.toString(), 303);
  }

  if (!verifyBakerToken(token)) {
    const errUrl = new URL("/admin/login", req.url);
    errUrl.searchParams.set("error", "1");
    if (next) errUrl.searchParams.set("next", next);
    return Response.redirect(errUrl.toString(), 303);
  }

  const store = await cookies();
  store.set({
    name: ADMIN_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: THIRTY_DAYS,
  });

  return Response.redirect(new URL(next, req.url).toString(), 303);
}
