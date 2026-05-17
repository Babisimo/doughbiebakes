import "server-only";

import { cookies } from "next/headers";

import { ADMIN_COOKIE, verifyBakerToken } from "@/lib/admin-auth";

export const runtime = "nodejs";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

function safeNext(raw: string | null): string {
  // Only allow same-origin paths under /admin to avoid open-redirect abuse.
  if (!raw) return "/admin/club";
  return raw.startsWith("/admin") ? raw : "/admin/club";
}

export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));

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
