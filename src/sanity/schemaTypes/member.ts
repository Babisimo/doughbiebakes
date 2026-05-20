import { defineField, defineType } from "sanity";

/**
 * A Bread Club member. Created by the Stripe webhook on a completed
 * `setup`-mode Checkout (the join flow). `_id` is the Stripe customer id so
 * creation is idempotent. There is no Stripe subscription — billing is
 * per-drop (see `memberCharge`).
 */
export const memberType = defineType({
  name: "member",
  title: "Member",
  type: "document",
  fields: [
    defineField({
      name: "customerEmail",
      title: "Email",
      type: "string",
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: "stripeCustomerId",
      title: "Stripe customer id",
      type: "string",
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "stripePaymentMethodId",
      title: "Saved card (Stripe payment method id)",
      type: "string",
      readOnly: true,
    }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Active", value: "active" },
          { title: "Canceled", value: "canceled" },
        ],
        layout: "radio",
      },
      initialValue: "active",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "joinedAt",
      title: "Joined at",
      type: "datetime",
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({ name: "canceledAt", title: "Canceled at", type: "datetime", readOnly: true }),
    defineField({
      name: "founding",
      title: "Founding member (bonus loaf in first delivery)",
      type: "boolean",
      readOnly: true,
    }),
  ],
  preview: {
    select: { email: "customerEmail", status: "status", founding: "founding" },
    prepare: ({ email, status, founding }) => ({
      title: founding ? `★ FOUNDING — ${email}` : email,
      subtitle: founding ? `${status} · add bonus loaf to first delivery` : status,
    }),
  },
});
