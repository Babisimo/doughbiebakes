import { defineArrayMember, defineField, defineType } from "sanity";

/**
 * A "drop" — a scheduled batch of loaves with limited inventory. The home page
 * shows the drop whose `status` is `open`; closing happens manually or when the
 * Stripe webhook decrements the last unit (see `src/app/api/webhooks/stripe`).
 */
export const dropType = defineType({
  name: "drop",
  title: "Drop",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      description: 'e.g. "Mother\'s Day Weekend Drop"',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      options: { source: "title" },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Draft", value: "draft" },
          { title: "Announced (coming soon)", value: "announced" },
          { title: "Open for orders", value: "open" },
          { title: "Sold out", value: "soldout" },
          { title: "Closed / fulfilled", value: "closed" },
        ],
        layout: "radio",
      },
      initialValue: "draft",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "ordersOpenAt",
      title: "Orders open at",
      type: "datetime",
    }),
    defineField({
      name: "ordersCloseAt",
      title: "Orders close at",
      type: "datetime",
    }),
    defineField({
      name: "pickupOrShipDate",
      title: "Pickup / ship date",
      type: "datetime",
    }),
    defineField({
      name: "note",
      title: "Note to customers",
      type: "text",
      rows: 2,
    }),
    defineField({
      name: "lineItems",
      title: "Loaves in this drop",
      type: "array",
      validation: (rule) => rule.required().min(1),
      of: [
        defineArrayMember({
          type: "object",
          name: "dropLineItem",
          fields: [
            defineField({
              name: "product",
              title: "Product",
              type: "reference",
              to: [{ type: "product" }],
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "quantity",
              title: "Loaves available",
              type: "number",
              initialValue: 4,
              validation: (rule) => rule.required().integer().min(0),
            }),
          ],
          preview: {
            select: { title: "product.name", quantity: "quantity" },
            prepare: ({ title, quantity }) => ({
              title: title ?? "(no product)",
              subtitle: `${quantity ?? 0} available`,
            }),
          },
        }),
      ],
    }),
  ],
  preview: {
    select: { title: "title", status: "status", date: "pickupOrShipDate" },
    prepare: ({ title, status, date }) => ({
      title,
      subtitle: [status, date && new Date(date).toLocaleDateString()]
        .filter(Boolean)
        .join(" · "),
    }),
  },
});
