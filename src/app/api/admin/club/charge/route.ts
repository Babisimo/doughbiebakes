import { getAdminSession } from "@/lib/admin-auth";
import {
  getActiveMembers,
  getMemberChargesForDrop,
} from "@/lib/catalog";
import { sanityClient } from "@/sanity/client";
import { MEMBER_SELECTIONS_RAW_FOR_DROP_QUERY } from "@/sanity/lib/queries";
import { recordMemberCharge } from "@/sanity/lib/mutations";
import { dropChargeCents, shouldChargeMember } from "@/lib/club-billing";
import { sendClubDeclineEmail } from "@/lib/club-emails";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

type SelectionRow = { customerEmail: string; fulfillment: "pickup" | "ship"; skipped: boolean };

export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const stripe = getStripe();
  if (!stripe || !sanityClient) {
    return Response.json({ error: "Stripe/Sanity not configured." }, { status: 503 });
  }

  let body: { dropId?: unknown };
  try {
    body = (await req.json()) as { dropId?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const dropId = typeof body.dropId === "string" ? body.dropId.trim() : "";
  if (!dropId) return Response.json({ error: "Missing dropId." }, { status: 400 });

  const fresh = sanityClient.withConfig({ useCdn: false });
  const [members, selections, charges] = await Promise.all([
    getActiveMembers({ fresh: true }),
    fresh.fetch<SelectionRow[]>(
      MEMBER_SELECTIONS_RAW_FOR_DROP_QUERY,
      { dropId },
      { cache: "no-store" as const },
    ),
    getMemberChargesForDrop(dropId, { fresh: true }),
  ]);

  const selectionByEmail = new Map(
    (selections ?? []).map((s) => [s.customerEmail.toLowerCase(), s]),
  );
  const chargeStatusByCustomer = new Map(
    charges.map((c) => [c.customerId, c.status]),
  );

  let paid = 0;
  let failed = 0;
  let skipped = 0;
  const failures: { email: string; reason: string }[] = [];

  for (const member of members) {
    const selection = selectionByEmail.get(member.customerEmail.toLowerCase()) ?? null;
    const prior = chargeStatusByCustomer.get(member.stripeCustomerId) ?? null;
    if (!shouldChargeMember(selection, prior)) {
      if (selection?.skipped) skipped += 1;
      continue;
    }
    if (!member.stripePaymentMethodId) {
      failed += 1;
      failures.push({ email: member.customerEmail, reason: "No saved card" });
      await recordMemberCharge({
        dropId,
        stripeCustomerId: member.stripeCustomerId,
        customerEmail: member.customerEmail,
        amountCents: dropChargeCents(selection?.fulfillment ?? "pickup"),
        status: "failed",
        failureMessage: "No saved card on file",
      });
      continue;
    }
    const amountCents = dropChargeCents(selection?.fulfillment ?? "pickup");
    try {
      // Known window: if the PaymentIntent succeeds but recordMemberCharge
      // then throws, no charge doc is written and a re-run would charge the
      // member again. Tolerated at club scale — the baker sees a failed run
      // and can reconcile against Stripe before re-clicking.
      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: member.stripeCustomerId,
        payment_method: member.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Bread Club drop`,
        metadata: { dropId, customerEmail: member.customerEmail, kind: "club-drop" },
      });
      await recordMemberCharge({
        dropId,
        stripeCustomerId: member.stripeCustomerId,
        customerEmail: member.customerEmail,
        amountCents,
        status: "paid",
        stripePaymentIntentId: intent.id,
      });
      paid += 1;
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : "Card charge failed";
      const intentId =
        err && typeof err === "object" && "raw" in err
          ? ((err as { raw?: { payment_intent?: { id?: string } } }).raw
              ?.payment_intent?.id ?? undefined)
          : undefined;
      await recordMemberCharge({
        dropId,
        stripeCustomerId: member.stripeCustomerId,
        customerEmail: member.customerEmail,
        amountCents,
        status: "failed",
        stripePaymentIntentId: intentId,
        failureMessage: reason,
      });
      failed += 1;
      failures.push({ email: member.customerEmail, reason });
      // Best-effort — a failed email must never abort the rest of the run.
      try {
        await sendClubDeclineEmail({
          to: member.customerEmail,
          stripeCustomerId: member.stripeCustomerId,
        });
      } catch (emailErr) {
        console.error(
          "[club/charge] decline email failed",
          member.customerEmail,
          emailErr,
        );
      }
    }
  }

  return Response.json({ ok: true, paid, failed, skipped, failures });
}
