import { getAdminSession } from "@/lib/admin-auth";
import { isAdjacentTransition, isStage } from "@/lib/fulfillment";
import { setFulfillmentStatus } from "@/sanity/lib/mutations";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: { type?: unknown; id?: unknown; from?: unknown; to?: unknown };
  try {
    body = (await req.json()) as {
      type?: unknown;
      id?: unknown;
      from?: unknown;
      to?: unknown;
    };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const type =
    body.type === "order" || body.type === "reservation" ? body.type : null;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const { from, to } = body;
  if (!type || !id || !isStage(from) || !isStage(to)) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  if (!isAdjacentTransition(from, to)) {
    return Response.json(
      { error: "Non-adjacent transition." },
      { status: 409 },
    );
  }
  const r = await setFulfillmentStatus(type, id, from, to);
  if (!r.ok) {
    return Response.json(
      { ok: false, conflict: r.conflict ?? false },
      { status: r.conflict ? 409 : 400 },
    );
  }
  return Response.json({ ok: true });
}
