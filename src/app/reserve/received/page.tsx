import Link from "next/link";

export const metadata = { title: "Reservation requested" };

export default function ReservationReceivedPage() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
      <h1 className="display text-5xl">Request received 🍞</h1>
      <p className="mt-4 text-ink-700">
        Thanks! Your pickup reservation isn&apos;t confirmed yet — we&apos;ll
        email you as soon as it&apos;s approved. No charge until pickup.
      </p>
      <Link href="/" className="btn-acid mt-8 inline-flex text-sm">
        Back home
      </Link>
    </section>
  );
}
