/** Absolute base URL of the site (used for Stripe redirects, metadata, etc.). */
export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}
