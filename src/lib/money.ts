const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Format an integer number of cents as USD, e.g. 1200 -> "$12.00". */
export function formatPrice(cents: number): string {
  return usd.format(cents / 100);
}
