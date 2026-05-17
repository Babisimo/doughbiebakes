import Link from "next/link";

import { HeaderCartLink } from "@/components/header-cart-link";
import { MobileNav } from "@/components/mobile-nav";
import { site } from "@/lib/site";

const nav = [
  { href: "/menu", label: "Menu" },
  { href: "/#current-drop", label: "The Drop" },
  { href: "/bread-club", label: "Bread Club" },
  { href: "/#about", label: "About" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/40 bg-bone/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-2xl panel-acid text-lg shadow-[var(--shadow-hard-acid)]"
          >
            🍞
          </span>
          <span className="display text-2xl tracking-tight">{site.name}</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors hover:bg-white/60 hover:text-acid-600"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <MobileNav items={nav} />
          <HeaderCartLink />
        </div>
      </div>
    </header>
  );
}
