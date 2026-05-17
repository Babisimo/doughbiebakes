// scripts/club-link.mjs
// Generates one signed Bread Club magic link for a single email. Useful for
// testing the /club flow with a specific recipient (especially the one
// registered to your Resend account in dev) without going through Stripe.
//
// Usage:
//   npm run club:link -- <email>                  # auto-detects the announced drop
//   npm run club:link -- <email> <DROP_ID>        # explicit drop id

import { createHmac } from "node:crypto";

import { createClient as createSanityClient } from "next-sanity";

const email = process.argv[2];
let dropId = process.argv[3];

const secret = process.env.CLUB_LINK_SECRET;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const sanityProjectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const sanityDataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
const sanityApiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION ?? "2025-01-01";

if (!email || !email.includes("@")) {
  console.error("Usage: npm run club:link -- <email> [DROP_ID]");
  process.exit(1);
}
if (!secret) {
  console.error("Missing CLUB_LINK_SECRET in .env.local");
  process.exit(1);
}

if (!dropId) {
  if (!sanityProjectId) {
    console.error(
      "DROP_ID required (no Sanity configured to auto-detect the announced drop)",
    );
    process.exit(1);
  }
  const sanity = createSanityClient({
    projectId: sanityProjectId,
    dataset: sanityDataset,
    apiVersion: sanityApiVersion,
    useCdn: false,
  });
  const announced = await sanity.fetch(
    `*[_type == "drop" && status == "announced"] | order(_createdAt desc) { _id, title }`,
  );
  if (!announced || announced.length === 0) {
    console.error(
      "No drops in 'announced' status. Set a drop's status to 'Announced (coming soon)' in Sanity Studio first.",
    );
    process.exit(1);
  }
  if (announced.length > 1) {
    console.error("Multiple announced drops — pass one of these as the second argument:");
    for (const d of announced) {
      console.error(`  ${d._id}\t${d.title}`);
    }
    process.exit(1);
  }
  dropId = announced[0]._id;
  console.error(`Using announced drop: "${announced[0].title}" (${dropId})`);
}

const token = createHmac("sha256", secret)
  .update(`${email.toLowerCase()}|${dropId}`)
  .digest("hex");
const url = `${siteUrl}/club/${dropId}?email=${encodeURIComponent(email)}&token=${token}`;
console.log(url);
