import type { Metadata } from "next";

import { ReserveForm } from "@/components/reserve-form";
import { buildAvailability } from "@/lib/availability";
import { getDropsView, getMemberSelectionsForDrop, getProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reserve & pay at pickup" };

export default async function ReservePage() {
  const [{ current: drop }, products] = await Promise.all([
    getDropsView(),
    getProducts(),
  ]);
  const selections = await getMemberSelectionsForDrop(drop);
  const map = buildAvailability(drop, selections, new Date());
  const availability = Object.fromEntries(map);

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="display text-5xl sm:text-6xl">Reserve &amp; pay at pickup</h1>
      <p className="mt-3 max-w-prose text-ink-700">
        Local pickup only. Reserve your loaves now and pay cash or card when you
        pick up — we&apos;ll email you once your reservation is confirmed.
      </p>
      <div className="mt-8">
        <ReserveForm products={products} availability={availability} />
      </div>
    </section>
  );
}
