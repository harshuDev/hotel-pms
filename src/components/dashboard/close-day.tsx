"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import {
  closeBusinessDate,
  type CloseDayResult,
} from "@/lib/actions/business-date";

/**
 * The night audit control. Only shown to staff who can actually run it; the
 * RPC refuses everyone else regardless, so this is a courtesy rather than the
 * gate.
 */
export function CloseDay({ businessDate }: { businessDate: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<CloseDayResult | null>(null);
  const [error, setError] = useState("");

  const day = format(parseISO(businessDate), "EEE d MMM yyyy");

  const run = () => {
    setError("");
    startTransition(async () => {
      const result = await closeBusinessDate();
      if (!result.ok) return setError(result.error);
      setDone(result.data);
      router.refresh();
    });
  };

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          setDone(null);
          setError("");
        }}
        className="rounded-md border border-line bg-white px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-shell"
      >
        Close the day
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-line bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-[17px] font-medium">
                {done ? "Day closed" : "Close the day"}
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-ink-faint hover:text-ink"
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            <div className="space-y-4 p-5">
              {done ? (
                <>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between border-b border-line pb-2">
                      <dt className="text-ink-muted">Room charges posted</dt>
                      <dd className="tnum font-medium">
                        {done.roomChargesPosted}
                      </dd>
                    </div>
                    <div className="flex justify-between border-b border-line pb-2">
                      <dt className="text-ink-muted">Charged</dt>
                      <dd className="tnum font-medium">
                        {formatMoney(done.roomChargesCents)}
                      </dd>
                    </div>
                    <div className="flex justify-between pt-1">
                      <dt className="font-medium">Business date</dt>
                      <dd className="tnum font-semibold text-brass">
                        {format(parseISO(done.nextDate), "EEE d MMM yyyy")}
                      </dd>
                    </div>
                  </dl>
                  <button
                    onClick={() => setOpen(false)}
                    className="w-full rounded bg-chrome-800 px-4 py-2 text-sm font-medium text-white hover:bg-chrome-900"
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  {/*
                    The one clause a control whose consequence is not obvious is
                    allowed. The paragraph that stood under it explained the
                    no-show sweep, which 0064 removed at the client's request —
                    a guest who has not arrived is now left exactly as they are,
                    and there is nothing to warn anybody about.
                  */}
                  <p className="text-sm leading-relaxed text-ink-muted">
                    This posts tonight&rsquo;s room charge for every guest in
                    house, closes <span className="font-medium text-ink">{day}</span>,
                    and opens the next day. It cannot be undone.
                  </p>

                  {error && (
                    <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                      {error}
                    </p>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setOpen(false)}
                      className="rounded border border-line px-4 py-2 text-sm hover:bg-shell"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={run}
                      disabled={pending}
                      className={cn(
                        "rounded bg-chrome-800 px-4 py-2 text-sm font-medium text-white hover:bg-chrome-900",
                        pending && "opacity-60",
                      )}
                    >
                      {pending ? "Closing…" : "Close the day"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
