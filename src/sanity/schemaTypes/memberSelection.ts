import { defineField, defineType } from "sanity";

/**
 * One Bread Club member's choice for a single drop. Written by the
 * /api/club/select route after verifying the signed magic-link token. A doc
 * for (drop, email) is either a loaf pick (`productSlug` + `fulfillment`) or a
 * skip (`skipped: true`, no loaf). A skipped member takes no loaf and is not
 * charged for the drop.
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
      name: "skipped",
      title: "Skipped this drop",
      type: "boolean",
      description: "True when the member opted out of this drop — no loaf, no charge.",
    }),
    defineField({
      name: "selectedAt",
      title: "Selected at",
      type: "datetime",
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { email: "customerEmail", slug: "productSlug", skipped: "skipped", at: "selectedAt" },
    prepare: ({ email, slug, skipped, at }) => ({
      title: skipped ? `${email} → (skipped)` : `${email} → ${slug ?? "(default)"}`,
      subtitle: at ? new Date(at).toLocaleString() : "",
    }),
  },
});
