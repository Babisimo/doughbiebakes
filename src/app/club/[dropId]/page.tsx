import { notFound } from "next/navigation";

import { CottageFoodNotice } from "@/components/cottage-food-notice";
import {
  getActiveDrop,
  getMemberByEmail,
  getMemberSelectionsForDrop,
  getMemberSkippedForDrop,
} from "@/lib/catalog";
import { verifyClubToken } from "@/lib/club-token";
import { effectiveDropStatus } from "@/lib/drop-status";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";
import { getStripe } from "@/lib/stripe";

export type SavedShipping = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
};

import { SelectionForm } from "./selection-form";

export const dynamic = "force-dynamic";

// Bakery local time — members see picks-lock-at in the same TZ the bakery
// thinks in, regardless of where they're reading from or what the host's
// system TZ is (Cloudflare Workers run UTC).
function formatLockDate(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  });
}

type Search = { email?: string; token?: string };

export default async function ClubDropPage({
  params,
  searchParams,
}: {
  params: Promise<{ dropId: string }>;
  searchParams: Promise<Search>;
}) {
  const { dropId } = await params;
  const { email, token } = await searchParams;

  if (!email || !token || !verifyClubToken(email, dropId, token)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <h1 className="display text-5xl">Hmm — that link didn&apos;t check out.</h1>
        <p className="mt-4 text-ink-700">
          Try the most recent email from {site.name}. If you think your
          membership should be active, reply to that email and we&apos;ll send a
          fresh link.
        </p>
      </div>
    );
  }

  // The selection window is short (~24h) and members react to a status change
  // immediately — bypass the 60-second fetch cache so the page reflects Sanity
  // the moment the baker flips the drop to `announced` or back to `open`.
  const drop = await getActiveDrop({ fresh: true });
  if (!drop || drop.id !== dropId) notFound();

  const selections = await getMemberSelectionsForDrop(drop, { fresh: true });
  const normalizedEmail = email.toLowerCase();
  // Skipped members are filtered out of `selections`, so check skip status
  // directly — otherwise a returning skipper sees a blank "pick a loaf" form.
  const currentSkipped = await getMemberSkippedForDrop(drop.id, normalizedEmail, {
    fresh: true,
  });
  const myPick = selections.find((s) => s.customerEmail === normalizedEmail);
  const claimedBySlug = new Map<string, number>();
  for (const s of selections) {
    claimedBySlug.set(s.productSlug, (claimedBySlug.get(s.productSlug) ?? 0) + 1);
  }

  const options = drop.lineItems.map(({ product, quantity }) => {
    // True unclaimed count: total minus *every* member who's taken this
    // flavor, including the viewer themselves. Same number for everyone.
    const claimed = claimedBySlug.get(product.slug) ?? 0;
    const remaining = Math.max(0, Math.floor(quantity ?? 0) - claimed);
    return { product, remaining };
  });

  const windowOpen = effectiveDropStatus(drop, new Date()) === "announced";
  const hasExplicitPick = myPick != null && myPick.source !== "default";
  const defaultLoaf = drop.lineItems.find(
    (li) => li.product.slug === site.breadClub.defaultLoafSlug,
  )?.product;

  // Read the member's saved shipping name + address from Stripe (source of
  // truth — the admin bake list reads it directly too). If it's not there,
  // the SelectionForm will prompt for one inline when the member picks Ship.
  let savedShipping: SavedShipping | null = null;
  const member = await getMemberByEmail(normalizedEmail, { fresh: true });
  const stripe = getStripe();
  if (member?.stripeCustomerId && stripe) {
    try {
      const customer = await stripe.customers.retrieve(member.stripeCustomerId);
      if (customer && !("deleted" in customer) && customer.shipping?.address) {
        const a = customer.shipping.address;
        savedShipping = {
          name: customer.shipping.name ?? customer.name ?? "",
          line1: a.line1 ?? "",
          line2: a.line2 ?? "",
          city: a.city ?? "",
          state: a.state ?? "",
          postalCode: a.postal_code ?? "",
        };
      }
    } catch (err) {
      // Non-fatal — the form will just behave as if no address is on file.
      console.error("[club] Stripe customer lookup failed:", err);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <span className="badge badge-acid">Bread Club · members only</span>
      <h1 className="display mt-3 text-5xl sm:text-6xl">{drop.title}</h1>
      <p className="mt-3 text-ink-700">
        Hi {email} — pick your loaf for this drop.
      </p>

      {windowOpen ? (
        <>
          {drop.ordersOpenAt ? (
            <p className="nb-card-sm mt-4 bg-acid/10 p-3 text-sm text-ink">
              ⏰ <strong>Picks lock {formatLockDate(drop.ordersOpenAt)}</strong>{" "}
              — that&apos;s when this drop opens to the public. Change your mind
              any time before then.
            </p>
          ) : null}
          {!hasExplicitPick && defaultLoaf ? (
            <p className="nb-card-sm mt-4 bg-ochre/15 p-3 text-sm text-ink-700">
              Heads up: if you don&apos;t pick in time, we&apos;ll set you up
              with our <strong>{defaultLoaf.name}</strong> loaf so you never
              miss a drop.
            </p>
          ) : null}
        </>
      ) : (
        <p className="nb-card-sm mt-4 bg-flame/15 p-3 text-sm text-ink">
          🔒 <strong>Selection window closed.</strong>{" "}
          {currentSkipped ? (
            <>You skipped this drop — you won&apos;t be charged. See you next time!</>
          ) : myPick ? (
            <>Your pick is locked in for the bake — see below.</>
          ) : defaultLoaf ? (
            <>
              You didn&apos;t pick before the window closed, so we&apos;re
              baking you our <strong>{defaultLoaf.name}</strong> default loaf.
              Reply to our last email if you need to change anything before
              bake day.
            </>
          ) : (
            <>
              You didn&apos;t pick before the window closed. Reply to our last
              email if you need to make changes.
            </>
          )}
        </p>
      )}

      <SelectionForm
        dropId={drop.id}
        dropTitle={drop.title}
        dropPickupOrShipDate={drop.pickupOrShipDate ?? null}
        shipSurchargeLabel={formatPrice(site.breadClub.shipSurchargeCents)}
        email={email}
        token={token}
        currentSlug={myPick?.productSlug ?? null}
        currentFulfillment={myPick?.fulfillment ?? "pickup"}
        currentSkipped={currentSkipped}
        savedShipping={savedShipping}
        options={options.map(({ product, remaining }) => ({
          slug: product.slug,
          name: product.name,
          tagline: product.tagline ?? null,
          imageUrl: product.imageUrl ?? null,
          priceLabel: formatPrice(product.priceCents),
          remaining,
        }))}
        windowOpen={windowOpen}
      />

      <div className="mt-10 border-t border-ink/15 pt-4">
        <form
          method="POST"
          action="/api/club/portal"
          className="text-sm text-ink-700"
        >
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="dropId" value={drop.id} />
          Need to update your card?{" "}
          <button
            type="submit"
            className="font-semibold text-acid-600 underline decoration-2 hover:no-underline"
          >
            Manage your card →
          </button>
        </form>

        <details className="mt-4 text-sm text-ink-500">
          <summary className="cursor-pointer select-none">
            Leave the Bread Club
          </summary>
          <form
            method="POST"
            action="/api/club/cancel"
            className="mt-3 nb-card-sm bg-flame/5 p-4"
          >
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="dropId" value={drop.id} />
            <p className="text-ink">
              You&apos;ll be removed from the {site.name} Bread Club and your
              card won&apos;t be charged again. You can rejoin any time.
            </p>
            <button
              type="submit"
              className="btn-outline mt-3 border-flame text-flame text-xs"
            >
              Yes, cancel my membership
            </button>
          </form>
        </details>
      </div>

      {!site.cottageFood.muted && (
        <div className="mt-6 border-t border-ink/15 pt-4">
          <CottageFoodNotice />
        </div>
      )}

      <noscript>
        <p className="mt-4 text-sm text-ink-500">
          JavaScript is required to confirm a selection. Reply to the email and
          we&apos;ll set it for you.
        </p>
      </noscript>
    </div>
  );
}
