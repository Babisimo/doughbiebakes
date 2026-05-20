import { defineField, defineType } from "sanity";

/**
 * One $10-per-drop charge attempt for a member. Written by the per-drop
 * charge route. `_id = charge.<dropId>.<stripeCustomerId>` is deterministic
 * so a member can't be charged twice for one drop.
 */
export const memberChargeType = defineType({
  name: "memberCharge",
  title: "Member charge",
  type: "document",
  fields: [
    defineField({ name: "member", title: "Member", type: "reference", to: [{ type: "member" }], readOnly: true }),
    defineField({ name: "drop", title: "Drop", type: "reference", to: [{ type: "drop" }], readOnly: true }),
    defineField({ name: "customerEmail", title: "Member email", type: "string", readOnly: true }),
    defineField({ name: "amountCents", title: "Amount (cents)", type: "number", readOnly: true, validation: (r) => r.integer().min(0) }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: { list: [ { title: "Paid", value: "paid" }, { title: "Failed", value: "failed" } ], layout: "radio" },
      readOnly: true,
      validation: (r) => r.required(),
    }),
    defineField({ name: "stripePaymentIntentId", title: "Stripe PaymentIntent id", type: "string", readOnly: true }),
    defineField({ name: "failureMessage", title: "Failure message", type: "string", readOnly: true }),
    defineField({ name: "chargedAt", title: "Charged at", type: "datetime", readOnly: true, validation: (r) => r.required() }),
  ],
  preview: {
    select: { email: "customerEmail", status: "status", amount: "amountCents" },
    prepare: ({ email, status, amount }) => ({
      title: `${email ?? "(member)"} — ${status ?? "?"}`,
      subtitle: typeof amount === "number" ? `$${(amount / 100).toFixed(2)}` : undefined,
    }),
  },
});
