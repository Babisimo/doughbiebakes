import "server-only";

import { getActiveDrop, getMemberSelectionsForDrop } from "@/lib/catalog";
import { buildClubConfirmation } from "@/lib/club-confirmation-email";
import { signClubToken, verifyClubToken } from "@/lib/club-token";
import { effectiveDropStatus } from "@/lib/drop-status";
import { sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/url";
import { upsertMemberSelection } from "@/sanity/lib/mutations";

export const runtime = "nodejs";

type Body = {
  dropId?: unknown;
  email?: unknown;
  token?: unknown;
  productSlug?: unknown;
  fulfillment?: unknown;
  skip?: unknown;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad JSON body." }, { status: 400 });
  }

  const dropId = typeof body.dropId === "string" ? body.dropId : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const token = typeof body.token === "string" ? body.token : "";
  const productSlug = typeof body.productSlug === "string" ? body.productSlug : "";
  const fulfillment = body.fulfillment === "ship" ? "ship" : "pickup";
  const skip = body.skip === true;

  if (!dropId || !email || !token) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }
  if (!skip && !productSlug) {
    return Response.json({ error: "Pick a loaf or skip this drop." }, { status: 400 });
  }
  if (!verifyClubToken(email, dropId, token)) {
    return Response.json({ error: "Invalid or expired link." }, { status: 403 });
  }

  const drop = await getActiveDrop({ fresh: true });
  if (!drop || drop.id !== dropId) {
    return Response.json(
      { error: "This drop is no longer the active one." },
      { status: 409 },
    );
  }
  if (effectiveDropStatus(drop, new Date()) !== "announced") {
    return Response.json(
      { error: "The member selection window for this drop is closed." },
      { status: 409 },
    );
  }

  // `line` is the matched drop line item for a pick; stays null for a skip.
  let line: (typeof drop.lineItems)[number] | undefined;
  if (!skip) {
    line = drop.lineItems.find((li) => li.product.slug === productSlug);
    if (!line) {
      return Response.json(
        { error: "That loaf isn't part of this drop." },
        { status: 409 },
      );
    }
    const selections = await getMemberSelectionsForDrop(drop, { fresh: true });
    const claimedByOthers = selections.filter(
      (s) => s.productSlug === productSlug && s.customerEmail !== email,
    ).length;
    const totalForSlug = Math.max(0, Math.floor(line.quantity ?? 0));
    // Best-effort TOCTOU check: a tiny read-then-write race exists between
    // this count and the upsert below; acceptable at Bread Club scale.
    if (claimedByOthers >= totalForSlug) {
      return Response.json(
        { error: "Another member just claimed the last one — please pick another flavor." },
        { status: 409 },
      );
    }
  }

  // When `skip` is true, `productSlug` and `fulfillment` are intentionally
  // ignored — a skipped drop has no loaf and no fulfillment choice.
  const wrote = await upsertMemberSelection({
    dropId,
    email,
    productSlug: skip ? undefined : productSlug,
    fulfillment,
    skipped: skip,
  });
  if (!wrote) {
    return Response.json(
      { error: "Selections can't be saved — Sanity write client isn't configured." },
      { status: 503 },
    );
  }

  // Confirmation email — for a pick, confirm the loaf; for a skip, confirm
  // the skip. Best-effort: log + swallow so a flaky mailer never blocks save.
  const freshToken = signClubToken(email, drop.id);
  const selfServeUrl = `${siteUrl()}/club/${drop.id}?email=${encodeURIComponent(email)}&token=${freshToken}`;
  const flavorName = skip ? null : (line?.product.name ?? productSlug);
  const message = buildClubConfirmation({
    skipped: skip,
    flavorName,
    fulfillment,
    dropTitle: drop.title,
    pickupOrShipDate: drop.pickupOrShipDate,
    selfServeUrl,
  });
  const emailSent = await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  return Response.json({ ok: true, skipped: skip, productSlug: skip ? null : productSlug, fulfillment, emailSent });
}
