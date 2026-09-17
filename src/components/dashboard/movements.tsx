"use client";

import { useState } from "react";
import { Card, EmptyState, cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import {
  CheckInAction,
  CheckOutAction,
} from "@/components/dashboard/movement-actions";
import type { Booking } from "@/lib/types";

type Tab = "arrivals" | "departures";

export function Movements({
  arrivals,
  departures,
  canMoveGuests,
}: {
  arrivals: Booking[];
  departures: Booking[];
  canMoveGuests: boolean;
}) {
  const [tab, setTab] = useState<Tab>("arrivals");
  const rows = tab === "arrivals" ? arrivals : departures;

  return (
    <Card
      eyebrow="Today"
      title="Movements"
      className="h-[358px]"
      bodyClassName="overflow-y-auto"
      action={
        <div className="flex rounded-md bg-shell p-0.5">
          {(["arrivals", "departures"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded px-2.5 py-1 text-xs capitalize transition-colors",
                tab === t
                  ? "bg-white font-medium text-ink shadow-card"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {t}
              <span className="tnum ml-1.5 text-ink-faint">
                {t === "arrivals" ? arrivals.length : departures.length}
              </span>
            </button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          title={
            tab === "arrivals" ? "Nobody arriving today" : "Everyone has left"
          }
          hint={
            tab === "arrivals"
              ? "Confirmed bookings for today appear here."
              : "Departures clear from this list once the folio settles."
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-3 px-5 py-2.5 hover:bg-shell"
            >
              <span
                className={cn(
                  "tnum grid h-8 w-10 shrink-0 place-items-center rounded border text-xs font-medium",
                  b.roomNumber
                    ? "border-chrome-700 bg-chrome-700 text-white"
                    : "border-dashed border-line-strong text-ink-faint",
                )}
              >
                {b.roomNumber ?? "—"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">
                  {b.customerName}
                </p>
                <p className="text-xxs text-ink-faint">
                  {b.typeLine ?? `${b.roomTypeName} · ${b.nights}n · ${b.channelName}`}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    "tnum text-[13px] font-medium",
                    b.balanceCents > 0 ? "text-rose-600" : "text-emerald-600",
                  )}
                >
                  {b.balanceCents > 0 ? formatMoney(b.balanceCents) : "Settled"}
                </p>
                <p className="text-xxs text-ink-faint">
                  {b.adults + b.children} pax
                </p>
              </div>
              {/* A guest can only move one way, and only from the right state:
                  an arrival that has already checked in has nothing to do
                  here, and neither does a departure that has left. */}
              {canMoveGuests &&
                tab === "arrivals" &&
                (b.status === "pending" || b.status === "confirmed") && (
                  <CheckInAction booking={b} />
                )}
              {canMoveGuests &&
                tab === "departures" &&
                b.status === "checked_in" && <CheckOutAction booking={b} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
