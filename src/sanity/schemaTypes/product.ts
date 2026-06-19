import { defineArrayMember, defineField, defineType } from "sanity";

/**
 * A bakeable item — a sourdough loaf, the starter, or merch.
 *
 * `ingredients` and `allergens` are surfaced on the storefront so the
 * California Cottage Food labeling requirements are easy to honor.
 */
export const productType = defineType({
  name: "product",
  title: "Product",
  type: "document",
  groups: [
    { name: "details", title: "Details", default: true },
    { name: "label", title: "Cottage Food Label" },
    { name: "media", title: "Media" },
  ],
  fields: [
    defineField({
      name: "name",
      title: "Name",
      type: "string",
      group: "details",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      group: "details",
      options: { source: "name", maxLength: 96 },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "tagline",
      title: "Tagline",
      type: "string",
      group: "details",
      description: "Short one-liner shown on cards.",
    }),
    defineField({
      name: "description",
      title: "Description",
      type: "text",
      rows: 4,
      group: "details",
    }),
    defineField({
      name: "priceCents",
      title: "Price (in cents)",
      type: "number",
      group: "details",
      description: "e.g. 1200 for $12.00",
      validation: (rule) => rule.required().integer().min(0),
    }),
    defineField({
      name: "defaultCostCents",
      title: "Cost to make (in cents)",
      type: "number",
      group: "details",
      description:
        "Your variable cost to produce one — ingredients, packaging, etc. e.g. 150 for $1.50. Pre-fills the ROI calculator; safe to leave blank.",
      validation: (rule) => rule.integer().min(0),
    }),
    defineField({
      name: "category",
      title: "Category",
      type: "reference",
      to: [{ type: "category" }],
      group: "details",
    }),
    defineField({
      name: "recipe",
      title: "Recipe (auto-costing)",
      type: "array",
      group: "details",
      description:
        "Optional. List the pantry ingredients and how much each loaf uses. When set, the ROI calculator costs this loaf automatically and ignores the flat cost above.",
      of: [
        defineArrayMember({
          type: "object",
          name: "recipeLine",
          fields: [
            defineField({
              name: "ingredient",
              title: "Ingredient",
              type: "reference",
              to: [{ type: "ingredient" }],
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "qtyPerLoaf",
              title: "Amount used per loaf",
              type: "number",
              description:
                "In the ingredient's unit (e.g. 550 grams of flour, 1 jalapeño).",
              validation: (rule) => rule.required().positive(),
            }),
          ],
          preview: {
            select: {
              name: "ingredient.name",
              unit: "ingredient.unit",
              qty: "qtyPerLoaf",
            },
            prepare: ({ name, unit, qty }) => ({
              title: name ?? "(pick ingredient)",
              subtitle: `${qty ?? 0}${unit ? ` ${unit}` : ""} / loaf`,
            }),
          },
        }),
      ],
    }),
    defineField({
      name: "available",
      title: "Available for ordering",
      type: "boolean",
      initialValue: true,
      group: "details",
    }),
    defineField({
      name: "image",
      title: "Photo",
      type: "image",
      options: { hotspot: true },
      group: "media",
    }),
    defineField({
      name: "ingredients",
      title: "Ingredients (in descending order by weight)",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      group: "label",
      description:
        "Required on the Cottage Food label. List sub-ingredients in parentheses.",
    }),
    defineField({
      name: "allergens",
      title: "Allergens",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      options: {
        list: [
          "Wheat",
          "Milk",
          "Eggs",
          "Soy",
          "Tree nuts",
          "Peanuts",
          "Sesame",
        ],
      },
      group: "label",
    }),
  ],
  preview: {
    select: { title: "name", subtitle: "tagline", media: "image" },
  },
});
