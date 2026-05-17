"use client";

import { useState } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "alreadyMember"; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function JoinBreadClub({
  enabled,
  waitlistHref,
}: {
  enabled: boolean;
  waitlistHref: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  if (!enabled) {
    return (
      <a href={waitlistHref} className="btn-ink text-sm">
        Email to join the waitlist ＋
      </a>
    );
  }

  async function join(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setStatus({ kind: "error", message: "Please enter a valid email address." });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      const res = await fetch("/api/bread-club", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json()) as {
        url?: string;
        alreadyMember?: boolean;
        message?: string;
        error?: string;
      };
      if (data.alreadyMember) {
        setStatus({
          kind: "alreadyMember",
          message:
            data.message ??
            "You're already a Bread Club member with this email. Check your Stripe payment receipts for the 'manage subscription' link.",
        });
        return;
      }
      if (!res.ok || !data.url) {
        setStatus({
          kind: "error",
          message: data.error ?? "Could not start sign-up.",
        });
        return;
      }
      window.location.assign(data.url);
    } catch {
      setStatus({ kind: "error", message: "Network error. Please try again." });
    }
  }

  if (status.kind === "alreadyMember") {
    return (
      <p className="nb-card-sm bg-sage/20 p-3 text-sm text-ink">
        ✓ {status.message}
      </p>
    );
  }

  return (
    <form onSubmit={join} className="space-y-2">
      <label htmlFor="bread-club-email" className="text-xs font-semibold uppercase tracking-wider text-ink-500">
        Your email
      </label>
      <input
        id="bread-club-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-md border border-ink/20 bg-white px-3 py-2 text-sm shadow-sm focus:border-acid focus:outline-none"
      />
      <button
        type="submit"
        disabled={status.kind === "submitting"}
        className="btn-acid text-sm"
      >
        {status.kind === "submitting" ? "Checking…" : "Join the Bread Club ＋"}
      </button>
      {status.kind === "error" ? (
        <p className="rounded-2xl panel-mono px-3 py-1.5 text-sm">
          {status.message}
        </p>
      ) : null}
      <p className="text-xs text-ink-500">
        We check this against existing members before charging your card — no
        duplicate subscriptions.
      </p>
    </form>
  );
}
