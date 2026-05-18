import { defineArrayMember, defineField, defineType } from "sanity";

/**
 * A paid one-off public order, written best-effort + idempotently by the
 * Stripe webhook (`createIfNotExists`, `_id = order.<stripeSessionId>`).
 * Bread Club subscription checkouts are NOT orders (webhook gates on
 * `mode === "payment"`).
 */
export const orderType = defineType({
  name: "order",
  title: "Order",
  type: "document",
  fields: [
    defineField({ name: "stripeSessionId", title: "Stripe session id", type: "string", readOnly: true, validation: (r) => r.required() }),
    defineField({ name: "customerEmail", title: "Customer email", type: "string", validation: (r) => r.required().email() }),
    defineField({ name: "customerName", title: "Customer name", type: "string" }),
    defineField({ name: "customerPhone", title: "Customer phone", type: "string" }),
    defineField({ name: "drop", title: "Drop", type: "reference", to: [{ type: "drop" }] }),
    defineField({
      name: "items",
      title: "Items",
      type: "array",
      validation: (rule) => rule.required().min(1),
      of: [
        defineArrayMember({
          type: "object",
          name: "orderItem",
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
    defineField({ name: "subtotalCents", title: "Subtotal (cents)", type: "number", validation: (r) => r.required().integer().min(0) }),
    defineField({ name: "shippingCents", title: "Shipping (cents)", type: "number", validation: (r) => r.required().integer().min(0) }),
    defineField({ name: "totalCents", title: "Total (cents)", type: "number", validation: (r) => r.required().integer().min(0) }),
    defineField({
      name: "fulfillment",
      title: "Fulfillment",
      type: "string",
      options: { list: [ { title: "Pickup", value: "pickup" }, { title: "Ship", value: "ship" } ], layout: "radio" },
      validation: (rule) => rule.required(),
    }),
    defineField({ name: "shipState", title: "Ship/billing state", type: "string" }),
    defineField({
      name: "shipAddress",
      title: "Ship address",
      type: "object",
      fields: [
        defineField({ name: "line1", title: "Line 1", type: "string" }),
        defineField({ name: "line2", title: "Line 2", type: "string" }),
        defineField({ name: "city", title: "City", type: "string" }),
        defineField({ name: "state", title: "State", type: "string" }),
        defineField({ name: "postalCode", title: "Postal code", type: "string" }),
      ],
    }),
    defineField({ name: "livemode", title: "Live mode", type: "boolean", validation: (r) => r.required() }),
    defineField({ name: "createdAt", title: "Created at", type: "datetime", readOnly: true, validation: (r) => r.required() }),
    defineField({
      name: "fulfillmentStatus",
      title: "Fulfillment status",
      type: "string",
      options: {
        list: [
          { title: "New", value: "new" },
          { title: "Baking", value: "baking" },
          { title: "Ready", value: "ready" },
          { title: "Sent", value: "sent" },
        ],
        layout: "radio",
      },
      initialValue: "new",
    }),
  ],
  preview: {
    select: { name: "customerName", email: "customerEmail", total: "totalCents", fulfillment: "fulfillment" },
    prepare: ({ name, email, total, fulfillment }) => ({
      title: (name as string) ?? (email as string) ?? "(order)",
      subtitle: `${typeof total === "number" ? `$${(total / 100).toFixed(2)}` : ""} · ${fulfillment ?? ""}`,
    }),
  },
});
