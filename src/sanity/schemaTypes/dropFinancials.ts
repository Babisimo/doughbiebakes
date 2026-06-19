import { defineArrayMember, defineField, defineType } from "sanity";

/**
 * A saved financial snapshot for one drop, written from the ROI calculator's
 * "Save to history" button. One per drop (deterministic _id), so re-saving
 * overwrites. The weekly/monthly dashboard rolls these up. Numbers are frozen
 * at save time on purpose — a month's report shouldn't change later when an
 * ingredient price does.
 */
export const dropFinancialsType = defineType({
  name: "dropFinancials",
  title: "Drop financials",
  type: "document",
  fields: [
    defineField({
      name: "drop",
      title: "Drop",
      type: "reference",
      to: [{ type: "drop" }],
      description: "Empty for manual/pre-website entries.",
    }),
    defineField({
      name: "source",
      title: "Source",
      type: "string",
      options: {
        list: [
          { title: "Website drop", value: "drop" },
          { title: "Manual / pre-website", value: "manual" },
        ],
      },
      initialValue: "drop",
    }),
    defineField({ name: "dropTitle", title: "Title", type: "string" }),
    defineField({
      name: "periodDate",
      title: "Period date",
      type: "datetime",
      description: "Used to bucket the drop into a week/month on the dashboard.",
    }),
    defineField({ name: "revenueCents", title: "Revenue (cents)", type: "number" }),
    defineField({ name: "listValueCents", title: "List value (cents)", type: "number" }),
    defineField({ name: "favorsCents", title: "Favors/discounts (cents)", type: "number" }),
    defineField({ name: "variableCostCents", title: "Variable cost (cents)", type: "number" }),
    defineField({ name: "fixedCostCents", title: "Fixed cost (cents)", type: "number" }),
    defineField({ name: "netProfitCents", title: "Net profit (cents)", type: "number" }),
    defineField({ name: "unitsTotal", title: "Units", type: "number" }),
    defineField({
      name: "actualCollectedCents",
      title: "Actually collected (cents)",
      type: "number",
    }),
    defineField({
      name: "fixedCosts",
      title: "Fixed cost breakdown",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "fixedCostLine",
          fields: [
            defineField({ name: "name", type: "string" }),
            defineField({ name: "cents", type: "number" }),
          ],
        }),
      ],
    }),
    defineField({ name: "savedAt", title: "Saved at", type: "datetime" }),
  ],
  preview: {
    select: { title: "dropTitle", profit: "netProfitCents", date: "periodDate" },
    prepare: ({ title, profit, date }) => ({
      title: title ?? "Drop financials",
      subtitle: [
        profit != null ? `${profit >= 0 ? "+" : ""}$${(profit / 100).toFixed(2)}` : null,
        date ? new Date(date).toLocaleDateString() : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }),
  },
});
