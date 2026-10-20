import Link from "next/link";
import { Card, cn } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import type { PaidOut, ShiftHistoryRow, ShiftPayment } from "@/lib/types";

/*
 * Cashier -> Shift history (0141). The client: "when it is closed, it should
 * appear in the history." Every closed shift, newest first, with who ran it,
 * its times, the float, what the drawer should have held, what was counted
 * and the variance. "View" opens the shift's payments and paid-outs under its
 * row; the open row and the page are URL state (`?shift=`, `?history_page=`),
 * so a reload keeps them and the back button closes the row.
 *
 * Managers and administrators only: the page does not draw this for anyone
 * else, and cashier_shift_history() refuses them anyway. A receptionist counts
 * blind, so other shifts' expected figures are not theirs to read.
 */

function varianceTone(cents: number) {
  if (cents < 0) return "text-rose-600";
  if (cents > 0) return "text-warn-deep";
  return "text-ink";
}

function pageHref(page: number, shift?: string) {
  const q = new URLSearchParams();
  if (page > 1) q.set("history_page", String(page));
  if (shift) q.set("shift", shift);
  const s = q.toString();
  return `/cashier${s ? `?${s}` : ""}#shift-history`;
}

export async function ShiftHistory({
  rows,
  total,
  page,
  perPage,
  openShiftId,
  detail,
  currency,
  timezone,
}: {
  rows: ShiftHistoryRow[];
  total: number;
  page: number;
  perPage: number;
  openShiftId: string | null;
  detail: { payments: ShiftPayment[]; paidOuts: PaidOut[] } | null;
  currency: string;
  timezone: string;
}) {
  const tr = await getT();
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  return (
    <div id="shift-history" className="scroll-mt-28">
      <Card title={tr("Shift history")}>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
            {tr("No closed shifts yet.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-shell text-left text-xxs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2 font-medium">{tr("Business date")}</th>
                  <th className="px-2 py-2 font-medium">{tr("Cashier")}</th>
                  <th className="px-2 py-2 font-medium">{tr("Opened")}</th>
                  <th className="px-2 py-2 font-medium">{tr("Closed")}</th>
                  <th className="px-2 py-2 text-right font-medium">{tr("Opening float")}</th>
                  <th className="px-2 py-2 text-right font-medium">{tr("Cash payments")}</th>
                  <th className="px-2 py-2 text-right font-medium">{tr("Paid out")}</th>
                  <th className="px-2 py-2 text-right font-medium">{tr("Expected in drawer")}</th>
                  <th className="px-2 py-2 text-right font-medium">{tr("Counted")}</th>
                  <th className="px-2 py-2 text-right font-medium">{tr("Variance")}</th>
                  <th className="px-4 py-2" aria-label={tr("Actions")} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const open = r.id === openShiftId;
                  return [
                    <tr key={r.id} className={cn("hover:bg-shell", open && "bg-shell")}>
                      <td className="px-4 py-2.5 font-medium text-ink">
                        {tr.date(r.businessDate, "d MMM yyyy")}
                      </td>
                      <td className="px-2 py-2.5 text-ink">{r.cashierName}</td>
                      <td className="tnum px-2 py-2.5 text-ink-muted">{tr.stamp(r.openedAt, timezone)}</td>
                      <td className="tnum px-2 py-2.5 text-ink-muted">{tr.stamp(r.closedAt, timezone)}</td>
                      <td className="tnum px-2 py-2.5 text-right text-ink">
                        {formatMoney(r.openingFloatCents, currency)}
                      </td>
                      <td className="tnum px-2 py-2.5 text-right text-ink">
                        {formatMoney(r.cashPaymentsCents, currency)}
                        <span className="block text-xxs text-ink-faint">
                          {tr("{amount} by other methods", { amount: formatMoney(r.otherPaymentsCents, currency) })}
                        </span>
                      </td>
                      <td className="tnum px-2 py-2.5 text-right text-ink">
                        {r.paidOutsCents > 0 ? `−${formatMoney(r.paidOutsCents, currency)}` : formatMoney(0, currency)}
                      </td>
                      <td className="tnum px-2 py-2.5 text-right text-ink">
                        {formatMoney(r.expectedCents, currency)}
                      </td>
                      <td className="tnum px-2 py-2.5 text-right text-ink">
                        {formatMoney(r.countedCents, currency)}
                      </td>
                      <td className={cn("tnum px-2 py-2.5 text-right font-semibold", varianceTone(r.varianceCents))}>
                        {formatMoney(r.varianceCents, currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={pageHref(page, open ? undefined : r.id)}
                          scroll={false}
                          className="rounded-md border border-line px-2.5 py-1 text-xxs font-medium text-ink-muted hover:bg-white hover:text-ink"
                        >
                          {open ? tr("Hide") : tr("View")}
                        </Link>
                      </td>
                    </tr>,
                    open && detail ? (
                      <tr key={`${r.id}-detail`} className="bg-shell">
                        <td colSpan={11} className="px-4 pb-4 pt-1">
                          <ShiftDetail
                            row={r}
                            detail={detail}
                            currency={currency}
                            timezone={timezone}
                            tr={tr}
                          />
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {lastPage > 1 && (
        <div className="mt-3 flex items-center justify-between text-[13px]">
          <p className="text-ink-faint">{tr("Page {page} of {last}", { page, last: lastPage })}</p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                scroll={false}
                className="rounded-md border border-line px-3 py-1.5 text-ink-muted hover:bg-shell hover:text-ink"
              >
                {tr("Previous")}
              </Link>
            )}
            {page < lastPage && (
              <Link
                href={pageHref(page + 1)}
                scroll={false}
                className="rounded-md border border-line px-3 py-1.5 text-ink-muted hover:bg-shell hover:text-ink"
              >
                {tr("Next")}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ShiftDetail({
  row,
  detail,
  currency,
  timezone,
  tr,
}: {
  row: ShiftHistoryRow;
  detail: { payments: ShiftPayment[]; paidOuts: PaidOut[] };
  currency: string;
  timezone: string;
  tr: Awaited<ReturnType<typeof getT>>;
}) {
  return (
    <div className="space-y-3">
      {row.closingNotes && (
        <p className="rounded-md border border-line bg-white px-3 py-2 text-[13px] text-ink">
          <span className="text-ink-faint">{tr("Closing notes")}: </span>
          {row.closingNotes}
        </p>
      )}
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border border-line bg-white">
          <p className="border-b border-line px-4 py-2 text-xxs font-semibold uppercase tracking-wide text-ink-faint">
            {tr("Payments")} · {detail.payments.length}
          </p>
          {detail.payments.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-ink-muted">{tr("No payments were taken on this shift.")}</p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-line">
                {detail.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-ink">{p.guestName}</p>
                      <p className="text-xxs text-ink-faint">
                        {p.bookingRef} · {tr.stamp(p.createdAt, timezone)}
                      </p>
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-xxs ring-1 ring-inset",
                          p.affectsDrawer
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : "bg-slate-100 text-slate-600 ring-slate-200",
                        )}
                      >
                        {p.methodName}
                      </span>
                    </td>
                    <td className="tnum px-4 py-2 text-right font-medium text-ink">
                      {formatMoney(p.amountCents, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-lg border border-line bg-white">
          <p className="border-b border-line px-4 py-2 text-xxs font-semibold uppercase tracking-wide text-ink-faint">
            {tr("Paid-outs")} · {detail.paidOuts.length}
          </p>
          {detail.paidOuts.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-ink-muted">{tr("Nothing left the drawer on this shift.")}</p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-line">
                {detail.paidOuts.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-ink">{p.reason}</p>
                      <p className="text-xxs text-ink-faint">
                        {p.payee} ·{" "}
                        {p.rechargeBookingRef
                          ? tr("recharged to {rechargeBookingRef}", { rechargeBookingRef: p.rechargeBookingRef })
                          : tr("house expense")}{" "}
                        · {tr.stamp(p.createdAt, timezone)}
                      </p>
                    </td>
                    <td className="tnum px-4 py-2 text-right font-medium text-rose-600">
                      −{formatMoney(p.amountCents, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
