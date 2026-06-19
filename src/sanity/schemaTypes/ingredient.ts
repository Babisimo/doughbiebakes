import { defineField, defineType } from "sanity";

/**
 * A pantry item with what you actually pay for it in bulk. Loaves reference
 * these in their `recipe`, so the per-loaf cost is computed from real prices
 * and you only update a price in one place when it changes.
 *
 * Cost of an ingredient in a loaf = packagePriceCents × (qtyPerLoaf / packageQty),
 * where qtyPerLoaf (on the recipe line) and packageQty share the same unit.
 */
export const ingredientType = defineType({
  name: "ingredient",
  title: "Ingredient (pantry)",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "Name",
      type: "string",
      description: 'e.g. "Kirkland Organic AP Flour"',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "packagePriceCents",
      title: "Package price (in cents)",
      type: "number",
      description: "What you pay for the whole package. e.g. 1999 for $19.99.",
      validation: (rule) => rule.required().integer().min(0),
    }),
    defineField({
      name: "packageQty",
      title: "Package size",
      type: "number",
      description:
        "How much the package holds, in the unit below. e.g. 9072 (for 20 lb in grams), or 10 (jalapeños).",
      validation: (rule) => rule.required().positive(),
    }),
    defineField({
      name: "unit",
      title: "Unit",
      type: "string",
      description: 'The unit for the size above and recipe amounts — e.g. "g", "oz", "each".',
      initialValue: "g",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "note",
      title: "Note",
      type: "string",
      description: "Optional — where you buy it, brand, etc.",
    }),
  ],
  preview: {
    select: { name: "name", price: "packagePriceCents", qty: "packageQty", unit: "unit" },
    prepare: ({ name, price, qty, unit }) => ({
      title: name,
      subtitle:
        price != null && qty != null
          ? `$${(price / 100).toFixed(2)} / ${qty}${unit ? ` ${unit}` : ""}`
          : "Set price & size",
    }),
  },
});
