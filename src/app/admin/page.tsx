import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/admin-auth";
import { getActiveDrop } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Bakery admin",
  robots: { index: false, follow: false },
};

/**
 * Admin hub. Gated on the BAKER_TOKEN cookie like every other /admin/* page —
 * unauthenticated visitors are bounced to /admin/login?next=/admin.
 */
export default async function AdminHomePage() {
  if (!(await getAdminSession())) {
    redirect("/admin/login?next=/admin");
  }

  // Surface the active drop so the bake-list link is one click.
  const drop = await getActiveDrop({ fresh: true });

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
        Bakery admin
      </p>
      <h1 className="display mt-1 text-4xl">All admin pages</h1>
      <p className="mt-3 text-ink-700">
        Everything baker-side, in one place. You'll stay logged in for 30 days.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href={drop ? `/admin/club/${drop.id}` : "/admin/club"}
          className="nb-card nb-interactive block p-5"
        >
          <h2 className="display text-2xl">Bake list</h2>
          <p className="mt-2 text-sm text-ink-700">
            {drop
              ? `Member picks + public orders for "${drop.title ?? "the active drop"}".`
              : "No active drop. Publish one in Sanity Studio."}
          </p>
        </Link>

        <Link
          href="/admin/reservations"
          className="nb-card nb-interactive block p-5"
        >
          <h2 className="display text-2xl">Reservations</h2>
          <p className="mt-2 text-sm text-ink-700">
            Review, approve, or deny custom-order requests.
          </p>
        </Link>

        <Link
          href="/studio"
          className="nb-card nb-interactive block p-5"
          target="_blank"
          rel="noreferrer"
        >
          <h2 className="display text-2xl">Sanity Studio</h2>
          <p className="mt-2 text-sm text-ink-700">
            Edit products, drops, orders, members. Opens in a new tab.
          </p>
        </Link>

        <form action="/api/admin/logout" method="POST" className="nb-card p-5">
          <h2 className="display text-2xl">Log out</h2>
          <p className="mt-2 text-sm text-ink-700">
            End this admin session on this device.
          </p>
          <button type="submit" className="btn-ink mt-3 text-sm">
            Log out
          </button>
        </form>
      </div>
    </div>
  );
}
