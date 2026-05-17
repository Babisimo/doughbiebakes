import { defineField, defineType } from "sanity";

/**
 * One Bread Club member's choice of loaf for a single drop. Written by the
 * /api/club/select route after verifying the signed magic-link token. The
 * presence of a doc for (drop, email) means "this member has claimed a loaf
 * out of this drop" — its productSlug is which flavor they took.
 */
export const memberSelectionType = defineType({
  name: "memberSelection",
  title: "Member selection",
  type: "document",
  fields: [
    defineField({
      name: "drop",
      title: "Drop",
      type: "reference",
      to: [{ type: "drop" }],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "customerEmail",
      title: "Member email",
      type: "string",
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: "productSlug",
      title: "Chosen loaf (slug)",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "fulfillment",
      title: "Pickup or ship",
      type: "string",
      options: {
        list: [
          { title: "Local pickup (Corona)", value: "pickup" },
          { title: "Ship to my Stripe address", value: "ship" },
        ],
        layout: "radio",
      },
      initialValue: "pickup",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "shipInvoiceItemId",
      title: "Stripe shipping invoice item id",
      type: "string",
      readOnly: true,
      description:
        "Set when this member chose 'ship': the pending Stripe invoice item that bills the shipping surcharge on their next subscription invoice. Cleared when they switch back to pickup.",
    }),
    defineField({
      name: "selectedAt",
      title: "Selected at",
      type: "datetime",
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { email: "customerEmail", slug: "productSlug", at: "selectedAt" },
    prepare: ({ email, slug, at }) => ({
      title: `${email} → ${slug}`,
      subtitle: at ? new Date(at).toLocaleString() : "",
    }),
  },
});
