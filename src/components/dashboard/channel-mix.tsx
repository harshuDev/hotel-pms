import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { Card } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import type { ChannelRevenueRow } from "@/lib/types";
import { getPropertyCurrency } from "@/lib/queries";

/**
 * Where the next four weeks' business came from: one row per booking
 * channel, over the same nights the pace chart forecasts.
 *
 * It is `channel_report()` -- the Channel report's own read, so the two cannot
 * disagree -- over a fixed window from the business date. The bar is the
 * channel's share of room nights, which is what a front office watches: a
 * direct booking and an OTA booking of the same stay fill the same room.
 */
export async function ChannelMix({
  rows,
  from,
  to,
}: {
  rows: ChannelRevenueRow[];
  from: string;
  to: string;
}) {
  const tr = await getT();
  const currency = await getPropertyCurrency();
  const totalNights = rows.reduce((sum, r) => sum + r.roomNights, 0);

  return (
    <Card
      eyebrow={tr("Next {n} nights", { n: 28 })}
      title={tr("Booking channels")}
      action={
        <Link
          href={`/reports/channel?from=${from}&to=${to}`}
          className="rounded text-xs font-medium text-brass hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
        >
          {tr("Channel Report")}
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="px-5 pb-4 text-[13px] text-ink-muted">
          {tr("No nights booked in the next four weeks.")}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const share = totalNights > 0 ? (r.roomNights / totalNights) * 100 : 0;
            return (
              <li key={r.channelName} className="px-5 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[13px] font-medium text-ink">
                    {r.channelName}
                  </p>
                  <p className="tnum shrink-0 text-[13px] font-medium text-ink">
                    {formatMoney(r.roomRevenueCents, currency)}
                  </p>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-shell">
                    <div
                      className="h-full rounded-full bg-chrome-700"
                      style={{ width: `${Math.max(share, 1)}%` }}
                    />
                  </div>
                  <p className="tnum w-[11.5rem] shrink-0 text-right text-xxs text-ink-faint">
                    {tr.plural(r.bookingCount, "{n} booking", "{n} bookings")}
                    {" · "}
                    {tr.plural(r.roomNights, "{n} night", "{n} nights")}
                    {" · "}
                    {Math.round(share)}%
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
