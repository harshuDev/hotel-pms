import Link from "next/link";

/**
 * The 404.
 *
 * There was no such page. `src/app/(app)/[...stub]` caught every unmatched
 * path under the app and rendered `<ComingSoon phase="Phase 2" />`, so a
 * mistyped URL told somebody the screen they had asked for was scheduled for a
 * later phase — when every screen in the nav has been built and on real data
 * for some time. A wrong address should say so.
 *
 * Deliberately outside the `(app)` layout: that layout reads the property from
 * the database to title the page, and a 404 is not worth a query. It is also
 * the page an unauthenticated stranger reaches on a bad URL, where there is no
 * property to read.
 */
export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-shell px-6">
      <div className="mx-auto max-w-md rounded-lg border border-line bg-white px-8 py-16 text-center shadow-card">
        <p className="tnum text-xxs font-semibold uppercase tracking-[0.18em] text-ink-faint">
          404
        </p>
        <h1 className="mt-3 font-display text-[22px] font-semibold tracking-tightest text-ink">
          That page does not exist
        </h1>
        <p className="mx-auto mt-3 max-w-[38ch] text-[13px] leading-relaxed text-ink-muted">
          The address may have been mistyped, or the link that brought you here
          may be out of date.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white transition hover:bg-chrome-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
