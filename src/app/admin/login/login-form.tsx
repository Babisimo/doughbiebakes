"use client";

import { useEffect, useState } from "react";

type Props = {
  /** Same-origin /admin path to forward to on success, or null for default. */
  next: string | null;
  /** Error code from the URL; "1" = wrong password, "ratelimited" = lockout. */
  initialError: string | undefined;
  /** Unix-ms timestamp when the lockout lifts, or null when not locked. */
  lockedUntil: number | null;
};

/**
 * Login form with a self-resetting lockout countdown. While `lockedUntil` is
 * in the future, the input and button are disabled and a live counter ticks
 * down each second. The moment it hits zero the controls re-enable — no
 * refresh needed. The server route is still authoritative (a manual POST
 * during lockout would just bounce back here), this just makes the UI honest.
 */
export function LoginForm({ next, initialError, lockedUntil }: Props) {
  const [locked, setLocked] = useState<boolean>(
    () => lockedUntil != null && lockedUntil > Date.now(),
  );

  useEffect(() => {
    if (!lockedUntil) return;
    const delay = Math.max(0, lockedUntil - Date.now());
    if (delay === 0) {
      setLocked(false);
      return;
    }
    // Single timeout — flip the form back open the moment the lockout lifts.
    // No ticking interval (the user just sees "try again in a couple minutes",
    // not a visible counter).
    const id = setTimeout(() => setLocked(false), delay);
    return () => clearTimeout(id);
  }, [lockedUntil]);

  return (
    <>
      {locked ? (
        <p className="nb-card-sm mt-4 bg-flame/15 p-3 text-sm text-ink">
          Too many attempts — please try again in a couple minutes.
        </p>
      ) : initialError === "1" ? (
        <p className="nb-card-sm mt-4 bg-flame/15 p-3 text-sm text-ink">
          Wrong password — try again.
        </p>
      ) : null}

      <form
        method="POST"
        action="/api/admin/login"
        className="mt-6 space-y-3"
        autoComplete="off"
      >
        <label className="block text-sm font-semibold" htmlFor="token">
          Password
        </label>
        <input
          id="token"
          name="token"
          type="password"
          required
          autoFocus={!locked}
          disabled={locked}
          aria-disabled={locked}
          className="w-full rounded-md border border-ink/20 bg-white px-3 py-2 text-sm shadow-sm focus:border-acid focus:outline-none disabled:cursor-not-allowed disabled:bg-ink/5 disabled:text-ink-500"
        />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <button
          type="submit"
          disabled={locked}
          aria-disabled={locked}
          className="btn-acid w-full text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {locked ? "Locked" : "Log in"}
        </button>
      </form>
    </>
  );
}
