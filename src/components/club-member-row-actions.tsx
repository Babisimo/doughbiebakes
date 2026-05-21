"use client";

import { useState } from "react";

export function ClubMemberRemove({
  customerId,
  email,
}: {
  customerId: string;
  email: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function remove() {
    if (!window.confirm(`Remove ${email} from the Bread Club? Their card won't be charged again.`)) {
      return;
    }
    setState("busy");
    try {
      const res = await fetch("/api/admin/club/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      if (res.ok) {
        setState("done");
      } else {
        console.error("[club-member-remove] remove failed", res.status);
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  if (state === "done") return <span className="text-xs text-ink-500">Removed</span>;
  return (
    <button
      type="button"
      onClick={remove}
      disabled={state === "busy"}
      className="text-xs font-semibold uppercase text-acid-600 underline decoration-2 hover:no-underline"
    >
      {state === "busy" ? "Removing…" : state === "error" ? "Retry remove" : "Remove from club"}
    </button>
  );
}
