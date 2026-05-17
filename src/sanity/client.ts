import { createClient, type SanityClient } from "next-sanity";

import { apiVersion, dataset, projectId, sanityConfigured } from "./env";

/**
 * Read-only Sanity client. `null` until a project id is configured so callers
 * can fall back to seed data instead of crashing.
 */
export const sanityClient: SanityClient | null = sanityConfigured
  ? createClient({
      projectId,
      dataset,
      apiVersion,
      // Live reads: the CDN is eventually-consistent and would keep serving
      // stale inventory for a while after an order. Cottage-Food traffic is
      // tiny, so we read straight from the Content Lake instead.
      useCdn: false,
    })
  : null;
