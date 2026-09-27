"use client";

import { useT } from "@/components/i18n";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import {
  closeBusinessDate,
  type CloseDayResult,
} from "@/lib/actions/business-date";
import { useCurrency } from "@/components/currency";

/**
 * The night audit control. Only shown to staff who can actually run it; the
 * RPC refuses everyone else regardless, so this is a courtesy rather than the
 * gate.
 */
export function CloseDay({ businessDate }: { businessDate: string }) {
  const tr = useT();
  const currency = useCurrency();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<CloseDayResult | null>(null);
  const [error, setError] = useState("");

  const day = tr.date(businessDate, "EEE d MMM yyyy");

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
        {tr("Close the day")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-line bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-[17px] font-medium">
                {done ? tr("Day closed") : tr("Close the day")}
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-ink-faint hover:text-ink"
                aria-label={tr("Close")}
              >
                ✕
              </button>
            </header>

            <div className="space-y-4 p-5">
              {done ? (
                <>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between border-b border-line pb-2">
                      <dt className="text-ink-muted">{tr("Room charges posted")}</dt>
                      <dd className="tnum font-medium">
                        {done.roomChargesPosted}
                      </dd>
                    </div>
                    <div className="flex justify-between border-b border-line pb-2">
                      <dt className="text-ink-muted">{tr("Charged")}</dt>
                      <dd className="tnum font-medium">
                        {formatMoney(done.roomChargesCents, currency)}
                      </dd>
                    </div>
                    <div className="flex justify-between pt-1">
                      <dt className="font-medium">{tr("Business date")}</dt>
                      <dd className="tnum font-semibold text-brass">
                        {tr.date(done.nextDate, "EEE d MMM yyyy")}
                      </dd>
                    </div>
                  </dl>
                  <button
                    onClick={() => setOpen(false)}
                    className="w-full rounded bg-chrome-800 px-4 py-2 text-sm font-medium text-white hover:bg-chrome-900"
                  >
                    {tr("Done")}
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
                    {tr("This posts tonight’s room charge for every guest in house, closes")}{" "}<span className="font-medium text-ink">{day}</span>{tr(", and opens the next day. It cannot be undone.")}
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
                      {tr("Cancel")}
                    </button>
                    <button
                      onClick={run}
                      disabled={pending}
                      className={cn(
                        "rounded bg-chrome-800 px-4 py-2 text-sm font-medium text-white hover:bg-chrome-900",
                        pending && "opacity-60",
                      )}
                    >
                      {pending ? tr("Closing…") : tr("Close the day")}
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
