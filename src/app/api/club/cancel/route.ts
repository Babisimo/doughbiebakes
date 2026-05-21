import { cancelMember } from "@/sanity/lib/mutations";
import { verifyClubMemberToken } from "@/lib/club-token";

export const runtime = "nodejs";

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#283618">` +
      `<h1 style="font-size:1.4rem">${title}</h1><p>${body}</p></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const customer = url.searchParams.get("customer") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!customer || !verifyClubMemberToken(customer, token)) {
    return page("Invalid link", "This Bread Club link is invalid.");
  }
  await cancelMember(customer);
  return page(
    "You've left the Bread Club",
    "Your membership is canceled and your card will not be charged again. Thanks for baking with us — you're welcome back anytime.",
  );
}
