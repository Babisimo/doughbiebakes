import "server-only";

import { cookies } from "next/headers";

import { ADMIN_COOKIE } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  return Response.redirect(new URL("/admin/login", req.url).toString(), 303);
}
