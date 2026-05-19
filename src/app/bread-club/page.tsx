import type { Metadata } from "next";

import { CottageFoodNotice } from "@/components/cottage-food-notice";
import { JoinBreadClub } from "@/components/join-bread-club";
import { getActiveMemberCount } from "@/lib/catalog";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Bread Club",
  description: `A standing weekly sourdough loaf from ${site.name} — ${site.breadClub.priceLabel} ${site.breadClub.cadenceLabel}.`,
};

export default async function BreadClubPage() {
  const enabled = Boolean(process.env.STRIPE_BREAD_CLUB_PRICE_ID);
  const club = site.breadClub;
  const memberCount = await getActiveMemberCount({ fresh: true });
  // Demo mode (no Sanity / no cache) -> we can't enforce the cap. Treat the
  // club as open in that case rather than locking out new sign-ups.
  const spotsLeft = memberCount === null ? club.seats : Math.max(0, club.seats - memberCount);
  const isFull = enabled && spotsLeft <= 0;
  const waitlistHref = `mailto:${site.email}?subject=${encodeURIComponent(
    "Bread Club waitlist",
  )}&body=${encodeURIComponent(
    "Hi! I'd like to join the Bread Club for a standing weekly loaf. My name and neighborhood: ",
  )}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <span className="badge badge-flame">
        Neighbors only ✶ {memberCount === null
          ? `${club.seats} spots`
          : isFull
            ? "Full — waitlist open"
            : `${spotsLeft} of ${club.seats} spots left`}{" "}
        ✶ {site.city}
      </span>
      <h1 className="display mt-3 text-6xl sm:text-7xl">
        The <span className="text-grad-acid">Bread Club</span>
      </h1>
      <p className="mt-4 text-lg text-ink-700">
        Your loaf, reserved every week — for{" "}
        <strong className="text-ink">
          {club.priceLabel} {club.cadenceLabel}
        </strong>{" "}
        ({club.perLoafLabel}) you skip the race and never see the{" "}
        <em>Sold Out</em> sign again. It also helps us plan the bake, which is
        why members get first dibs.
      </p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {[
          ["🥖", "A loaf reserved for you before each public drop opens — you never have to catch it in time."],
          ["🍞", `One Classic loaf per drop (${club.loavesPerCycle} per billing cycle) — swap to another flavor whenever it's in the drop.`],
          ["📍", `Always-free local pickup in ${site.city}, with a members-only pickup window. California shipping at cost if you'd rather.`],
          ["⏸️", "Pause, skip a week, or cancel anytime — self-serve through Stripe. Quiet weeks with no drop don't get billed."],
          ["🥇", "First taste of new and seasonal flavors before they hit a public drop."],
          ["🤝", `Only ${club.seats} memberships so the oven can still feed the public drops — when they're gone, it's a waitlist.`],
          ["🎁", `Founding members — the first 5 to join — get a bonus loaf in their very first delivery.`],
        ].map(([emoji, text]) => (
          <li key={text} className="nb-card-sm flex items-start gap-3 p-4">
            <span aria-hidden className="text-xl">
              {emoji}
            </span>
            <span className="text-sm text-ink-700">{text}</span>
          </li>
        ))}
      </ul>

      <div className="nb-card mt-10 p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="display text-3xl">Ready when you are</h2>
          <span className="display text-2xl text-grad-acid">
            {club.priceLabel}{" "}
            <span className="text-base font-semibold text-ink-500">
              / {club.cadenceLabel}
            </span>
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-700">
          {!enabled
            ? "Online sign-ups open soon — email to grab one of the spots on the waitlist."
            : isFull
              ? `All ${club.seats} seats are taken. Hop on the waitlist and we'll text the moment a seat opens.`
              : `${club.loavesPerCycle} loaves per cycle, ${club.perLoafLabel}. Billing and the pause / cancel link are handled by Stripe.`}
        </p>
        {enabled && !isFull ? (
          <p className="mt-2 text-xs text-ink-500">
            After you sign up you&apos;ll get an email before each drop with a
            personal link to pick your loaf. Stripe handles billing, pausing,
            and cancelling.
          </p>
        ) : null}
        <div className="mt-4">
          <JoinBreadClub
            enabled={enabled && !isFull}
            waitlistHref={waitlistHref}
          />
        </div>
      </div>

      <div className="mt-8 border-t border-ink/15 pt-4">
        <CottageFoodNotice />
      </div>
    </div>
  );
}
