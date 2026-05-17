import type { ReactNode } from "react";

import Link from "next/link";

import { AddToCartButton } from "@/components/add-to-cart-button";
import { CottageFoodNotice } from "@/components/cottage-food-notice";
import { Countdown } from "@/components/countdown";
import { PreviousDrops } from "@/components/previous-drops";
import { ProductImage } from "@/components/product-image";
import { availabilityOf, buildAvailability, unavailableLabel } from "@/lib/availability";
import { getDropsView, getMemberSelectionsForDrop, getProducts } from "@/lib/catalog";
import { effectiveDropStatus } from "@/lib/drop-status";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";
import type { DropStatus } from "@/lib/types";

// Render per-request so "loaves left" reflects inventory immediately.
export const dynamic = "force-dynamic";

const DROP_STATUS_LABEL: Record<DropStatus, string> = {
  draft: "Draft",
  announced: "Dropping soon",
  open: "Open for orders",
  soldout: "Sold out",
  closed: "Closed",
};

function formatDate(value?: string) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default async function HomePage() {
  const [{ current: drop, previous }, products] = await Promise.all([
    getDropsView(),
    getProducts(),
  ]);
  const now = new Date();
  const eff = drop ? effectiveDropStatus(drop, now) : null;
  const memberSelections = await getMemberSelectionsForDrop(drop);
  const availability = buildAvailability(drop, memberSelections, now);
  const featured = products.slice(0, 3);

  return (
    <>
      {/* ============================== HERO ============================== */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-5xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:items-center md:py-20">
          <div className="space-y-6">
            <span className="reveal badge badge-acid">🍞 Home-baked in {site.city}</span>
            <h1 className="reveal reveal-2 display text-6xl leading-[0.95] sm:text-7xl md:text-[5.5rem]">
              Real <span className="text-grad-berry">sourdough</span>.
              <span className="block">Dropped weekly.</span>
            </h1>
            <p className="reveal reveal-3 max-w-prose text-lg text-ink-700">
              Naturally leavened and lovingly obsessed over. New flavors hit the
              feed every weekend — it&apos;s giving artisanal, it&apos;s giving
              limited drop, and yeah, it slaps. Don&apos;t sleep on it. 🍞✨
            </p>
            <div className="reveal reveal-4 flex flex-wrap gap-3">
              <Link href="#current-drop" className="btn-acid text-sm">
                See this week&apos;s drop ＋
              </Link>
              <Link href="/menu" className="btn-outline text-sm">
                The full menu
              </Link>
            </div>
          </div>
          <div className="reveal reveal-3 relative">
            <div className="nb-card nb-interactive overflow-hidden">
              <ProductImage
                src={featured[0]?.imageUrl}
                alt={featured[0]?.name ?? "Fresh sourdough"}
                priority
                sizes="(min-width: 768px) 32rem, 100vw"
              />
              <div className="flex items-center justify-between gap-2 p-4">
                <span className="display text-lg">
                  {featured[0]?.name ?? "Classic"}
                </span>
                {featured[0] ? (
                  <span className="rounded-full bg-ochre px-2.5 py-1 text-sm font-bold text-ink">
                    {formatPrice(featured[0].priceCents)}
                  </span>
                ) : null}
              </div>
            </div>
            <span className="badge badge-flame absolute -left-3 -top-3 rotate-[-6deg]">
              ✶ no commercial yeast
            </span>
          </div>
        </div>
        {/* marquee under the hero */}
        <div className="marquee panel-mono py-2.5">
          <span className="marquee__track display text-sm tracking-wide">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="mx-6">
                cheddar jalapeño ✶ pepperoni garlic ✶ banana brown sugar ✶ strawberry ✶ classic ✶
              </span>
            ))}
          </span>
        </div>
      </section>

      {/* ========================== CURRENT DROP ========================== */}
      <section id="current-drop" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-16 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
              The drop
            </p>
            <h2 className="display mt-1 text-4xl sm:text-5xl">
              {drop ? drop.title : "Next drop"}
            </h2>
          </div>
          {drop && eff ? (
            <span
              className={`badge ${
                eff === "open"
                  ? "badge-sage"
                  : eff === "soldout"
                    ? "badge-flame"
                    : ""
              }`}
            >
              {DROP_STATUS_LABEL[eff]}
            </span>
          ) : null}
        </div>

        {drop ? (
          <>
            {/* Scarcity driver: one big, centered, ticking order-window timer.
                Fulfillment timing is intentionally NOT a countdown — it's
                reassurance in the trust strip below, not extra pressure. */}
            {(() => {
              let timer: ReactNode = null;
              if (eff === "open" && drop.ordersCloseAt) {
                timer = (
                  <Countdown
                    to={drop.ordersCloseAt}
                    label="⏰ Orders close in"
                    doneLabel="Orders closed"
                    tone="acid"
                    prominent
                  />
                );
              } else if (eff === "announced" && drop.ordersOpenAt) {
                timer = (
                  <Countdown
                    to={drop.ordersOpenAt}
                    label="🔔 Orders open in"
                    doneLabel="Open now — refresh!"
                    tone="sage"
                    prominent
                  />
                );
              }
              return timer ? (
                <div className="mt-8 flex justify-center">{timer}</div>
              ) : null;
            })()}

            {/* trust strip — reassurance, not a second clock */}
            {eff !== "closed" ? (
              <ul className="mt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                <li className="badge">🍞 Baked to order</li>
                <li className="badge">📍 Free Corona pickup</li>
                <li className="badge">🚚 California shipping</li>
                <li className="badge">🔒 Secure Stripe checkout</li>
                <li className="badge badge-sage">
                  📦{" "}
                  {drop.pickupOrShipDate
                    ? `Ready ${formatDate(drop.pickupOrShipDate)}`
                    : "Usually ready within a week"}
                </li>
              </ul>
            ) : null}
            {drop.note ? (
              <p className="mt-5 max-w-prose rounded-2xl border-l-4 border-acid bg-white/40 py-2 pl-4 pr-3 text-ink-700">
                {drop.note}
              </p>
            ) : null}

            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {drop.lineItems.map(({ product }, i) => {
                const a = availabilityOf(availability, product.slug);
                const soldOut = !a.canOrder;
                const badge = a.canOrder
                  ? `${a.remaining} loaf${a.remaining === 1 ? "" : "ves"} left`
                  : unavailableLabel(a.reason);
                return (
                  <li key={product.slug} className="nb-card nb-interactive flex flex-col overflow-hidden">
                    <div className="relative">
                      <Link href={`/product/${product.slug}`}>
                        <ProductImage
                          src={product.imageUrl}
                          alt={product.name}
                          priority={i === 0}
                        />
                      </Link>
                      <span
                        className={`badge absolute right-3 top-3 ${
                          soldOut ? "badge-flame" : "badge-acid"
                        }`}
                      >
                        {badge}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          href={`/product/${product.slug}`}
                          className="display text-xl leading-tight hover:text-acid-600"
                        >
                          {product.name}
                        </Link>
                        <span className="shrink-0 rounded-full bg-ochre px-2.5 py-1 text-sm font-bold text-ink">
                          {formatPrice(product.priceCents)}
                        </span>
                      </div>
                      {product.tagline ? (
                        <p className="text-sm text-ink-700">{product.tagline}</p>
                      ) : null}
                      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
                        <AddToCartButton
                          slug={product.slug}
                          available={!soldOut}
                          remaining={a.remaining}
                          unavailableLabel={unavailableLabel(a.reason)}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="nb-card mt-6 p-8">
            <p className="text-ink-700">
              No open drop right now. New drops get announced on{" "}
              <a
                className="font-bold text-acid-600 underline decoration-2 hover:no-underline"
                href={site.instagram}
                target="_blank"
                rel="noopener noreferrer"
              >
                Instagram
              </a>{" "}
              — or join the{" "}
              <Link
                className="font-bold text-acid-600 underline decoration-2 hover:no-underline"
                href="/bread-club"
              >
                Bread Club
              </Link>{" "}
              for a standing weekly loaf.
            </p>
          </div>
        )}
      </section>

      <PreviousDrops drops={previous} />

      {/* ======================== HOW DROPS WORK ========================= */}
      <section className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="nb-card grid gap-0 overflow-hidden p-2 sm:grid-cols-3">
          {[
            {
              n: "01",
              title: "A drop opens",
              body: "Each week a small batch goes up here — a set number of loaves per flavor. When they're gone, they're gone.",
            },
            {
              n: "02",
              title: "You pre-order",
              body: "Pay securely with Stripe. Pickup in Corona is free; California shipping is a flat rate.",
            },
            {
              n: "03",
              title: "We bake & hand off",
              body: "Everything is baked to order the day before pickup or shipping. Fresh, never sitting on a shelf.",
            },
          ].map((step, i) => (
            <div
              key={step.n}
              className={`flex flex-col gap-2 p-6 ${
                i > 0 ? "border-t border-white/50 sm:border-l sm:border-t-0" : ""
              }`}
            >
              <span className="display text-5xl text-grad-acid">{step.n}</span>
              <h3 className="display text-xl">{step.title}</h3>
              <p className="text-sm text-ink-700">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* =========================== MENU PEEK =========================== */}
      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div className="flex items-end justify-between gap-3">
          <h2 className="display text-4xl sm:text-5xl">From the menu</h2>
          <Link
            href="/menu"
            className="text-sm font-bold text-acid-600 underline decoration-2 hover:no-underline"
          >
            See all loaves →
          </Link>
        </div>
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((product, i) => {
            const a = availabilityOf(availability, product.slug);
            return (
              <li key={product.slug} className="nb-card nb-interactive flex flex-col overflow-hidden">
                <div className="relative">
                  <Link href={`/product/${product.slug}`}>
                    <ProductImage src={product.imageUrl} alt={product.name} priority={i === 0} />
                  </Link>
                  <span
                    className={`badge absolute right-3 top-3 ${
                      a.canOrder ? "badge-acid" : "badge-flame"
                    }`}
                  >
                    {a.canOrder
                      ? a.remaining != null
                        ? `${a.remaining} left`
                        : "Available"
                      : unavailableLabel(a.reason)}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-1 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/product/${product.slug}`}
                      className="display text-xl leading-tight hover:text-acid-600"
                    >
                      {product.name}
                    </Link>
                    <span className="shrink-0 rounded-full bg-ochre px-2.5 py-1 text-sm font-bold text-ink">
                      {formatPrice(product.priceCents)}
                    </span>
                  </div>
                  {product.tagline ? (
                    <p className="text-sm text-ink-700">{product.tagline}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <AddToCartButton
                      slug={product.slug}
                      available={a.canOrder}
                      remaining={a.remaining}
                      unavailableLabel={unavailableLabel(a.reason)}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ============================= ABOUT ============================= */}
      <section id="about" className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
        <div className="nb-card panel-mono space-y-4 p-8 sm:p-12">
          <h2 className="display text-4xl sm:text-5xl">About {site.name}</h2>
          <p className="text-white/90">
            {site.name} is a one-person home bakery in {site.city}. Everything is
            mixed, shaped, and baked in a small apartment kitchen — four loaves to
            a batch — using a sourdough starter, good flour, water, and salt. No
            commercial yeast, no shortcuts.
          </p>
          <p className="text-white/90">
            Because the oven only fits so much, loaves are sold in scheduled drops
            and the occasional standing Bread Club order. If a flavor sells out,
            it&apos;ll be back around next time.
          </p>
          <div className="nb-card-sm mt-4 bg-white/80 p-4 text-ink">
            <CottageFoodNotice />
          </div>
        </div>
      </section>
    </>
  );
}
