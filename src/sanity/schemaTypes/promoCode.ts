import { defineField, defineType } from "sanity";

/**
 * A single-source-of-truth discount code. `redeemedCount` is the shared
 * cross-path counter; only the concurrency-safe `redeemPromo` mutation writes
 * it. Owner-managed in the Studio.
 */
export const promoCodeType = defineType({
  name: "promoCode",
  title: "Promo code",
  type: "document",
  fields: [
    defineField({
      name: "code",
      title: "Code",
      type: "string",
      description: "Case-insensitive (matched uppercased). Keep exactly ONE promo-code document per code value — duplicates are not auto-prevented.",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "percentOff",
      title: "Percent off",
      description: "Whole number percent, e.g. 15 for 15% off.",
      type: "number",
      validation: (r) => r.required().min(1).max(100),
    }),
    defineField({
      name: "maxRedemptions",
      title: "Max redemptions",
      description: "Total redemptions allowed across BOTH reservations and online orders.",
      type: "number",
      validation: (r) => r.required().integer().min(1),
    }),
    defineField({
      name: "redeemedCount",
      title: "Redeemed count",
      type: "number",
      initialValue: 0,
      readOnly: true,
      validation: (r) => r.required().integer().min(0),
    }),
    defineField({
      name: "active",
      title: "Active",
      type: "boolean",
      initialValue: true,
    }),
    defineField({ name: "label", title: "Label (admin note)", type: "string" }),
  ],
  preview: {
    select: {
      code: "code",
      pct: "percentOff",
      used: "redeemedCount",
      max: "maxRedemptions",
      active: "active",
    },
    prepare: ({ code, pct, used, max, active }) => ({
      title: `${code ?? "(code)"} — ${pct ?? 0}% off`,
      subtitle: `${used ?? 0}/${max ?? 0} used${active === false ? " · INACTIVE" : ""}`,
    }),
  },
});
