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
 *     exists. We then keep re-aligning until the page stops moving: the hero's
 *     `display: swap` web font loads a few frames after mount, grows the big
 *     heading, and pushes the drop down — so a single scroll lands above it.
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
      // Cancel any settle loop already in flight (e.g. a second anchor click)
      // so two loops don't fight over the scroll position.
      cancelAnimationFrame(raf);

      const deadline = performance.now() + 3000; // safety cap
      let lastY = Number.NaN;
      let stableFrames = 0;
      let aligned = false;
      let fontsReady = false;

      // The big hero heading uses a `display: swap` web font; when it swaps in
      // it gets taller and pushes the drop down — usually a few frames AFTER we
      // first scroll. Don't treat the page as settled until fonts are in.
      if (document.fonts?.ready) {
        document.fonts.ready.then(() => {
          fontsReady = true;
        });
      } else {
        fontsReady = true;
      }

      const tick = () => {
        const el = document.getElementById(id);
        if (!el) {
          // Section hasn't streamed in yet — keep waiting for it.
          if (performance.now() < deadline) raf = requestAnimationFrame(tick);
          return;
        }

        // The element's absolute position in the document. Unlike a viewport
        // measurement this is invariant under our own scrolling, so it only
        // moves when layout *above* the drop changes (font swap, etc.).
        const y = el.getBoundingClientRect().top + window.scrollY;

        if (!aligned) {
          // First alignment honors the page's CSS smooth scroll, so same-page
          // anchor clicks still animate nicely.
          el.scrollIntoView({ block: "start" });
          aligned = true;
        } else if (Math.abs(y - lastY) >= 1) {
          // Layout shifted under us — snap back to the top instantly so we
          // never come to rest above the drop.
          el.scrollIntoView({ block: "start", behavior: "auto" });
        }

        stableFrames = Math.abs(y - lastY) < 1 ? stableFrames + 1 : 0;
        lastY = y;

        // Settled only once fonts are in AND the drop's position has held
        // steady for a few frames (or we hit the safety cap).
        const settled = fontsReady && stableFrames >= 5;
        if (!settled && performance.now() < deadline) {
          raf = requestAnimationFrame(tick);
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
    // Runs in the capture phase (see the listener below) so we get the click
    // *before* Next's <Link> onClick. When we take over a same-page hash link
    // we preventDefault; Next's Link then bails on `defaultPrevented` instead
    // of also navigating, which is what was stacking the hash (#current-drop
    // #current-drop…). We never stopPropagation, so Next's Link wrapper still
    // runs any user onClick (e.g. the mobile nav closing itself).
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
    // Capture phase (the `true`) so we preempt Next's <Link> click handler.
    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", scrollToCurrentHash);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("hashchange", scrollToCurrentHash);
    };
  }, []);

  return null;
}
