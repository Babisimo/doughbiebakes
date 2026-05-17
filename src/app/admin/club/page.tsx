import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/admin-auth";
import { getActiveDrop } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Bake list",
  robots: { index: false, follow: false },
};

export default async function AdminClubEntry() {
  if (!(await getAdminSession())) {
    redirect("/admin/login?next=/admin/club");
  }

  const drop = await getActiveDrop({ fresh: true });
  if (!drop) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
        <h1 className="display text-4xl">No active drop</h1>
        <p className="mt-3 text-ink-700">
          Publish a drop in Sanity Studio (status announced, open, or sold out)
          and reload.
        </p>
      </div>
    );
  }

  redirect(`/admin/club/${drop.id}`);
}
