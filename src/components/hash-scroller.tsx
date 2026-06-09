"use client";

import { useEffect } from "react";

/**
 * Reliable in-page anchor scrolling for the home page.
 *
 * Two problems this solves:
 *  1. Cross-page nav to a hash (e.g. clicking "The Drop" → "/#current-drop"
 *     from /menu): the home page is `force-dynamic` and streams, so the target
 *     section often isn't in the DOM yet when Next tries to scroll — it gives
 *     up and leaves you at the top. We retry on each frame until the element
 *     exists, then scroll it into view.
 *  2. Same-page anchor clicks: Next router navigations update history without
 *     firing `hashchange`, and the built-in scroll is unreliable on a dynamic
 *     page. We intercept on-page hash links and scroll ourselves.
 *
 * Mount this once on a page that has hash targets (the home page). The
 * `scroll-mt-*` utility on each target section keeps it clear of the sticky
 * header.
 */
export function HashScroller() {
  useEffect(() => {
    let raf = 0;

    const scrollToId = (id: string) => {
      let tries = 0;
      const tick = () => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (tries++ < 30) {
          raf = requestAnimationFrame(tick); // wait for streamed content
        }
      };
      tick();
    };

    const scrollToCurrentHash = () => {
      if (window.location.hash.length > 1) {
        scrollToId(decodeURIComponent(window.location.hash.slice(1)));
      }
    };

    // 1) We just landed here (possibly from another page) with a hash in the URL.
    scrollToCurrentHash();

    // 2) Same-page hash links — handle them ourselves so they always scroll.
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (!href || !href.includes("#")) return;

      const url = new URL(href, window.location.href);
      // Different page → let Next navigate; the mount handler above scrolls
      // once we arrive. Only act on same-path links whose target exists here.
      if (url.pathname !== window.location.pathname || !url.hash) return;
      const id = decodeURIComponent(url.hash.slice(1));
      if (!document.getElementById(id)) return;

      e.preventDefault();
      history.pushState(null, "", url.hash);
      scrollToId(id);
    };

    // 3) Back/forward to a hash.
    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", scrollToCurrentHash);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", scrollToCurrentHash);
    };
  }, []);

  return null;
}
