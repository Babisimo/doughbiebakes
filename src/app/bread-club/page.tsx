import type { Metadata } from "next";

import { CottageFoodNotice } from "@/components/cottage-food-notice";
import { JoinBreadClub } from "@/components/join-bread-club";
import { getActiveMemberCount, getFoundingMemberCount } from "@/lib/catalog";
import { IS_PRELAUNCH } from "@/lib/launch-mode";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Bread Club",
  description: `A standing weekly sourdough loaf from ${site.name} — ${site.breadClub.priceLabel} ${site.breadClub.cadenceLabel}.`,
};

export default async function BreadClubPage() {
  // While we're in pre-launch (friends-only) mode, force the waitlist UI
  // regardless of whether Stripe is wired up. We can't take card-on-file
  // signups until the CFO permit is issued.
  const enabled = !IS_PRELAUNCH && Boolean(process.env.STRIPE_SECRET_KEY);
  const club = site.breadClub;
  const memberCount = await getActiveMemberCount({ fresh: true });
  // Demo mode (no Sanity / no cache) -> we can't enforce the cap. Treat the
  // club as open in that case rather than locking out new sign-ups.
  const spotsLeft = memberCount === null ? club.seats : Math.max(0, club.seats - memberCount);
  const isFull = enabled && spotsLeft <= 0;

  // Founding bonus-loaf cohort — the first `foundingSeats` members ever.
  const foundingCount = await getFoundingMemberCount({ fresh: true });
  const foundingSpotsLeft =
    foundingCount === null
      ? null
      : Math.max(0, club.foundingSeats - foundingCount);
  const membershipLine =
    memberCount === null
      ? `${club.seats} memberships open`
      : isFull
        ? "Membership full — waitlist open"
        : `${spotsLeft} of ${club.seats} memberships open`;
  const foundingLine =
    foundingSpotsLeft === null
      ? `🎁 First ${club.foundingSeats} to join get a bonus loaf in their first box.`
      : foundingSpotsLeft > 0
        ? `🎁 First ${club.foundingSeats} to join get a bonus loaf in their first box — ${foundingSpotsLeft} founding ${foundingSpotsLeft === 1 ? "spot" : "spots"} left.`
        : `🎁 Founding bonus loaves — all ${club.foundingSeats} claimed.`;

  const waitlistHref = `mailto:${site.email}?subject=${encodeURIComponent(
    "Bread Club waitlist",
  )}&body=${encodeURIComponent(
    "Hi! I'd like to join the Bread Club for a standing weekly loaf. My name and neighborhood: ",
  )}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="rounded-3xl panel-acid px-5 py-4 shadow-[var(--shadow-hard)]">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink">
          ✶ Neighbors only · {site.city}
        </p>
        <p className="display mt-0.5 text-3xl leading-[1.05] text-ink sm:text-4xl">
          {membershipLine}
        </p>
        <p className="mt-2 text-sm font-semibold text-ink">{foundingLine}</p>
      </div>
      <h1 className="display mt-3 text-6xl sm:text-7xl">
        The <span className="text-grad-acid">Bread Club</span>
      </h1>
      <p className="mt-4 text-lg text-ink-700">
        Your loaf, reserved every drop — for{" "}
        <strong className="text-ink">
          {club.priceLabel} {club.cadenceLabel}
        </strong>{" "}
        you skip the race and never see the <em>Sold Out</em> sign again. We
        only charge on weeks we bake, so quiet weeks cost nothing. It also
        helps us plan the bake, which is why members get first dibs.
      </p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {[
          ["🥖", "A loaf reserved for you before each public drop opens — you never have to catch it in time."],
          ["🍞", "One loaf per drop — $10, charged only on weeks we bake. Swap to another flavor whenever it's in the drop."],
          ["📍", `Always-free local pickup in ${site.city}, with a members-only pickup window. California shipping at cost if you'd rather.`],
          ["⏸️", "Skip any drop you don't want — just tell us in your loaf-pick email, and that week is free. Leave anytime with the link in your emails."],
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
          {IS_PRELAUNCH
            ? `Sign-ups open the moment our Cottage Food Operation registration clears. Stay tuned.`
            : !enabled
              ? "Online sign-ups open soon — email to grab one of the spots on the waitlist."
              : isFull
                ? `All ${club.seats} seats are taken. Hop on the waitlist and we'll text the moment a seat opens.`
                : `$10 per drop, billed when the drop runs — you're only charged on weeks we bake.`}
        </p>
        {enabled && !isFull ? (
          <p className="mt-2 text-xs text-ink-500">
            After you sign up you&apos;ll get an email before each drop with a
            personal link to pick your loaf. We charge $10 only when a drop
            runs, and you can skip or cancel from any of our emails.
          </p>
        ) : null}
        <div className="mt-4">
          {IS_PRELAUNCH ? (
            <span className="btn-ink text-sm pointer-events-none opacity-75">
              Coming soon
            </span>
          ) : (
            <JoinBreadClub
              enabled={enabled && !isFull}
              waitlistHref={waitlistHref}
            />
          )}
        </div>
      </div>

      <div className="mt-8 border-t border-ink/15 pt-4">
        <CottageFoodNotice />
      </div>
    </div>
  );
}
