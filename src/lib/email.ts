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
    // In production a missing key is a real failure, not a soft skip — log it
    // as an error so it surfaces in Worker observability. (Locally it just
    // means email isn't wired up yet.)
    console.error(
      `[email] FAILED: RESEND_API_KEY not set — could not send "${email.subject}" to ${email.to}`,
    );
    return false;
  }
  // FROM_EMAIL must be set (and on a Resend-verified domain) in production. The
  // onboarding@resend.dev fallback only delivers to your own account address,
  // so a missing FROM_EMAIL silently breaks email to real customers — the
  // failure logs below include `from` to make that obvious.
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
      console.error(
        `[email] FAILED: Resend ${res.status} sending "${email.subject}" to ${email.to} (from ${from}) — ${body}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[email] FAILED: network error sending "${email.subject}" to ${email.to} —`,
      err,
    );
    return false;
  }
}
