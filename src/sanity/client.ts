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
      useCdn: true,
    })
  : null;
