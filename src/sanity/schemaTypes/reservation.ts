import { defineArrayMember, defineField, defineType } from "sanity";

/**
 * An unpaid "reserve & pay at pickup" request. Created by POST /api/reserve
 * in `pending`; the baker approves/declines (which decrements stock + emails
 * the customer). Stripe is bypassed entirely for these.
 */
export const reservationType = defineType({
  name: "reservation",
  title: "Reservation",
  type: "document",
  fields: [
    defineField({
      name: "customerName",
      title: "Customer name",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "customerEmail",
      title: "Customer email",
      type: "string",
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: "customerPhone",
      title: "Customer phone",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "drop",
      title: "Drop",
      type: "reference",
      to: [{ type: "drop" }],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "items",
      title: "Items",
      type: "array",
      validation: (rule) => rule.required().min(1),
      of: [
        defineArrayMember({
          type: "object",
          name: "reservationItem",
          fields: [
            defineField({ name: "productSlug", title: "Product slug", type: "string", validation: (r) => r.required() }),
            defineField({ name: "productName", title: "Product name", type: "string", validation: (r) => r.required() }),
            defineField({ name: "quantity", title: "Quantity", type: "number", validation: (r) => r.required().integer().min(1) }),
            defineField({ name: "priceCents", title: "Unit price (cents)", type: "number", validation: (r) => r.required().integer().min(0) }),
          ],
          preview: {
            select: { title: "productName", quantity: "quantity" },
            prepare: ({ title, quantity }) => ({ title: title ?? "(item)", subtitle: `${quantity ?? 0}×` }),
          },
        }),
      ],
    }),
    defineField({ name: "totalCents", title: "Total due at pickup (cents)", type: "number", validation: (r) => r.required().integer().min(0) }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Pending", value: "pending" },
          { title: "Confirmed", value: "confirmed" },
          { title: "Declined", value: "declined" },
        ],
        layout: "radio",
      },
      initialValue: "pending",
      validation: (rule) => rule.required(),
    }),
    defineField({ name: "createdAt", title: "Created at", type: "datetime", readOnly: true, validation: (r) => r.required() }),
    defineField({ name: "decidedAt", title: "Decided at", type: "datetime", readOnly: true }),
  ],
  preview: {
    select: { name: "customerName", status: "status", total: "totalCents" },
    prepare: ({ name, status, total }) => ({
      title: `${name ?? "(customer)"} — ${status ?? "pending"}`,
      subtitle: typeof total === "number" ? `$${(total / 100).toFixed(2)}` : undefined,
    }),
  },
});
