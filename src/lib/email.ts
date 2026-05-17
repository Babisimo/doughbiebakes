import "server-only";

/**
 * Thin wrapper around Resend's REST API. We hit the HTTP endpoint directly
 * instead of pulling in the `resend` SDK to keep the dependency surface flat —
 * the request is one POST with a JSON body.
 */
export type Email = {
  to: string;
  subject: string;
  /** Full HTML body. */
  html: string;
  /** Plaintext fallback for clients / providers that strip HTML. */
  text: string;
};

export async function sendEmail(email: Email): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping send to", email.to);
    return false;
  }
  const from = process.env.FROM_EMAIL || "Doughbie <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.error("[email] Resend failed", res.status, body);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] Send error", err);
    return false;
  }
}
