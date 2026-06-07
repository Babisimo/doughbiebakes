import type { Metadata } from "next";

import { FermentationCalculator } from "@/components/fermentation-calculator";

export const metadata: Metadata = {
  title: "Fermentation calculator",
  description:
    "Estimate sourdough bulk fermentation time from dough temperature, target rise, and starter percentage.",
  // Standalone, unlinked tool — keep it out of search results and the sitemap.
  robots: { index: false, follow: false },
};

export default function FermentationCalculatorPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <header className="max-w-prose space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
          Baker&apos;s tools
        </p>
        <h1 className="display text-5xl sm:text-6xl">
          Fermentation <span className="text-grad-berry">calculator</span>
        </h1>
        <p className="text-ink-700">
          Warm dough ferments faster — and needs to be pulled at a{" "}
          <em>lower</em> rise, since it keeps going through shaping and proof.
          Set your dough temperature for a recommended pull point and an
          estimated bulk time, or dial in your own target rise to see where it
          lands.
        </p>
      </header>

      <div className="mt-10">
        <FermentationCalculator />
      </div>
    </div>
  );
}
