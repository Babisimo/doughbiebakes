import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Admin login",
  robots: { index: false, follow: false },
};

type Search = { next?: string; error?: string };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { next, error } = await searchParams;

  // Already logged in — skip the form.
  if (await getAdminSession()) {
    redirect(next && next.startsWith("/admin") ? next : "/admin/club");
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-20 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
        Bakery admin
      </p>
      <h1 className="display mt-1 text-4xl">Log in</h1>
      <p className="mt-3 text-sm text-ink-700">
        Enter your <code>BAKER_TOKEN</code> to reach the bake-list pages.
      </p>

      {error ? (
        <p className="nb-card-sm mt-4 bg-flame/15 p-3 text-sm text-ink">
          Wrong token — try again.
        </p>
      ) : null}

      <form
        method="POST"
        action="/api/admin/login"
        className="mt-6 space-y-3"
        autoComplete="off"
      >
        <label className="block text-sm font-semibold" htmlFor="token">
          Token
        </label>
        <input
          id="token"
          name="token"
          type="password"
          required
          autoFocus
          className="w-full rounded-md border border-ink/20 bg-white px-3 py-2 text-sm shadow-sm focus:border-acid focus:outline-none"
        />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <button type="submit" className="btn-acid w-full text-sm">
          Log in
        </button>
      </form>
    </div>
  );
}
