import { defineField, defineType } from "sanity";

/**
 * A Bread Club member. Written by the Stripe webhook on
 * `customer.subscription.created/updated/deleted` events — Stripe is the
 * source of truth, this is just a cache so the storefront and operator
 * scripts don't have to query Stripe every time. The doc's `_id` is the
 * Stripe customer id, so upserts are deterministic.
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
      name: "stripeSubscriptionId",
      title: "Stripe subscription id",
      type: "string",
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "subscriptionStatus",
      title: "Subscription status",
      type: "string",
      options: {
        list: [
          { title: "Active", value: "active" },
          { title: "Trialing", value: "trialing" },
          { title: "Past due", value: "past_due" },
          { title: "Unpaid", value: "unpaid" },
          { title: "Canceled", value: "canceled" },
          { title: "Incomplete", value: "incomplete" },
          { title: "Incomplete expired", value: "incomplete_expired" },
          { title: "Paused", value: "paused" },
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "priceId",
      title: "Stripe price id",
      type: "string",
      readOnly: true,
    }),
    defineField({
      name: "founding",
      title: "Founding member (bonus loaf in first delivery)",
      type: "boolean",
      readOnly: true,
    }),
    defineField({
      name: "joinedAt",
      title: "Joined at",
      type: "datetime",
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "lastSyncedAt",
      title: "Last synced from Stripe",
      type: "datetime",
      readOnly: true,
    }),
    defineField({
      name: "canceledAt",
      title: "Canceled at",
      type: "datetime",
      readOnly: true,
    }),
  ],
  preview: {
    select: { email: "customerEmail", status: "subscriptionStatus", founding: "founding" },
    prepare: ({ email, status, founding }) => ({
      title: founding ? `★ FOUNDING — ${email}` : email,
      subtitle: founding ? `${status} · add bonus loaf to first delivery` : status,
    }),
  },
});
