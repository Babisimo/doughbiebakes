import {
  createImageUrlBuilder,
  type SanityImageSource,
} from "@sanity/image-url";

import { dataset, projectId, sanityConfigured } from "./env";

const builder = sanityConfigured
  ? createImageUrlBuilder({ projectId, dataset })
  : null;

/**
 * Resolve a Sanity image reference to a CDN URL, or `null` when Sanity is not
 * configured (in which case the caller should use a seed image path instead).
 */
export function urlForImage(source: SanityImageSource | undefined | null) {
  if (!builder || !source) return null;
  return builder.image(source).auto("format").fit("max");
}
