import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/admin-auth";
import { getDropsView } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Bake list",
  robots: { index: false, follow: false },
};

export default async function AdminClubEntry() {
  if (!(await getAdminSession())) {
    redirect("/admin/login?next=/admin/club");
  }

  // Prefer the active drop, but fall back to the most recently-ended one: a
  // drop being over doesn't close its bake list — those orders still need
  // baking and fulfilling, so the baker must still be able to reach the list.
  const { current, previous } = await getDropsView({ fresh: true });
  const drop = current ?? previous[0] ?? null;
  if (!drop) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
        <h1 className="display text-4xl">No drops yet</h1>
        <p className="mt-3 text-ink-700">
          Publish a drop in Sanity Studio (status announced, open, or sold out)
          and reload.
        </p>
      </div>
    );
  }

  redirect(`/admin/club/${drop.id}`);
}
