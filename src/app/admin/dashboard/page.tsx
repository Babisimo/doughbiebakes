import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/admin-auth";
import { getAllDropFinancials } from "@/lib/catalog";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Financial dashboard",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  if (!(await getAdminSession())) {
    redirect("/admin/login?next=/admin/dashboard");
  }

  const rows = await getAllDropFinancials();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
            Admin · Financial dashboard
          </p>
          <h1 className="display mt-1 text-4xl sm:text-5xl">How&apos;s business?</h1>
          <p className="mt-2 max-w-prose text-ink-700">
            Revenue, cost, and profit rolled up by week or month — from the drop
            snapshots you save in the ROI calculator.
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm font-bold text-acid-600 underline decoration-2 hover:no-underline"
        >
          ← Admin
        </Link>
      </div>

      <div className="mt-8">
        <DashboardClient rows={rows} />
      </div>
    </div>
  );
}
