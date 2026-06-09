"use client";

import { useLinkStatus } from "next/link";

/**
 * Inline pending hint for a header nav <Link>. Reserves a fixed-size slot (so
 * there's no layout shift) and fades in a small spinning terracotta ring only
 * while that link is navigating. A 100ms opacity delay means fast or already
 * prefetched navigations never flash it. Respects reduced motion.
 *
 * Must be rendered as a descendant of a <Link> — `useLinkStatus` reads the
 * nearest Link's navigation state.
 */
export function NavLinkPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`ml-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-acid/30 border-t-acid align-middle transition-opacity delay-100 motion-reduce:animate-none ${
        pending ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
