"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { useT } from "@/components/i18n";
import { useCurrency } from "@/components/currency";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { reverseFolioCharges } from "@/lib/actions/booking-edit";
import type { BookingFolioView, FolioViewRoom, FolioViewTax } from "@/lib/types";

/*
 * The booking's Folio tab, laid out as the client's current system has it
 * (0127): the folio's header, "Folio For", Accommodation with one line per
 * room and its nights and tax breakdowns, Extras, Payments, and the totals --
 * Accommodation Sub-total, Extra Sub-total, each tax on its base, Due.
 *
 * Every figure is booking_folio_view()'s. Nothing here adds money up: the
 * view already did, in Postgres, and the room lines show nights not yet
 * charged (room charges post at check-out, 0125) at the rate check-out will
 * post them at.
 *
 * Only controls that do something are drawn. Remove reverses the ticked
 * extras (append-only: a reversing row each); Create Invoice and Print open
 * the printable invoice; Create Payment goes to the cashier. The reference's
 * Add Folio, Move To, Add discount, Send, PDF and View By are not copied --
 * there is nothing behind them yet.
 */

const th = "px-2 pb-1.5 text-[11.5px] font-medium text-ink-muted";
const td = "px-2 py-2 align-top";
const toolbarLink =
  "inline-flex items-center gap-1 text-[12.5px] text-brass hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";

function taxLabel(t: FolioViewTax, unnamed: string): string {
  if (!t.name) return unnamed;
  return t.name;
}

export function FolioTab({
  bookingId,
  view,
  guestName,
  guestDetails,
  timezone,
  canCharge,
}: {
  bookingId: string;
  view: BookingFolioView;
  guestName: string;
  /** Country and document, already in words, for the "Folio For" block. */
  guestDetails: string[];
  timezone: string;
  canCharge: boolean;
}) {
  const tr = useT();
  const currency = useCurrency();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<Record<string, "nights" | "taxes" | null>>({});
  const [ticked, setTicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState("");

  const taxName = (id: string | null) =>
    taxLabel(view.taxes.find((t) => t.taxRateId === id) ?? { taxRateId: id, name: null, kind: null, rateBps: null, baseCents: 0, cents: 0 }, tr("Tax"));

  const removable = view.extras.filter((e) => !e.isReversal && !e.isReversed);
  const accTax = view.rooms.reduce((a, r) => a + r.taxCents, 0);
  const accTotal = view.accommodationNetCents + accTax;
  const extTax = view.extras.reduce((a, e) => a + e.taxCents, 0);

  function toggle(room: FolioViewRoom, what: "nights" | "taxes") {
    setOpen((o) => ({ ...o, [room.bookingRoomId]: o[room.bookingRoomId] === what ? null : what }));
  }

  function remove() {
    setProblem("");
    start(async () => {
      const r = await reverseFolioCharges({ bookingId, folioItemIds: ticked });
      if (!r.ok) return setProblem(r.error);
      setTicked([]);
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-line bg-white shadow-card">
      {/* The folio's tab, as the reference's. */}
      <div className="flex items-end justify-between border-b border-line bg-shell/60 px-3 pt-2">
        <div className="rounded-t-md border border-b-0 border-line bg-white px-3 py-1.5">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
            <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
            {view.folio ? tr("Folio #{n}", { n: view.folio.number }) : tr("Folio")}
          </p>
          <p className="max-w-[12rem] truncate text-[11px] text-ink-muted">{guestName}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-2.5">
        {canCharge && (
          <button
            type="button"
            onClick={() => {
              setProblem("");
              if (ticked.length === 0) return setProblem(tr("Tick the extras to remove first."));
              setConfirming(true);
            }}
            className="inline-flex items-center gap-1 text-[12.5px] text-ink-muted hover:text-rose-700"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
            </svg>
            {tr("Remove")}
          </button>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href={`/bookings/${bookingId}/invoice`} target="_blank" className={toolbarLink}>
            {tr("Create Invoice")}
          </Link>
          <Link href={`/bookings/${bookingId}/invoice?print=1`} target="_blank" className={toolbarLink}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2M4.5 9.5h7v4h-7z" />
            </svg>
            {tr("Print")}
          </Link>
        </span>
      </div>

      {confirming && (
        <div className="flex flex-wrap items-center gap-3 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-[12.5px] text-ink">
          {tr.plural(
            ticked.length,
            "Reverse {n} charge? A reversing line is posted; nothing is deleted.",
            "Reverse {n} charges? A reversing line is posted for each; nothing is deleted.",
          )}
          <button type="button" disabled={pending} onClick={remove}
            className="rounded bg-rose-600 px-2.5 py-1 font-semibold text-white disabled:opacity-60">
            {tr("Remove")}
          </button>
          <button type="button" onClick={() => setConfirming(false)}
            className="rounded border border-line bg-white px-2.5 py-1">
            {tr("Cancel")}
          </button>
        </div>
      )}
      {problem && <p role="alert" className="border-b border-line px-4 py-2 text-[12.5px] text-rose-700">{problem}</p>}

      <div className="space-y-6 p-5 text-[13px]">
        {/* Folio For */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] text-ink-muted">{tr("Folio For:")}</p>
            <p className="text-[16px] font-semibold text-ink">{guestName}</p>
            {guestDetails.length > 0 && (
              <p className="mt-0.5 text-[12px] italic text-ink-muted">{guestDetails.join(", ")}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[14px] text-ink">
              {tr("Status:")} <span className="font-semibold">{tr("Folio")}</span>
            </p>
            {view.folio && (
              <>
                <p className="mt-2 text-[12px] text-ink-muted">
                  {tr("No:")} <span className="tnum text-ink">{view.folio.number}</span>
                </p>
                <p className="text-[12px] text-ink-muted">
                  {tr("Date:")} <span className="text-ink">{tr.stamp(view.folio.openedAt, timezone)}</span>
                </p>
              </>
            )}
          </div>
        </div>

        {/* Accommodation */}
        <section>
          <h3 className="mb-2 text-[15px] font-semibold text-ink">{tr("Accommodation")}</h3>
          {view.rooms.length === 0 ? (
            <p className="text-ink-muted">{tr("No rooms on this booking.")}</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className={th}>{tr("Title")}</th>
                  <th className={cn(th, "text-center")}>{tr("Count")}</th>
                  <th className={cn(th, "text-right")}>{tr("Net")}</th>
                  <th className={cn(th, "text-right")}>{tr("Taxes")}</th>
                  <th className={cn(th, "text-right")}>{tr("Total")}</th>
                </tr>
              </thead>
              <tbody>
                {view.rooms.map((r) => {
                  const shown = open[r.bookingRoomId] ?? null;
                  const details = [
                    r.roomNumber ? tr("Room: {n}", { n: r.roomNumber }) : tr("No room assigned"),
                    r.ratePlan,
                  ].filter(Boolean).join(", ");
                  return (
                    <Fragment key={r.bookingRoomId}>
                      <tr className="border-b border-line">
                        <td className={td}>
                          <p className="text-ink">
                            {r.roomType} <span className="text-ink-muted">({details})</span>
                          </p>
                          <p className="mt-0.5 flex gap-3 text-[12px]">
                            <button type="button" onClick={() => toggle(r, "nights")} className="text-brass hover:underline">
                              {tr("Nights breakdown")} {shown === "nights" ? "▴" : "▾"}
                            </button>
                            <button type="button" onClick={() => toggle(r, "taxes")} className="text-brass hover:underline">
                              {tr("Tax breakdown")} {shown === "taxes" ? "▴" : "▾"}
                            </button>
                          </p>
                          {shown === "nights" && (
                            <table className="mt-2 w-full max-w-md text-[12px]">
                              <tbody>
                                {r.nights.map((n) => (
                                  <tr key={n.stayDate}>
                                    <td className="py-0.5 text-ink-muted">{tr.date(n.stayDate, "EEE d MMM yyyy")}</td>
                                    <td className="tnum py-0.5 text-right">{formatMoney(n.netCents, currency)}</td>
                                    <td className="tnum py-0.5 text-right text-ink-muted">{formatMoney(n.taxCents, currency)}</td>
                                    <td className="tnum py-0.5 text-right">{formatMoney(n.netCents + n.taxCents, currency)}</td>
                                    <td className="py-0.5 pl-2 text-ink-faint">{n.charged ? tr("Charged") : tr("At check-out")}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {shown === "taxes" && (
                            <table className="mt-2 w-full max-w-xs text-[12px]">
                              <tbody>
                                {r.taxes.length === 0 ? (
                                  <tr><td className="py-0.5 text-ink-muted">{tr("No tax")}</td></tr>
                                ) : (
                                  r.taxes.map((t) => (
                                    <tr key={t.taxRateId ?? "none"}>
                                      <td className="py-0.5 text-ink-muted">{taxName(t.taxRateId)}</td>
                                      <td className="tnum py-0.5 text-right">{formatMoney(t.cents, currency)}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          )}
                        </td>
                        <td className={cn(td, "tnum text-center")}>{r.count}</td>
                        <td className={cn(td, "tnum text-right")}>{formatMoney(r.netCents, currency)}</td>
                        <td className={cn(td, "tnum text-right")}>{formatMoney(r.taxCents, currency)}</td>
                        <td className={cn(td, "tnum text-right")}>{formatMoney(r.netCents + r.taxCents, currency)}</td>
                      </tr>
                    </Fragment>
                  );
                })}
                <tr className="font-semibold">
                  <td className={cn(td, "text-right")} colSpan={2}>{tr("Total")}</td>
                  <td className={cn(td, "tnum text-right")}>{formatMoney(view.accommodationNetCents, currency)}</td>
                  <td className={cn(td, "tnum text-right")}>{formatMoney(accTax, currency)}</td>
                  <td className={cn(td, "tnum text-right")}>{formatMoney(accTotal, currency)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>

        {/* Extras -- only when there are any, as the reference. */}
        {view.extras.length > 0 && (
          <section>
            <h3 className="mb-2 text-[15px] font-semibold text-ink">{tr("Extras")}</h3>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className={th}>{tr("Title")}</th>
                  <th className={cn(th, "text-center")}>{tr("Count")}</th>
                  <th className={cn(th, "text-right")}>{tr("Net")}</th>
                  <th className={cn(th, "text-right")}>{tr("Taxes")}</th>
                  <th className={cn(th, "text-right")}>{tr("Total")}</th>
                </tr>
              </thead>
              <tbody>
                {view.extras.map((e) => {
                  const can = canCharge && !e.isReversal && !e.isReversed;
                  return (
                    <tr key={e.folioItemId} className={cn("border-b border-line", e.isReversed && "text-ink-faint line-through")}>
                      <td className={td}>
                        <span className="flex items-start gap-2">
                          {canCharge && !can && <span className="w-3.5 shrink-0" aria-hidden="true" />}
                          {can && (
                            <input
                              type="checkbox"
                              className="mt-0.5 h-3.5 w-3.5 accent-brass"
                              checked={ticked.includes(e.folioItemId)}
                              aria-label={tr("Select {name}", { name: tr.message(e.description) })}
                              onChange={(ev) =>
                                setTicked((t) => ev.target.checked ? [...t, e.folioItemId] : t.filter((x) => x !== e.folioItemId))
                              }
                            />
                          )}
                          <span>
                            {tr.message(e.description)}
                            <span className="ml-2 text-[11px] text-ink-faint">{tr.date(e.businessDate, "d MMM")}</span>
                          </span>
                        </span>
                      </td>
                      <td className={cn(td, "tnum text-center")}>{e.quantity}</td>
                      <td className={cn(td, "tnum text-right")}>{formatMoney(e.netCents, currency)}</td>
                      <td className={cn(td, "tnum text-right")}>{formatMoney(e.taxCents, currency)}</td>
                      <td className={cn(td, "tnum text-right")}>{formatMoney(e.totalCents, currency)}</td>
                    </tr>
                  );
                })}
                <tr className="font-semibold">
                  <td className={cn(td, "text-right")} colSpan={2}>{tr("Total")}</td>
                  <td className={cn(td, "tnum text-right")}>{formatMoney(view.extrasNetCents, currency)}</td>
                  <td className={cn(td, "tnum text-right")}>{formatMoney(extTax, currency)}</td>
                  <td className={cn(td, "tnum text-right")}>{formatMoney(view.extrasNetCents + extTax, currency)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        )}

        {/* Payments */}
        <section>
          <h3 className="mb-2 text-[15px] font-semibold text-ink">{tr("Payments")}</h3>
          {view.payments.length === 0 ? (
            <p className="text-center text-[12.5px] text-ink-muted">
              {tr("This folio has no payments yet.")}
              <br />
              <Link href="/cashier" className="text-brass hover:underline">{tr("Create Payment")}</Link>
            </p>
          ) : (
            <>
              <table className="w-full">
                <tbody>
                  {view.payments.map((p) => (
                    <tr key={p.paymentId} className="border-b border-line">
                      <td className={cn(td, "text-ink-muted")}>{tr.date(p.businessDate, "d MMM yyyy")}</td>
                      <td className={td}>
                        {p.method ?? tr("Payment")}
                        {p.isReversal && <span className="ml-2 text-[11px] text-warn-deep">{tr("reversed")}</span>}
                      </td>
                      <td className={cn(td, "tnum text-right text-emerald-700")}>{formatMoney(p.amountCents, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-right">
                <Link href="/cashier" className="text-[12.5px] text-brass hover:underline">{tr("Create Payment")}</Link>
              </p>
            </>
          )}
        </section>

        {/* Totals, as the reference: Total, the sub-totals, each tax on its base, Due. */}
        <div className="flex justify-end">
          <dl className="w-full max-w-xs space-y-1 text-right text-[12.5px]">
            <div>
              <dt className="sr-only">{tr("Total")}</dt>
              <dd className="font-display text-[26px] font-semibold tracking-tightest text-ink">
                {tr("Total:")} <span className="tnum">{formatMoney(view.totalCents, currency)}</span>
              </dd>
            </div>
            <div className="flex justify-end gap-1 text-ink-muted">
              <dt>{tr("Accommodation Sub-total:")}</dt>
              <dd className="tnum text-ink">{formatMoney(view.accommodationNetCents, currency)}</dd>
            </div>
            <div className="flex justify-end gap-1 text-ink-muted">
              <dt>{tr("Extra Sub-total:")}</dt>
              <dd className="tnum text-ink">{formatMoney(view.extrasNetCents, currency)}</dd>
            </div>
            {view.taxes.map((t) => (
              <div key={t.taxRateId ?? "none"} className="flex justify-end gap-1 text-ink-muted">
                <dt>
                  {taxLabel(t, tr("Tax"))} ({formatMoney(t.baseCents, currency)}):
                </dt>
                <dd className="tnum text-ink">{formatMoney(t.cents, currency)}</dd>
              </div>
            ))}
            {view.paidCents !== 0 && (
              <div className="flex justify-end gap-1 text-ink-muted">
                <dt>{tr("Paid:")}</dt>
                <dd className="tnum text-emerald-700">{formatMoney(view.paidCents, currency)}</dd>
              </div>
            )}
            <div className="flex justify-end gap-1 border-t border-line pt-1">
              <dt className="font-medium">{tr("Due:")}</dt>
              <dd className={cn("tnum font-bold", view.dueCents > 0 ? "text-rose-600" : "text-ink")}>
                {formatMoney(view.dueCents, currency)}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
