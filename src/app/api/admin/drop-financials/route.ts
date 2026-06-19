import { getAdminSession } from "@/lib/admin-auth";
import {
  createManualDropFinancials,
  upsertDropFinancials,
} from "@/sanity/lib/mutations";

export const runtime = "nodejs";

/** Coerce an unknown to a finite integer (cents/counts), defaulting to 0. */
function int(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Manual / pre-website entry — no drop attached.
  if (body.manual === true) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return Response.json({ error: "A label is required." }, { status: 400 });
    }
    const ok = await createManualDropFinancials({
      title,
      periodDate: typeof body.periodDate === "string" ? body.periodDate : undefined,
      revenueCents: int(body.revenueCents),
      costCents: int(body.costCents),
      favorsCents: int(body.favorsCents),
      unitsTotal: int(body.unitsTotal),
    });
    if (!ok) {
      return Response.json(
        { error: "Saving isn't configured (no Sanity write token)." },
        { status: 503 },
      );
    }
    return Response.json({ ok: true });
  }

  const dropId = typeof body.dropId === "string" ? body.dropId.trim() : "";
  if (!dropId) {
    return Response.json({ error: "Missing dropId." }, { status: 400 });
  }

  const fixedCosts = Array.isArray(body.fixedCosts)
    ? body.fixedCosts
        .map((f) => {
          const o = (f ?? {}) as Record<string, unknown>;
          return {
            name: typeof o.name === "string" ? o.name : "",
            cents: int(o.cents),
          };
        })
        .filter((f) => f.name || f.cents)
    : [];

  const ok = await upsertDropFinancials({
    dropId,
    dropTitle: typeof body.dropTitle === "string" ? body.dropTitle : "",
    periodDate: typeof body.periodDate === "string" ? body.periodDate : undefined,
    revenueCents: int(body.revenueCents),
    listValueCents: int(body.listValueCents),
    favorsCents: int(body.favorsCents),
    variableCostCents: int(body.variableCostCents),
    fixedCostCents: int(body.fixedCostCents),
    netProfitCents: int(body.netProfitCents),
    unitsTotal: int(body.unitsTotal),
    actualCollectedCents: int(body.actualCollectedCents),
    fixedCosts,
  });

  if (!ok) {
    return Response.json(
      { error: "Saving isn't configured (no Sanity write token)." },
      { status: 503 },
    );
  }
  return Response.json({ ok: true });
}
