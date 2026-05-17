import Link from "next/link";

import { CottageFoodNotice } from "@/components/cottage-food-notice";
import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="relative mt-20 overflow-hidden border-t border-white/40">
      {/* marquee strip */}
      <div className="marquee panel-mono py-2.5">
        <span className="marquee__track display text-sm tracking-wide">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="mx-6">
              🍞 fresh drops weekly ✶ corona ca ✶ pickup or CA shipping ✶ baked to order ✶
            </span>
          ))}
        </span>
      </div>

      <div className="bg-bone/70 backdrop-blur-xl">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.6fr_1fr_1fr]">
          <div className="space-y-3">
            <div className="display flex items-center gap-2 text-2xl">
              <span aria-hidden className="text-2xl">
                🍞
              </span>
              {site.name}
            </div>
            <div className="nb-card-sm p-4">
              <CottageFoodNotice />
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <h4 className="display text-lg text-acid-600">Shop</h4>
            <Link className="block hover:text-acid-600" href="/menu">
              Menu
            </Link>
            <Link className="block hover:text-acid-600" href="/#current-drop">
              This week&apos;s drop
            </Link>
            <Link className="block hover:text-acid-600" href="/bread-club">
              Bread Club
            </Link>
          </div>
          <div className="space-y-2 text-sm">
            <h4 className="display text-lg text-acid-600">Say hi</h4>
            <a className="block hover:text-acid-600" href={`mailto:${site.email}`}>
              {site.email}
            </a>
            <a
              className="block hover:text-acid-600"
              href={site.instagram}
              target="_blank"
              rel="noopener noreferrer"
            >
              Instagram ↗
            </a>
            <a
              className="block hover:text-acid-600"
              href={site.tiktok}
              target="_blank"
              rel="noopener noreferrer"
            >
              TikTok ↗
            </a>
          </div>
        </div>
        <div className="border-t border-white/40 px-4 py-4 text-center text-xs text-ink-500 sm:px-6">
          © {new Date().getFullYear()} {site.name} · {site.city} · made with too much starter
        </div>
      </div>
    </footer>
  );
}
