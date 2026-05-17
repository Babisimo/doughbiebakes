"use client";

import { useEffect, useState } from "react";

type Parts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
};

function diffParts(targetMs: number, nowMs: number): Parts {
  let ms = targetMs - nowMs;
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  const days = Math.floor(ms / 86_400_000);
  ms -= days * 86_400_000;
  const hours = Math.floor(ms / 3_600_000);
  ms -= hours * 3_600_000;
  const minutes = Math.floor(ms / 60_000);
  ms -= minutes * 60_000;
  const seconds = Math.floor(ms / 1_000);
  return { days, hours, minutes, seconds, done: false };
}

const pad = (n: number) => String(n).padStart(2, "0");

type Tone = "acid" | "sage" | "ink";

const TONE_CLASS: Record<Tone, string> = {
  acid: "bg-ochre text-ink",
  sage: "bg-sage text-ink",
  ink: "panel-mono",
};

function Tile({
  value,
  unit,
  tone,
  prominent,
}: {
  value: string;
  unit: string;
  tone: Tone;
  prominent: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center rounded-2xl border border-ink/15 ${TONE_CLASS[tone]} ${
        prominent
          ? "min-w-[4.75rem] px-3 py-2.5 shadow-[var(--shadow-hard-sm)] sm:min-w-[5.5rem]"
          : "min-w-[3.4rem] px-2 py-1.5"
      }`}
    >
      <span
        className={`display leading-none tabular-nums ${
          prominent ? "text-4xl sm:text-5xl" : "text-2xl"
        }`}
      >
        {value}
      </span>
      <span
        className={`mt-1 font-semibold uppercase tracking-wider opacity-70 ${
          prominent ? "text-[0.65rem]" : "text-[0.6rem]"
        }`}
      >
        {unit}
      </span>
    </div>
  );
}

/**
 * Live countdown to an ISO datetime, rendered as DD / HH / MM / SS tiles.
 *
 * Renders a stable "··" skeleton on the server and the first client paint, then
 * starts ticking after mount — so there's never a hydration mismatch (the diff
 * depends on "now", which differs between server and client).
 */
export function Countdown({
  to,
  label,
  doneLabel = "Time's up!",
  tone = "acid",
  prominent = false,
}: {
  /** Target ISO datetime, e.g. drop.ordersCloseAt. */
  to: string | undefined;
  label: string;
  doneLabel?: string;
  tone?: Tone;
  /** Big, centered, urgent treatment for the headline order-window timer. */
  prominent?: boolean;
}) {
  const targetMs = to ? new Date(to).getTime() : NaN;
  const valid = Number.isFinite(targetMs);
  const [parts, setParts] = useState<Parts | null>(null);

  useEffect(() => {
    if (!valid) return;
    const tick = () => setParts(diffParts(targetMs, Date.now()));
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [targetMs, valid]);

  if (!valid) return null;

  return (
    <div
      className={
        prominent
          ? "flex flex-col items-center gap-2.5"
          : "space-y-1.5"
      }
    >
      <p
        className={
          prominent
            ? "display text-base uppercase tracking-[0.22em] text-acid-600 sm:text-lg"
            : "text-xs font-semibold uppercase tracking-[0.18em] text-ink-500"
        }
      >
        {label}
      </p>
      {parts?.done ? (
        <p className={`display ${prominent ? "text-3xl" : "text-xl"}`}>
          {doneLabel}
        </p>
      ) : (
        <div
          className={`flex ${prominent ? "justify-center gap-2 sm:gap-2.5" : "gap-1.5"}`}
          aria-hidden
        >
          <Tile
            value={parts ? pad(parts.days) : "··"}
            unit={parts && parts.days === 1 ? "day" : "days"}
            tone={tone}
            prominent={prominent}
          />
          <Tile value={parts ? pad(parts.hours) : "··"} unit="hrs" tone={tone} prominent={prominent} />
          <Tile value={parts ? pad(parts.minutes) : "··"} unit="min" tone={tone} prominent={prominent} />
          <Tile value={parts ? pad(parts.seconds) : "··"} unit="sec" tone={tone} prominent={prominent} />
        </div>
      )}
    </div>
  );
}
