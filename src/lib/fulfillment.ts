export type FulfillmentStage = "new" | "baking" | "ready" | "sent";

export const STAGES: readonly FulfillmentStage[] = ["new", "baking", "ready", "sent"];

export const STAGE_LABELS: Record<FulfillmentStage, string> = {
  new: "New",
  baking: "Baking",
  ready: "Ready",
  sent: "Sent",
};

/** Label for the button that advances FROM this stage. `null` at the end. */
export const ADVANCE_LABELS: Record<FulfillmentStage, string | null> = {
  new: "Start baking",
  baking: "Mark ready",
  ready: "Mark sent",
  sent: null,
};

export function isStage(v: unknown): v is FulfillmentStage {
  return v === "new" || v === "baking" || v === "ready" || v === "sent";
}

export function coerceStage(v: unknown): FulfillmentStage {
  return isStage(v) ? v : "new";
}

export function next(stage: FulfillmentStage): FulfillmentStage | null {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export function prev(stage: FulfillmentStage): FulfillmentStage | null {
  const i = STAGES.indexOf(stage);
  return i > 0 ? STAGES[i - 1] : null;
}

export function isAdjacentTransition(from: unknown, to: unknown): boolean {
  if (!isStage(from) || !isStage(to)) return false;
  return next(from) === to || prev(from) === to;
}

export type DelayState = "on-track" | "due-soon" | "behind" | "done";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derived (never stored) lateness. `sent` is always `done`; `ready` is safe
 * even past the date (baked & waiting). Otherwise compare now to the drop's
 * pickup/ship date.
 */
export function deriveDelay(
  stage: FulfillmentStage,
  pickupOrShipDate: string | null | undefined,
  now: Date,
): DelayState {
  if (stage === "sent") return "done";
  if (!pickupOrShipDate) return "on-track";
  const due = new Date(pickupOrShipDate).getTime();
  if (!Number.isFinite(due)) return "on-track";
  if (stage === "ready") return "on-track";
  const t = now.getTime();
  if (t >= due) return "behind";
  if (due - t <= DAY_MS) return "due-soon";
  return "on-track";
}

export type DelayCountable = { fulfillmentStatus: FulfillmentStage };

export function summarize(
  rows: DelayCountable[],
  pickupOrShipDate: string | null | undefined,
  now: Date,
): { byStage: Record<FulfillmentStage, number>; behind: number; dueSoon: number } {
  const byStage: Record<FulfillmentStage, number> = {
    new: 0,
    baking: 0,
    ready: 0,
    sent: 0,
  };
  let behind = 0;
  let dueSoon = 0;
  for (const r of rows) {
    byStage[r.fulfillmentStatus] += 1;
    const d = deriveDelay(r.fulfillmentStatus, pickupOrShipDate, now);
    if (d === "behind") behind += 1;
    else if (d === "due-soon") dueSoon += 1;
  }
  return { byStage, behind, dueSoon };
}
