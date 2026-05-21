"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProductImage } from "@/components/product-image";

type Option = {
  slug: string;
  name: string;
  tagline: string | null;
  imageUrl: string | null;
  priceLabel: string;
  remaining: number;
};

type Fulfillment = "pickup" | "ship";

function formatDropDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function SelectionForm({
  dropId,
  dropTitle,
  dropPickupOrShipDate,
  shipSurchargeLabel,
  email,
  token,
  currentSlug,
  currentFulfillment,
  currentSkipped,
  options,
  windowOpen,
}: {
  dropId: string;
  dropTitle: string;
  dropPickupOrShipDate: string | null;
  shipSurchargeLabel: string;
  email: string;
  token: string;
  currentSlug: string | null;
  currentFulfillment: Fulfillment;
  currentSkipped: boolean;
  options: Option[];
  windowOpen: boolean;
}) {
  const router = useRouter();
  // "saved" is what's persisted in Sanity. "draft" is what the member is
  // working on. Nothing hits the API until they click Confirm.
  const [savedSlug, setSavedSlug] = useState<string | null>(currentSlug);
  const [savedFulfillment, setSavedFulfillment] = useState<Fulfillment>(currentFulfillment);
  const [draftSlug, setDraftSlug] = useState<string | null>(currentSlug);
  const [draftFulfillment, setDraftFulfillment] = useState<Fulfillment>(currentFulfillment);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<"unknown" | "sent" | "failed">("unknown");
  const [skipped, setSkipped] = useState(currentSkipped);

  const dirty =
    draftSlug !== null &&
    (draftSlug !== savedSlug || draftFulfillment !== savedFulfillment);

  async function confirm() {
    if (!draftSlug || !dirty || !windowOpen) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/club/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dropId,
          email,
          token,
          productSlug: draftSlug,
          fulfillment: draftFulfillment,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        emailSent?: boolean;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Something went wrong — try again.");
      }
      setSavedSlug(draftSlug);
      setSavedFulfillment(draftFulfillment);
      setSkipped(false);
      setEmailStatus(data.emailSent ? "sent" : "failed");
      // Re-render the server component so every card's "N left" reflects the
      // pick we just saved (and anyone else's picks since page load).
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function skipDrop() {
    if (!windowOpen) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/club/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropId, email, token, skip: true }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Something went wrong — try again.");
      }
      setSavedSlug(null);
      setDraftSlug(null);
      setSkipped(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraftSlug(savedSlug);
    setDraftFulfillment(savedFulfillment);
    setError(null);
  }

  const savedOption = savedSlug ? options.find((o) => o.slug === savedSlug) ?? null : null;

  return (
    <div className="mt-8 space-y-6">
      {error ? (
        <p className="nb-card-sm bg-flame/15 p-3 text-sm text-ink">{error}</p>
      ) : null}

      {savedOption ? (
        <ConfirmationCard
          flavorName={savedOption.name}
          fulfillment={savedFulfillment}
          dropPickupOrShipDate={dropPickupOrShipDate}
          dropTitle={dropTitle}
          emailStatus={emailStatus}
          email={email}
          windowOpen={windowOpen}
        />
      ) : skipped ? (
        <section className="nb-card border-2 border-ink/20 bg-ink/5 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Drop skipped
          </p>
          <p className="mt-2 text-sm text-ink-700">
            You&apos;ve skipped this drop — you won&apos;t be charged. Changed your mind? Pick a loaf above while the window is open.
          </p>
        </section>
      ) : null}

      <FulfillmentToggle
        value={draftFulfillment}
        onChange={(next) => setDraftFulfillment(next)}
        disabled={!windowOpen}
        shipSurchargeLabel={shipSurchargeLabel}
      />

      <div>
        <h2 className="display text-2xl">
          {savedSlug ? "Want to swap?" : "Pick your loaf"}
        </h2>
        <ul className="mt-3 grid gap-4 sm:grid-cols-2">
          {options.map((opt) => {
            const isDraft = draftSlug === opt.slug;
            const isSaved = savedSlug === opt.slug;
            const soldOut = opt.remaining <= 0 && !isSaved;
            const disabled = !windowOpen || soldOut;
            return (
              <li
                key={opt.slug}
                className={`nb-card overflow-hidden ${isDraft ? "ring-2 ring-acid" : ""}`}
              >
                <ProductImage src={opt.imageUrl} alt={opt.name} />
                <div className="space-y-2 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="display text-xl">{opt.name}</span>
                    <span className="text-sm font-bold">{opt.priceLabel}</span>
                  </div>
                  {opt.tagline ? (
                    <p className="text-sm text-ink-700">{opt.tagline}</p>
                  ) : null}
                  <p className="text-xs text-ink-500">
                    {isSaved
                      ? "Reserved for you ✓"
                      : soldOut
                        ? "Claimed by other members"
                        : `${opt.remaining} left for the drop`}
                  </p>
                  <a
                    href={`/product/${opt.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs font-semibold text-acid-600 underline decoration-2 hover:no-underline"
                  >
                    See ingredients ↗
                  </a>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setDraftSlug(opt.slug)}
                    className={`w-full text-xs ${isDraft ? "btn-acid" : "btn-outline"}`}
                  >
                    {isDraft
                      ? isSaved
                        ? "Your pick ✓"
                        : "Selected — confirm below"
                      : isSaved
                        ? "Currently saved"
                        : "Choose this one"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {windowOpen ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={skipDrop}
            className="btn-outline text-xs"
          >
            {saving ? "Saving…" : "Skip this drop"}
          </button>
        </div>
      ) : null}

      <ConfirmBar
        dirty={dirty}
        saving={saving}
        hasDraft={draftSlug !== null}
        hasSaved={savedSlug !== null}
        windowOpen={windowOpen}
        onConfirm={confirm}
        onDiscard={discard}
      />
    </div>
  );
}

function ConfirmBar({
  dirty,
  saving,
  hasDraft,
  hasSaved,
  windowOpen,
  onConfirm,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  hasDraft: boolean;
  hasSaved: boolean;
  windowOpen: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  if (!windowOpen) return null;
  if (!hasDraft) return null;
  if (!dirty && hasSaved) return null;

  return (
    <div
      className="sticky bottom-4 z-10 nb-card flex flex-wrap items-center justify-between gap-3 border-2 border-acid bg-white p-4"
    >
      <p className="text-sm font-semibold">
        {hasSaved ? "Unsaved changes — confirm to update your pick." : "Ready to confirm your pick?"}
      </p>
      <div className="flex gap-2">
        {hasSaved ? (
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="btn-outline text-xs"
          >
            Discard
          </button>
        ) : null}
        <button
          type="button"
          onClick={onConfirm}
          disabled={!dirty || saving}
          className="btn-acid text-xs"
        >
          {saving ? "Saving…" : hasSaved ? "Confirm changes" : "Confirm pick"}
        </button>
      </div>
    </div>
  );
}

function ConfirmationCard({
  flavorName,
  fulfillment,
  dropPickupOrShipDate,
  dropTitle,
  emailStatus,
  email,
  windowOpen,
}: {
  flavorName: string;
  fulfillment: Fulfillment;
  dropPickupOrShipDate: string | null;
  dropTitle: string;
  emailStatus: "unknown" | "sent" | "failed";
  email: string;
  windowOpen: boolean;
}) {
  const dateLabel = formatDropDate(dropPickupOrShipDate);
  return (
    <section className="nb-card border-2 border-acid bg-acid/10 p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-acid-600">
        You&apos;re all set
      </p>
      <h2 className="display mt-1 text-2xl text-ink">
        {flavorName} — reserved 🍞
      </h2>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm text-ink-700 sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold">Drop:</dt>
        <dd>
          {dropTitle}
          {dateLabel ? ` · ${dateLabel}` : ""}
        </dd>
        <dt className="font-semibold">Get it via:</dt>
        <dd>
          {fulfillment === "pickup"
            ? "📍 Local pickup — we'll text the pickup window before drop day"
            : "📦 Shipping to the address on file with Stripe"}
        </dd>
      </dl>
      <p className="mt-3 text-xs text-ink-500">
        {emailStatus === "sent" ? (
          <>Confirmation sent to {email}. {windowOpen ? "Come back to this page any time before the drop opens to change your pick." : "The selection window is closed — your pick is locked in."}</>
        ) : emailStatus === "failed" ? (
          <>Your pick is saved, but the confirmation email didn&apos;t send. Check spam, or reply to a previous email if you need a paper trail.</>
        ) : (
          <>{windowOpen ? "Come back to this page any time before the drop opens to change your pick." : "The selection window is closed — your pick is locked in."}</>
        )}
      </p>
    </section>
  );
}

function FulfillmentToggle({
  value,
  onChange,
  disabled,
  shipSurchargeLabel,
}: {
  value: Fulfillment;
  onChange: (next: Fulfillment) => void;
  disabled: boolean;
  shipSurchargeLabel: string;
}) {
  return (
    <div className="nb-card-sm p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
        How do you want this one?
      </p>
      <div
        role="radiogroup"
        aria-label="Fulfillment method"
        className="mt-3 inline-flex rounded-full border border-ink/20 bg-white p-1"
      >
        <ToggleBtn
          selected={value === "pickup"}
          disabled={disabled}
          onClick={() => onChange("pickup")}
        >
          📍 Local pickup (free)
        </ToggleBtn>
        <ToggleBtn
          selected={value === "ship"}
          disabled={disabled}
          onClick={() => onChange("ship")}
        >
          📦 Ship to my address (+{shipSurchargeLabel})
        </ToggleBtn>
      </div>
      <p className="mt-2 text-xs text-ink-500">
        {value === "pickup"
          ? "We'll text you the pickup window before drop day."
          : `We'll ship to the address on file with Stripe. ${shipSurchargeLabel} shipping is added to your next Bread Club invoice — no separate checkout.`}
      </p>
    </div>
  );
}

function ToggleBtn({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        selected
          ? "border-transparent bg-ochre text-ink shadow-sm hover:border-ink/70 active:scale-95"
          : "border-transparent text-ink-700 hover:bg-ink/5 disabled:opacity-50"
      }`}
    >
      {children}
    </button>
  );
}
