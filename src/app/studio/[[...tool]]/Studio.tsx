"use client";

import { NextStudio } from "next-sanity/studio";

import config from "../../../../sanity.config";
import { sanityConfigured } from "@/sanity/env";

/**
 * The actual Studio component. Imported only on the client (via `next/dynamic`
 * in page.tsx) so the Sanity bundle never runs in the Node server build.
 *
 * If no Sanity project id is configured, mounting <NextStudio> throws
 * ("Configuration must contain `projectId`"), so we show a guide instead.
 */
export default function Studio() {
  if (!sanityConfigured) {
    return (
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "48px 24px",
          fontFamily: "system-ui, sans-serif",
          lineHeight: 1.6,
          color: "#283618",
        }}
      >
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>
          Sanity Studio isn&apos;t configured
        </h1>
        <p>
          The storefront is currently running on the bundled <strong>demo
          menu</strong> because <code>NEXT_PUBLIC_SANITY_PROJECT_ID</code> is
          unset — it was commented out in <code>.env.local</code> so the local
          checkout demo would work (the live Sanity content has every product
          marked &ldquo;Available for ordering&rdquo; off).
        </p>
        <p style={{ marginTop: 16 }}>
          To use the Studio with your project (<code>91s54g5t</code>):
        </p>
        <ol style={{ marginTop: 8, paddingLeft: 20 }}>
          <li>
            Uncomment the three <code>NEXT_PUBLIC_SANITY_*</code> lines in{" "}
            <code>.env.local</code>.
          </li>
          <li>
            Add <code>http://localhost:3000</code> as a CORS origin (with
            credentials) at{" "}
            <a
              href="https://www.sanity.io/manage/project/91s54g5t/api"
              style={{ color: "#8a4d18" }}
            >
              manage.sanity.io → API → CORS origins
            </a>
            .
          </li>
          <li>
            Restart <code>npm run dev</code>, reload this page, sign in, and
            flip each product&apos;s &ldquo;Available for ordering&rdquo; toggle
            on (then Publish).
          </li>
        </ol>
        <p style={{ marginTop: 16, fontSize: 14, color: "#6c7150" }}>
          (Switching back to live content disables the demo menu — see{" "}
          <code>SOURDOUGH_BUSINESS_LOG.md</code> and <code>docs/SANITY.md</code>
          .)
        </p>
      </div>
    );
  }
  return <NextStudio config={config} />;
}
