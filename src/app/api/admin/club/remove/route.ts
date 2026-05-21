import { getAdminSession } from "@/lib/admin-auth";
import { cancelMember } from "@/sanity/lib/mutations";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: { customerId?: unknown };
  try {
    body = (await req.json()) as { customerId?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
  if (!customerId) return Response.json({ error: "Missing customerId." }, { status: 400 });
  await cancelMember(customerId);
  return Response.json({ ok: true });
}
