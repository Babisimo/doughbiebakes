import type { Metadata } from "next";
import Link from "next/link";

import { ClearCartOnMount } from "@/components/clear-cart-on-mount";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";
import { getStripe } from "@/lib/stripe";

export const metadata: Metadata = {
  title: "Order received",
  robots: { index: false },
};

type Props = {
  searchParams: Promise<{ session_id?: string; club?: string }>;
};

export default async function OrderSuccessPage({ searchParams }: Props) {
  const { session_id: sessionId, club } = await searchParams;
  const isClub = club === "1";

  let email: string | null = null;
  let amount: number | null = null;
  let discount: number | null = null;
  let ok = false;
  let kind: string | undefined;

  const stripe = getStripe();
  if (stripe && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      ok =
        session.payment_status === "paid" ||
        session.status === "complete";
      kind = session.metadata?.kind;
      email = session.customer_details?.email ?? null;
      amount = session.amount_total ?? null;
      discount = session.total_details?.amount_discount ?? null;
    } catch {
      /* fall through to a generic message */
    }
  }

  const isCardUpdate = kind === "club-card-update";

  return (
    <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
      <ClearCartOnMount />
      <div className="nb-card p-8 text-center sm:p-12">
        <div className="text-6xl" aria-hidden>
          {ok ? "🍞" : "✅"}
        </div>
        <h1 className="display mt-4 text-5xl sm:text-6xl">
          {isCardUpdate
            ? "Your card is updated"
            : isClub
              ? "Welcome to the Bread Club!"
              : "Order received!"}
        </h1>
        <p className="mt-3 text-ink-700">
          {isCardUpdate
            ? "Your new card is saved. We'll use it the next time a Bread Club drop runs — nothing is charged until then."
            : isClub
              ? `You're in. We'll email you before each drop so you can pick your loaf — and you're only charged $10 on the weeks we bake.${email ? ` Receipt is on its way to ${email}.` : ""}`
              : email
                ? `Receipt is on its way to ${email}.`
                : "Receipt is on its way to your email."}
          {amount != null ? (
            <>
              {" "}
              <span className="rounded-full bg-ochre px-2.5 py-0.5 font-bold text-ink">
                Total: {formatPrice(amount)}
              </span>
            </>
          ) : null}
        </p>
        {discount != null && discount > 0 ? (
          <p className="mt-2 text-sm font-semibold text-acid-600">
            🎉 Founding discount applied — you saved {formatPrice(discount)}.
          </p>
        ) : null}
        {!isClub ? (
          <p className="mt-3 text-ink-700">
            We bake to order, so you&apos;ll get a follow-up from {site.name} to
            confirm your pickup time in {site.city} (or shipping details if you
            chose California delivery).
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/menu" className="btn-acid text-sm">
            Back to the menu ＋
          </Link>
          <Link href="/" className="btn-outline text-sm">
            Home
          </Link>
        </div>
        <p className="mt-6 text-xs text-ink-500">
          Questions? Email{" "}
          <a className="underline" href={`mailto:${site.email}`}>
            {site.email}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
