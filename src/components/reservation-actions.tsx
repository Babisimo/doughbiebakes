"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReservationActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function decide(action: "approve" | "decline") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/reservations/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = (await res.json()) as { ok?: boolean; status?: string; error?: string };
      if (!res.ok || !data.ok) {
        setMsg(data.error ?? "Failed.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setMsg("Network error.");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={busy} onClick={() => decide("approve")} className="btn-acid text-xs">
        Approve
      </button>
      <button type="button" disabled={busy} onClick={() => decide("decline")} className="btn-outline text-xs">
        Decline
      </button>
      {msg ? <span className="text-xs text-acid-600">{msg}</span> : null}
    </div>
  );
}
