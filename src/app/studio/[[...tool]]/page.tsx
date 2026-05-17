"use client";

import dynamic from "next/dynamic";

/**
 * Sanity Studio mounted at /studio. The Studio is loaded client-side only
 * (`ssr: false`) — it routes itself below /studio, hence the catch-all segment.
 * See https://www.sanity.io/docs/embedding-sanity-studio-in-nextjs
 */
const Studio = dynamic(() => import("./Studio"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      Loading Studio…
    </div>
  ),
});

export default function StudioPage() {
  return <Studio />;
}
