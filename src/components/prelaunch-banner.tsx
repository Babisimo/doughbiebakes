import { IS_PRELAUNCH } from "@/lib/launch-mode";

/**
 * Site-wide banner shown while we're in pre-launch (friends-only) mode. Renders
 * nothing once NEXT_PUBLIC_LAUNCH_MODE flips to "live" — the constant resolves
 * at build time, so the no-op pass costs nothing at runtime.
 */
export function PrelaunchBanner() {
  if (!IS_PRELAUNCH) return null;
  return (
    <div className="bg-ochre text-ink px-4 py-2 text-center text-xs sm:text-sm">
      <span aria-hidden>🫶 </span>
      <strong>Founding tasting period.</strong>{" "}
      Online payments are paused while our Cottage Food Operation registration
      finishes processing. You can still browse the menu and{" "}
      <a href="/reserve" className="font-bold underline decoration-2 hover:no-underline">
        reserve a loaf
      </a>{" "}
      — we&apos;ll bake it and you can pay (or just enjoy) at pickup.
    </div>
  );
}
