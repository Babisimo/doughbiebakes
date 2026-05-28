import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/admin-auth";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Admin login",
  robots: { index: false, follow: false },
};

type Search = { next?: string; error?: string; until?: string };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { next, error, until } = await searchParams;

  // Already logged in — skip the form.
  if (await getAdminSession()) {
    redirect(next && next.startsWith("/admin") ? next : "/admin");
  }

  const untilMs = until ? Number(until) : NaN;
  const lockedUntil = Number.isFinite(untilMs) && untilMs > Date.now() ? untilMs : null;

  return (
    <div className="mx-auto max-w-sm px-4 py-20 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
        Bakery admin
      </p>
      <h1 className="display mt-1 text-4xl">Log in</h1>
      <p className="mt-3 text-sm text-ink-700">
        Enter your admin password to reach the bake-list pages.
      </p>

      <LoginForm
        next={next ?? null}
        initialError={error}
        lockedUntil={lockedUntil}
      />
    </div>
  );
}
