"use client";

import { useState } from "react";

type ChargeResult = {
  ok?: boolean;
  paid?: number;
  failed?: number;
  skipped?: number;
  failures?: { email: string; reason: string }[];
  error?: string;
};

export function ClubChargeButton({ dropId }: { dropId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChargeResult | null>(null);

  async function charge() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/club/charge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dropId }),
      });
      const data = (await res.json()) as ChargeResult;
      if (!res.ok && !data.error) {
        setResult({ error: `Server error (${res.status}) — please try again.` });
      } else {
        setResult(data);
      }
    } catch {
      setResult({ error: "Network error — please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={charge}
        disabled={busy}
        className="btn-acid text-sm"
      >
        {busy ? (
          "Charging…"
        ) : (
          <>
            Charge members for this drop <span aria-hidden>＋</span>
          </>
        )}
      </button>
      {result?.error ? (
        <p className="rounded-2xl panel-mono px-3 py-2 text-sm">{result.error}</p>
      ) : null}
      {result?.ok ? (
        <div className="rounded-2xl nb-card-sm p-3 text-sm">
          <p className="font-bold">
            {result.paid} charged · {result.failed} failed · {result.skipped} skipped
          </p>
          {result.failures && result.failures.length > 0 ? (
            <ul className="mt-1 text-ink-700">
              {result.failures.map((f) => (
                <li key={f.email}>
                  {f.email} — {f.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1 text-xs text-ink-500">
            Safe to click again — paid members are skipped; failures retried.
          </p>
        </div>
      ) : null}
    </div>
  );
}
