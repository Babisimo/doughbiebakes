"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ADVANCE_LABELS,
  next,
  prev,
  type FulfillmentStage,
} from "@/lib/fulfillment";

export function FulfillmentControl({
  type,
  id,
  from,
}: {
  type: "order" | "reservation";
  id: string;
  from: FulfillmentStage;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function move(to: FulfillmentStage | null) {
    if (!to || busy || !id) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/fulfillment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, id, from, to }),
      });
      const data = (await res.json()) as { ok?: boolean; conflict?: boolean };
      if (!res.ok || !data.ok) {
        // Conflict = the page was stale; just refresh to show truth.
        if (!data.conflict) setMsg("Failed.");
        router.refresh();
        setBusy(false);
        return;
      }
      router.refresh();
      setBusy(false);
    } catch {
      setMsg("Network error.");
      setBusy(false);
    }
  }

  const fwd = next(from);
  const back = prev(from);
  const advanceLabel = ADVANCE_LABELS[from];

  return (
    <div className="flex items-center gap-2">
      {back ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => move(back)}
          className="btn-outline text-xs"
          title={`Back to ${back}`}
        >
          ‹
        </button>
      ) : null}
      {fwd && advanceLabel ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => move(fwd)}
          className="btn-acid text-xs"
        >
          {advanceLabel}
        </button>
      ) : null}
      {msg ? <span className="text-xs text-flame-700">{msg}</span> : null}
    </div>
  );
}
