import { getAdminSession } from "@/lib/admin-auth";
import { decideReservation } from "@/lib/reservations";
import { verifyReservationToken } from "@/lib/reservation-token";

export const runtime = "nodejs";

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#283618">` +
      `<h1 style="font-size:1.4rem">${title}</h1><p>${body}</p></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function isAction(v: string | null): v is "approve" | "decline" {
  return v === "approve" || v === "decline";
}

// Email magic links (signed).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const action = url.searchParams.get("action");
  const token = url.searchParams.get("token") ?? "";
  if (!id || !isAction(action) || !verifyReservationToken(id, action, token)) {
    return page("Invalid link", "This approve/decline link is invalid or has expired.");
  }
  const r = await decideReservation(id, action);
  if (!r.ok) return page("Couldn't process", r.error);
  if (r.idempotent) return page("Already decided", `This reservation was already <b>${r.status}</b>.`);
  const note =
    r.status === "confirmed"
      ? "Stock is held and the customer was emailed to pay at pickup."
      : "The customer was emailed.";
  return page(
    r.status === "confirmed" ? "Approved ✅" : "Declined",
    r.warning ? `${note}<br><br><strong>⚠️ ${r.warning}</strong>` : note,
  );
}

// Admin buttons (BAKER_TOKEN cookie). Body: { id, action }.
export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: { id?: unknown; action?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; action?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const action = typeof body.action === "string" ? body.action : null;
  if (!id || !isAction(action)) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const r = await decideReservation(id, action);
  if (!r.ok) return Response.json({ error: r.error }, { status: 409 });
  return Response.json({
    ok: true,
    status: r.status,
    idempotent: r.idempotent ?? false,
    ...(r.warning ? { warning: r.warning } : {}),
  });
}
