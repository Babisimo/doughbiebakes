"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavItem = { href: string; label: string };

/**
 * Mobile-only nav. The desktop <nav> in site-header is `hidden md:flex`, so
 * below `md` this hamburger is the only way to reach the nav links.
 */
export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on a real route change (e.g. browser back/forward). Hash links like
  // /#about don't change the pathname — those are covered by the link onClick
  // below. Adjusting state during render is React's recommended alternative to
  // a setState-in-effect here.
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // Lock vertical scroll only — globals.css owns `overflow-x: hidden`.
    document.body.style.overflowY = "hidden";
    panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflowY = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        onClick={() => setOpen((v) => !v)}
        className="grid h-10 w-10 place-items-center rounded-2xl border border-ink/15 bg-paper/60 backdrop-blur transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-0.5 active:scale-95"
      >
        <span className="relative block h-4 w-5" aria-hidden>
          <span
            className={`absolute left-0 block h-0.5 w-5 rounded-full bg-ink transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
              open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-0"
            }`}
          />
          <span
            className={`absolute left-0 top-1/2 block h-0.5 w-5 -translate-y-1/2 rounded-full bg-ink transition-opacity duration-200 ${
              open ? "opacity-0" : "opacity-100"
            }`}
          />
          <span
            className={`absolute left-0 block h-0.5 w-5 rounded-full bg-ink transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
              open ? "top-1/2 -translate-y-1/2 -rotate-45" : "bottom-0"
            }`}
          />
        </span>
      </button>

      {open ? (
        <>
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="absolute inset-x-0 top-full z-30 h-screen bg-ink/20 backdrop-blur-sm"
          />
          <div
            id="mobile-nav-panel"
            ref={panelRef}
            className="reveal absolute inset-x-0 top-full z-40 border-b border-white/40 bg-bone/95 backdrop-blur-xl"
          >
            <nav
              aria-label="Mobile"
              className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-4 sm:px-6"
            >
              {items.map((item, i) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className="reveal display rounded-2xl px-4 py-3 text-xl tracking-tight transition-colors hover:bg-white/60 hover:text-acid-600"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </>
      ) : null}
    </div>
  );
}
