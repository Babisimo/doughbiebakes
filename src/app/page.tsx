import type { ReactNode } from "react";

import Link from "next/link";

import { AddToCartButton } from "@/components/add-to-cart-button";
import { CottageFoodNotice } from "@/components/cottage-food-notice";
import { Countdown } from "@/components/countdown";
import { FlashSaleBanner } from "@/components/flash-sale-banner";
import { HashScroller } from "@/components/hash-scroller";
import { PreviousDrops } from "@/components/previous-drops";
import { ProductImage } from "@/components/product-image";
import { SalePrice } from "@/components/sale-price";
import { availabilityOf, buildAvailability, unavailableLabel } from "@/lib/availability";
import {
  getDropsView,
  getMemberSelectionsForDrop,
  getProducts,
  getReservationHoldsForDrop,
} from "@/lib/catalog";
import { effectiveDropStatus } from "@/lib/drop-status";
import { flashSaleStatus } from "@/lib/flash-sale";
import { IS_PRELAUNCH } from "@/lib/launch-mode";
import { site } from "@/lib/site";
import type { DropStatus } from "@/lib/types";
import { pickWeeklyFeatured } from "@/lib/weekly-feature";

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
  const holds = await getReservationHoldsForDrop(drop?.id);
  const availability = buildAvailability(drop, memberSelections, now, holds);
  const featured = products.slice(0, 3);
  // Hero "loaf of the week" — rotates weekly, favors loaves with a photo.
  const heroProduct = pickWeeklyFeatured(products, now);
  const flash = flashSaleStatus(drop, now);

  return (
    <>
      <HashScroller />
      {/* ============================== HERO ============================== */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-5xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:items-center md:py-20">
          <div className="space-y-6">
            <span className="reveal badge badge-acid">🍞 Home-baked in {site.city}</span>
            {/* "Grand opening · 15% off · FOUNDING" panel — paused while the
                checkout / promo paths are off; reappears the moment
                NEXT_PUBLIC_LAUNCH_MODE flips to "live". */}
            {IS_PRELAUNCH ? null : (
              <div className="reveal rounded-3xl panel-acid px-5 py-4 shadow-[var(--shadow-hard)]">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink">
                  🎉 Grand opening
                </p>
                <p className="display mt-0.5 text-3xl leading-[1.05] text-ink sm:text-4xl">
                  15% off your first order
                </p>
                <p className="mt-2 text-sm font-semibold text-ink">
                  Use code <strong>FOUNDING</strong> at checkout — first 5 orders.
                  Bread Club founding members get a bonus loaf.
                </p>
              </div>
            )}
            <h1 className="reveal reveal-2 display text-6xl leading-[0.95] sm:text-7xl md:text-[5.5rem]">
              Real <span className="text-grad-berry">sourdough</span>.
              <span className="block">Dropped weekly.</span>
            </h1>
            <p className="reveal reveal-3 max-w-prose text-lg text-ink-700">
              Every loaf starts with our own sourdough starter, fed by hand and
              slow-fermented for that deep, real flavor. We shape each small batch
              by hand and drop fresh loaves every weekend. Set your alarm — they
              lowkey sell out quick. 🥖
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
            <Link
              href={heroProduct ? `/product/${heroProduct.slug}` : "/menu"}
              aria-label={
                heroProduct
                  ? `${heroProduct.name} — see details and ingredients`
                  : "See the full menu"
              }
              className="nb-card nb-interactive block overflow-hidden"
            >
              <ProductImage
                src={heroProduct?.imageUrl}
                alt={heroProduct?.name ?? "Fresh sourdough"}
                priority
                sizes="(min-width: 768px) 32rem, 100vw"
              />
              <div className="flex items-center justify-between gap-2 p-4">
                <span className="display text-lg">
                  {heroProduct?.name ?? "Classic"}
                </span>
                {heroProduct ? (
                  <SalePrice
                    cents={heroProduct.priceCents}
                    percentOff={flash.active ? flash.percentOff : 0}
                  />
                ) : null}
              </div>
            </Link>
            <span className="badge badge-flame pointer-events-none absolute -left-3 -top-3 rotate-[-6deg]">
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

      {/* ========================= FLASH SALE BANNER ======================== */}
      {drop ? (
        <div className="mx-auto max-w-5xl px-4 pb-2 pt-8 sm:px-6">
          <FlashSaleBanner state={flash} />
        </div>
      ) : null}

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
                  ? `${a.remaining} Loaf${a.remaining === 1 ? "" : "s"} Left`
                  : unavailableLabel(a.reason);
                return (
                  <li key={product.slug} className="nb-card nb-interactive relative flex flex-col">
                    <div className="relative overflow-hidden rounded-t-[1.75rem]">
                      <Link href={`/product/${product.slug}`}>
                        <ProductImage
                          src={product.imageUrl}
                          alt={product.name}
                          priority={i === 0}
                        />
                      </Link>
                    </div>
                    <span
                      className={`badge badge-count absolute -right-3 -top-3 z-10 rotate-[-6deg] text-sm uppercase shadow-[var(--shadow-hard-acid)] ${
                        soldOut ? "badge-flame" : "badge-acid"
                      }`}
                    >
                      {badge}
                    </span>
                    <div className="flex flex-1 flex-col gap-2 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          href={`/product/${product.slug}`}
                          className="display text-xl leading-tight hover:text-acid-600"
                        >
                          {product.name}
                        </Link>
                        <SalePrice
                          cents={product.priceCents}
                          percentOff={flash.active ? flash.percentOff : 0}
                          className="shrink-0"
                        />
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
          <div className="nb-card mt-6 p-8 text-center">
            <p className="display text-3xl">Welcome 🍞</p>
            <p className="mt-3 text-ink-700">
              The first drop is coming soon — check back to see what&apos;s
              hitting the oven.
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
              <li key={product.slug} className="nb-card nb-interactive relative flex flex-col">
                <div className="relative overflow-hidden rounded-t-[1.75rem]">
                  <Link href={`/product/${product.slug}`}>
                    <ProductImage src={product.imageUrl} alt={product.name} priority={i === 0} />
                  </Link>
                </div>
                <span
                  className={`badge badge-count absolute -right-3 -top-3 z-10 rotate-[-6deg] text-sm uppercase shadow-[var(--shadow-hard-acid)] ${
                    a.canOrder ? "badge-acid" : "badge-flame"
                  }`}
                >
                  {a.canOrder
                    ? a.remaining != null
                      ? `${a.remaining} Loaf${a.remaining === 1 ? "" : "s"} Left`
                      : "Available"
                    : unavailableLabel(a.reason)}
                </span>
                <div className="flex flex-1 flex-col gap-1 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/product/${product.slug}`}
                      className="display text-xl leading-tight hover:text-acid-600"
                    >
                      {product.name}
                    </Link>
                    <SalePrice
                      cents={product.priceCents}
                      percentOff={flash.active ? flash.percentOff : 0}
                      className="shrink-0"
                    />
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
      <section id="about" className="mx-auto max-w-5xl scroll-mt-20 px-4 pb-20 sm:px-6">
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
          {!site.cottageFood.muted && (
            <div className="nb-card-sm mt-4 bg-white/80 p-4 text-ink">
              <CottageFoodNotice />
            </div>
          )}
        </div>
      </section>
    </>
  );
}
