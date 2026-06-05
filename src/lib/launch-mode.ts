/**
 * Launch-mode flag. Drives the difference between "site is up but we're not
 * taking real money yet" (pre-launch / friends-only / waiting on the CFO
 * permit) and "we're fully open for business."
 *
 * Toggled by the build-time env var NEXT_PUBLIC_LAUNCH_MODE. Default is
 * "prelaunch" so a missing/typo'd var fails safe — the site never accidentally
 * takes a real charge.
 *
 * Set NEXT_PUBLIC_LAUNCH_MODE=live in Cloudflare → Settings → Builds →
 * Variables, push or re-trigger a build, and the toggle flips.
 */

export type LaunchMode = "prelaunch" | "live";

export const LAUNCH_MODE: LaunchMode =
  process.env.NEXT_PUBLIC_LAUNCH_MODE === "live" ? "live" : "prelaunch";

/** True when the site is in friends-only / pre-CFO mode. */
export const IS_PRELAUNCH = LAUNCH_MODE === "prelaunch";
