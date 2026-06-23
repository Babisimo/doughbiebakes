import { Countdown } from "@/components/countdown";
import type { FlashSaleState } from "@/lib/flash-sale";

/**
 * Urgency banner for a live flash sale. Server-rendered from a `FlashSaleState`
 * (computed via `flashSaleStatus`); only the embedded `Countdown` ticks on the
 * client. Renders nothing when no sale is active.
 */
export function FlashSaleBanner({ state }: { state: FlashSaleState }) {
  if (!state.active) return null;
  return (
    <div className="panel-acid mx-auto flex w-full max-w-3xl flex-col items-center gap-2 rounded-3xl border border-ink/15 px-5 py-4 text-center shadow-[var(--shadow-hard-sm)] sm:flex-row sm:justify-between sm:text-left">
      <p className="display text-lg leading-tight sm:text-xl">
        ⚡ {state.headline ?? "Flash Sale"} —{" "}
        <span className="text-grad-acid">{state.percentOff}% off</span>
      </p>
      <Countdown to={state.endsAt} label="Ends in" tone="acid" />
    </div>
  );
}
