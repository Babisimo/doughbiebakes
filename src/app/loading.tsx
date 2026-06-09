// Global navigation loading UI. Next prefetches this fallback, so it appears
// the instant a link is clicked — closing the "I clicked and nothing happened"
// gap on the server-rendered (dynamic) pages. It renders inside the layout's
// <main>, so the header, footer, and prelaunch banner stay put while it shows.
//
// A spinning terracotta ring around a bouncing loaf, on brand. Motion is
// disabled for users who prefer reduced motion; the ring/loaf still render.
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span
          aria-hidden
          className="absolute inset-0 animate-spin rounded-full border-4 border-ochre/30 border-t-acid motion-reduce:animate-none"
        />
        <span aria-hidden className="animate-bounce text-3xl motion-reduce:animate-none">
          🍞
        </span>
      </div>
      <p className="display text-xl text-ink-700">Baking your page…</p>
      <span role="status" aria-live="polite" className="sr-only">
        Loading
      </span>
    </div>
  );
}
