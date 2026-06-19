/**
 * Pure profitability / ROI math for one drop. No I/O — all inputs are plain
 * numbers so this is trivially testable and reusable on both server and client.
 *
 * Everything is integer cents in, ratios out. The caller (the admin calculator)
 * supplies the editable per-loaf lines and fixed costs; revenue is modeled from
 * the *effective* sale price the baker actually charges, which is what lets the
 * "favors / discounts" case work: drop the sale price below the list price and
 * the favor shows up automatically.
 */

export type LoafLine = {
  slug: string;
  name: string;
  /** Units sold (or planned) for this drop. */
  units: number;
  /** Menu price, in cents — what it normally sells for. */
  listPriceCents: number;
  /** Effective price actually charged, in cents. Lower than list = a favor. */
  salePriceCents: number;
  /** Variable cost to produce one, in cents. */
  unitCostCents: number;
};

export type FixedCost = {
  name: string;
  cents: number;
};

/**
 * One ingredient in a loaf's cost build-up. You enter what a whole package
 * cost and how much of it goes into a loaf — in whatever unit you like (grams,
 * ounces, "each", "package"), as long as packageQty and usedQty share it.
 * Cost = packagePrice × (usedQty / packageQty).
 */
export type CostComponent = {
  name: string;
  /** What you paid for the whole package, in cents. */
  packagePriceCents: number;
  /** How much the package holds (grams, count, etc.). */
  packageQty: number;
  /** How much of it one loaf uses, in the same unit. */
  usedQty: number;
  /** Optional unit label, purely cosmetic (e.g. "g", "oz", "each"). */
  unit?: string;
};

/** Per-loaf cost of one ingredient, in cents. 0 when any input is missing. */
export function componentCostCents(c: CostComponent): number {
  const price = Number.isFinite(c.packagePriceCents) ? c.packagePriceCents : 0;
  const pkg = Number.isFinite(c.packageQty) ? c.packageQty : 0;
  const used = Number.isFinite(c.usedQty) ? c.usedQty : 0;
  if (price <= 0 || pkg <= 0 || used <= 0) return 0;
  return Math.round((price * used) / pkg);
}

/** Total per-loaf cost from a list of ingredients, in cents. */
export function componentsCostCents(components: CostComponent[]): number {
  return components.reduce((sum, c) => sum + componentCostCents(c), 0);
}

/** A pantry ingredient's bulk pricing (subset of the Sanity `ingredient`). */
export type PricedIngredient = {
  packagePriceCents: number;
  packageQty: number;
};

/** One recipe line: how much of an ingredient a loaf uses. */
export type RecipeCostLine = {
  qtyPerLoaf: number;
  ingredient?: PricedIngredient | null;
};

/** Per-loaf cost computed from a recipe + pantry prices, in cents. */
export function recipeCostCents(recipe: RecipeCostLine[]): number {
  return recipe.reduce((sum, line) => {
    if (!line.ingredient) return sum;
    return (
      sum +
      componentCostCents({
        name: "",
        packagePriceCents: line.ingredient.packagePriceCents,
        packageQty: line.ingredient.packageQty,
        usedQty: line.qtyPerLoaf,
      })
    );
  }, 0);
}

/**
 * Hybrid per-loaf cost: use the recipe (auto-costed from the pantry) when it
 * has any priced lines, otherwise fall back to the flat `defaultCostCents`.
 */
export function productCostCents(product: {
  defaultCostCents?: number;
  recipe?: RecipeCostLine[] | null;
}): number {
  const recipe = product.recipe ?? [];
  const hasPricedRecipe = recipe.some((l) => l.ingredient != null);
  if (hasPricedRecipe) return recipeCostCents(recipe);
  return Number.isFinite(product.defaultCostCents)
    ? (product.defaultCostCents as number)
    : 0;
}

export type ProfitabilityInput = {
  lines: LoafLine[];
  fixedCosts: FixedCost[];
};

export type ProfitabilityResult = {
  unitsTotal: number;
  /** Modeled revenue at the effective sale prices. */
  revenueCents: number;
  /** What the same loaves would bring at full menu price. */
  listValueCents: number;
  /** Money given away as favors/discounts (listValue − revenue). Can be
   * negative if a loaf was charged *above* list. */
  favorsCents: number;
  variableCostCents: number;
  fixedCostCents: number;
  totalCostCents: number;
  netProfitCents: number;
  /** (revenue − variableCost) / revenue. null when revenue ≤ 0. */
  grossMarginRatio: number | null;
  /** netProfit / totalCost. null when there's no cost basis. */
  roiRatio: number | null;
  /** Contribution-margin ratio for the drop's mix. null when revenue ≤ 0. */
  contributionMarginRatio: number | null;
  /** Revenue needed to cover fixed costs, in cents. null when the mix can't
   * cover fixed costs (contribution margin ≤ 0). */
  breakEvenRevenueCents: number | null;
};

const intUnits = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const intCents = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);

export function computeProfitability(
  input: ProfitabilityInput,
): ProfitabilityResult {
  let unitsTotal = 0;
  let revenueCents = 0;
  let listValueCents = 0;
  let variableCostCents = 0;

  for (const line of input.lines) {
    const units = intUnits(line.units);
    if (units === 0) continue;
    unitsTotal += units;
    revenueCents += units * intCents(line.salePriceCents);
    listValueCents += units * intCents(line.listPriceCents);
    variableCostCents += units * intCents(line.unitCostCents);
  }

  const fixedCostCents = input.fixedCosts.reduce(
    (sum, f) => sum + intCents(f.cents),
    0,
  );
  const totalCostCents = variableCostCents + fixedCostCents;
  const netProfitCents = revenueCents - totalCostCents;
  const favorsCents = listValueCents - revenueCents;

  const contributionMarginRatio =
    revenueCents > 0 ? (revenueCents - variableCostCents) / revenueCents : null;
  const grossMarginRatio = contributionMarginRatio;
  const roiRatio = totalCostCents > 0 ? netProfitCents / totalCostCents : null;
  const breakEvenRevenueCents =
    contributionMarginRatio && contributionMarginRatio > 0
      ? Math.round(fixedCostCents / contributionMarginRatio)
      : null;

  return {
    unitsTotal,
    revenueCents,
    listValueCents,
    favorsCents,
    variableCostCents,
    fixedCostCents,
    totalCostCents,
    netProfitCents,
    grossMarginRatio,
    roiRatio,
    contributionMarginRatio,
    breakEvenRevenueCents,
  };
}
