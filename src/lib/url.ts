/**
 * Absolute base URL of the site (used for Stripe redirects, verify-link emails,
 * metadata, etc.). All callers are server-side.
 *
 * Prefer `SITE_URL` — a plain runtime var (set in wrangler.jsonc `vars`) that is
 * read in the Worker at request time. `NEXT_PUBLIC_SITE_URL` is only a fallback:
 * it's inlined at BUILD time, so a local `deploy:cf` build bakes in whatever
 * `.env.local` holds (localhost), which previously leaked into verify links.
 */
export function siteUrl(): string {
  return (
    process.env.SITE_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}
