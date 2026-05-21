import "server-only";

import { cancelMember } from "@/sanity/lib/mutations";
import { verifyClubMemberToken } from "@/lib/club-token";

export const runtime = "nodejs";

// Escape a value before interpolating it into an HTML attribute.
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Always responds 200 with an HTML page (even for a bad link) — these URLs are
// opened straight from an email, so a friendly page beats a raw 4xx.
function page(title: string, bodyHtml: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#283618">` +
      `<h1 style="font-size:1.4rem">${title}</h1>${bodyHtml}</body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

const INVALID = page("Invalid link", "<p>This Bread Club link is invalid.</p>");

// GET never mutates — email clients and link scanners auto-fetch URLs, so the
// cancel itself is a POST behind an explicit button click on this page.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const customer = url.searchParams.get("customer") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!customer || !verifyClubMemberToken(customer, token)) return INVALID;

  return page(
    "Leave the Bread Club?",
    `<p>Confirm below and your membership ends — your card won't be charged again.</p>` +
      `<form method="POST">` +
      `<input type="hidden" name="customer" value="${escapeAttr(customer)}">` +
      `<input type="hidden" name="token" value="${escapeAttr(token)}">` +
      `<button type="submit" style="font:inherit;margin-top:1rem;padding:.6rem 1rem;` +
      `border:2px solid #283618;border-radius:.6rem;background:#e9c46a;cursor:pointer">` +
      `Yes, cancel my membership</button>` +
      `</form>`,
  );
}

export async function POST(req: Request) {
  let customer = "";
  let token = "";
  try {
    const form = await req.formData();
    customer = String(form.get("customer") ?? "");
    token = String(form.get("token") ?? "");
  } catch {
    return INVALID;
  }
  if (!customer || !verifyClubMemberToken(customer, token)) return INVALID;

  try {
    await cancelMember(customer);
  } catch (err) {
    console.error("[club/cancel] cancelMember failed", err);
    return page(
      "Something went wrong",
      "<p>We couldn't cancel your membership just now. Please try again, " +
        "or reply to any of our emails and we'll sort it out.</p>",
    );
  }
  return page(
    "You've left the Bread Club",
    "<p>Your membership is canceled and your card will not be charged again. " +
      "Thanks for baking with us — you're welcome back anytime.</p>",
  );
}
