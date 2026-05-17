import { notFound } from "next/navigation";

import { CottageFoodNotice } from "@/components/cottage-food-notice";
import { getActiveDrop, getMemberSelectionsForDrop } from "@/lib/catalog";
import { verifyClubToken } from "@/lib/club-token";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";

import { SelectionForm } from "./selection-form";

export const dynamic = "force-dynamic";

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

  const windowOpen = drop.status === "announced";
  const hasExplicitPick = myPick != null && myPick.source !== "default";
  const defaultLoaf = drop.lineItems.find(
    (li) => li.product.slug === site.breadClub.defaultLoafSlug,
  )?.product;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <span className="badge badge-acid">Bread Club · members only</span>
      <h1 className="display mt-3 text-5xl sm:text-6xl">{drop.title}</h1>
      <p className="mt-3 text-ink-700">
        Hi {email} — pick your loaf for this drop. You can change your mind any
        time while the selection window is open.
        {windowOpen
          ? null
          : " (The window has closed for this drop — your pick is locked in.)"}
      </p>
      {windowOpen && !hasExplicitPick && defaultLoaf ? (
        <p className="nb-card-sm mt-4 bg-ochre/15 p-3 text-sm text-ink-700">
          Heads up: if you don&apos;t pick before the window closes, we&apos;ll
          set you up with our <strong>{defaultLoaf.name}</strong> loaf so you
          never miss a drop.
        </p>
      ) : null}

      <SelectionForm
        dropId={drop.id}
        dropTitle={drop.title}
        dropPickupOrShipDate={drop.pickupOrShipDate ?? null}
        shipSurchargeLabel={formatPrice(site.breadClub.shipSurchargeCents)}
        email={email}
        token={token}
        currentSlug={myPick?.productSlug ?? null}
        currentFulfillment={myPick?.fulfillment ?? "pickup"}
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
          Need to update your card, pause, or cancel?{" "}
          <button
            type="submit"
            className="font-semibold text-acid-600 underline decoration-2 hover:no-underline"
          >
            Manage subscription →
          </button>
        </form>
      </div>

      <div className="mt-6 border-t border-ink/15 pt-4">
        <CottageFoodNotice />
      </div>

      <noscript>
        <p className="mt-4 text-sm text-ink-500">
          JavaScript is required to confirm a selection. Reply to the email and
          we&apos;ll set it for you.
        </p>
      </noscript>
    </div>
  );
}
