/**
 * Sanity environment configuration.
 *
 * The app is designed to run before Sanity is connected: when
 * `NEXT_PUBLIC_SANITY_PROJECT_ID` is missing the storefront falls back to the
 * bundled seed menu (see `src/lib/seed-products.ts`) so you can develop and
 * demo without a CMS. Fill these in (and restart) to switch to live content.
 */

export const apiVersion =
  process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2025-01-01";

export const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";

export const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "";

/** True once a Sanity project id has been configured via env. */
export const sanityConfigured = projectId.length > 0;

/** Write token used by the Stripe webhook to decrement drop inventory. */
export const writeToken = process.env.SANITY_API_WRITE_TOKEN || "";
