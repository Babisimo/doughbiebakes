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
    <div className="flash-banner panel-mono mx-auto flex w-full max-w-3xl flex-col items-center gap-3 rounded-3xl border border-ochre/40 px-6 py-4 text-center sm:flex-row sm:justify-between sm:gap-5 sm:text-left">
      <p className="display flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 text-lg leading-tight text-bone sm:justify-start sm:text-xl">
        <span aria-hidden className="flash-spark text-2xl">
          ⚡
        </span>
        <span>{state.headline ?? "Flash Sale"}</span>
        <span className="inline-block rounded-full bg-ochre px-3 py-0.5 text-ink shadow-[var(--shadow-hard-sm)]">
          {state.percentOff}% OFF
        </span>
      </p>
      <Countdown
        to={state.endsAt}
        label="Ends in"
        tone="acid"
        labelClassName="text-ochre"
      />
    </div>
  );
}
