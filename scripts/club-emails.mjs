// scripts/club-emails.mjs
// Lists every active Bread Club member, generates a signed magic link for
// each against the announced drop, and either prints them (dry-run, default)
// or sends each one through Resend (--send).
//
// Usage:
//   npm run club:emails                        # auto-detects drop, prints URLs
//   npm run club:emails -- <DROP_ID>           # explicit drop id, prints URLs
//   npm run club:emails -- --send              # auto-detects drop, mails URLs
//   npm run club:emails -- <DROP_ID> --send    # explicit drop id, mails URLs

import { createHmac } from "node:crypto";

import { createClient as createSanityClient } from "next-sanity";

const secret = process.env.CLUB_LINK_SECRET;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const sanityProjectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const sanityDataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
const sanityApiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION ?? "2025-01-01";
const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.FROM_EMAIL || "Doughbie <onboarding@resend.dev>";
const bakeryName = "Doughbie";

if (!secret) {
  console.error("Missing CLUB_LINK_SECRET in .env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const sendMode = args.includes("--send");
const positional = args.filter((a) => !a.startsWith("--"));

if (sendMode && !resendApiKey) {
  console.error(
    "--send needs RESEND_API_KEY in .env.local. Drop --send to dry-run (print URLs only).",
  );
  process.exit(1);
}

const sanity = sanityProjectId
  ? createSanityClient({
      projectId: sanityProjectId,
      dataset: sanityDataset,
      apiVersion: sanityApiVersion,
      useCdn: false,
    })
  : null;

let dropId = positional[0];
let dropTitle = "the next drop";
let dropPickupOrShipDate = null;

if (!dropId) {
  if (!sanity) {
    console.error(
      "Usage: npm run club:emails -- <DROP_ID> [--send]\n" +
        "(or configure NEXT_PUBLIC_SANITY_PROJECT_ID in .env.local to auto-detect)",
    );
    process.exit(1);
  }
  const announced = await sanity.fetch(
    `*[_type == "drop" && status == "announced"] | order(_createdAt desc) { _id, title, pickupOrShipDate }`,
  );
  if (!announced || announced.length === 0) {
    console.error(
      "No drops in 'announced' status. Set a drop's status to 'Announced (coming soon)' in Sanity Studio first.",
    );
    process.exit(1);
  }
  if (announced.length > 1) {
    console.error("Multiple announced drops — pass one of these as the argument:");
    for (const d of announced) {
      console.error(`  ${d._id}\t${d.title}`);
    }
    process.exit(1);
  }
  dropId = announced[0]._id;
  dropTitle = announced[0].title ?? dropTitle;
  dropPickupOrShipDate = announced[0].pickupOrShipDate ?? null;
  console.error(`Using announced drop: "${dropTitle}" (${dropId})`);
} else if (sanity) {
  // Explicit drop id passed — still fetch metadata for the email body.
  const d = await sanity.fetch(
    `*[_type == "drop" && _id == $id][0]{ title, pickupOrShipDate }`,
    { id: dropId },
  );
  if (d) {
    dropTitle = d.title ?? dropTitle;
    dropPickupOrShipDate = d.pickupOrShipDate ?? null;
  }
}

function sign(email) {
  return createHmac("sha256", secret)
    .update(`${email.toLowerCase()}|${dropId}`)
    .digest("hex");
}

async function listActiveMemberEmails() {
  if (!sanity) {
    console.error(
      "Sanity is not configured — set NEXT_PUBLIC_SANITY_PROJECT_ID in .env.local. " +
        "Members live in Sanity now (no Stripe-subscription fallback).",
    );
    process.exit(1);
  }
  const rows = await sanity.fetch(
    `*[_type == "member" && status == "active"]{ customerEmail }`,
  );
  const emails = (rows ?? [])
    .map((m) => m.customerEmail)
    .filter((e) => typeof e === "string" && e.includes("@"));
  console.error(`Found ${emails.length} active member(s) in Sanity.`);
  return emails;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMagicLinkEmail({ dropTitle, dropPickupOrShipDate, magicUrl }) {
  const dateLabel = dropPickupOrShipDate
    ? new Date(dropPickupOrShipDate).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const subject = `Pick your loaf for ${dropTitle}`;
  const text = [
    `${bakeryName} · Bread Club`,
    "",
    `The next drop is open for member picks: ${dropTitle}${dateLabel ? ` (${dateLabel})` : ""}.`,
    "",
    `Open this private link to choose your flavor and pickup/ship preference:`,
    magicUrl,
    "",
    `The link works only for your email. Pick by the time the drop goes public — after that, it's locked in.`,
    "",
    `— ${bakeryName}`,
  ].join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#fbf7ef;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;color:#241804;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fbf7ef;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:#ffffff;border:2px solid #241804;border-radius:18px;box-shadow:6px 6px 0 0 #241804;">
            <tr>
              <td style="padding:28px 28px 8px;">
                <p style="margin:0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#7a6c4f;">${escapeHtml(bakeryName)} · Bread Club</p>
                <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;color:#241804;">Pick your loaf 🍞</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 20px;font-size:15px;line-height:1.55;color:#241804;">
                <p style="margin:0 0 16px;">
                  The next drop is open for member picks: <strong>${escapeHtml(dropTitle)}</strong>${dateLabel ? ` (<strong>${escapeHtml(dateLabel)}</strong>)` : ""}.
                </p>
                <p style="margin:14px 0 0;">
                  <a href="${escapeHtml(magicUrl)}" style="display:inline-block;padding:12px 22px;background:#a8d955;border:2px solid #241804;border-radius:9999px;color:#241804;font-weight:700;text-decoration:none;">
                    Pick my loaf →
                  </a>
                </p>
                <p style="margin:16px 0 0;font-size:13px;color:#5b4d2c;">
                  This link works only for your email. Pick by the time the drop goes public — after that, your selection is locked in for the bake.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 28px 24px;border-top:1px solid #f0e2bf;font-size:12px;color:#7a6c4f;">
                You're receiving this because you're an active ${escapeHtml(bakeryName)} Bread Club member.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject, html, text };
}

async function sendMagicLink(to, magicUrl) {
  const { subject, html, text } = buildMagicLinkEmail({
    dropTitle,
    dropPickupOrShipDate,
    magicUrl,
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({ from: fromEmail, to, subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

const emails = await listActiveMemberEmails();

if (emails.length === 0) {
  console.error("(no active Bread Club subscriptions found)");
  process.exit(0);
}

if (!sendMode) {
  // Dry-run: print TSV so the baker can paste into their email tool.
  for (const email of emails) {
    const token = sign(email);
    const url = `${siteUrl}/club/${dropId}?email=${encodeURIComponent(email)}&token=${token}`;
    console.log(`${email}\t${url}`);
  }
  console.error(
    `Printed ${emails.length} link(s). Re-run with --send to mail them via Resend instead.`,
  );
  process.exit(0);
}

// Send mode: mail each one through Resend.
let ok = 0;
let failed = 0;
for (const email of emails) {
  const token = sign(email);
  const url = `${siteUrl}/club/${dropId}?email=${encodeURIComponent(email)}&token=${token}`;
  try {
    await sendMagicLink(email, url);
    console.log(`[ok]   ${email}`);
    ok += 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[fail] ${email}\t${msg}`);
    failed += 1;
  }
}
console.error(`\nSent ${ok} of ${emails.length} email(s). ${failed} failed.`);
if (failed > 0) process.exit(1);
