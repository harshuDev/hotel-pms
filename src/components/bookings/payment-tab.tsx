"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useT } from "@/components/i18n";
import { useCurrency } from "@/components/currency";
import { cn } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";
import { recordBookingPayment } from "@/lib/actions/booking-edit";
import type { BookingPayment, FolioTabRef, PaymentMethod } from "@/lib/types";

/*
 * The booking's Payment tab (0128), as the reference's: Transactions --
 * Date, Time, Type, Payer Name, Description, Amount -- "+ Add Manual
 * Transaction" and Total payments.
 *
 * A payment taken here is the same payment the Cashier screen takes: it goes
 * on the booking's folio (opened by a first deposit), cash needs the
 * receptionist's own open shift, and it is append-only -- a correction is a
 * reversal, never an edit.
 *
 * The reference's Card Vault and "Request payment" are not here: both need
 * card capture through a payment gateway, which is not built.
 */

const field =
  "w-full rounded border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const th = "px-2 pb-1.5 text-left text-[11.5px] font-medium text-ink-muted";
const td = "px-2 py-2 align-top text-[13px]";

export function PaymentTab({
  bookingId,
  payments,
  methods,
  folios,
  guestName,
  timezone,
  canCharge,
}: {
  bookingId: string;
  payments: BookingPayment[];
  methods: PaymentMethod[];
  /** The booking's folios (0129): a payment goes into one of them. */
  folios: FolioTabRef[];
  guestName: string;
  timezone: string;
  canCharge: boolean;
}) {
  const tr = useT();
  const currency = useCurrency();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [methodId, setMethodId] = useState(methods.find((m) => !m.affectsDrawer)?.id ?? methods[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState(guestName);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const openFolios = folios.filter((f) => f.status === "open");
  const [folioId, setFolioId] = useState<string>(openFolios.find((f) => f.isPrimary)?.id ?? openFolios[0]?.id ?? "");
  const [problem, setProblem] = useState("");

  const total = payments.reduce((a, p) => a + p.amountCents, 0);

  /** Date and time on the hotel's own clock, never the browser's. */
  function when(p: BookingPayment): { date: string; time: string } {
    const stamp = tr.stamp(p.paidAt, timezone);
    const cut = stamp.lastIndexOf(", ");
    return cut > 0 ? { date: stamp.slice(0, cut), time: stamp.slice(cut + 2) } : { date: stamp, time: "" };
  }

  function save() {
    setProblem("");
    if (!methodId) return setProblem(tr("Choose a payment type."));
    let cents: number;
    try {
      cents = parseMoney(amount);
    } catch {
      return setProblem(tr("That is not an amount. Try 120 or 120.50."));
    }
    if (!(cents > 0)) return setProblem(tr("The amount must be more than zero."));
    start(async () => {
      const r = await recordBookingPayment({
        bookingId,
        paymentMethodId: methodId,
        amountCents: cents,
        payerName: payer,
        description,
        reference,
        folioId: folioId || null,
      });
      if (!r.ok) return setProblem(r.error);
      setAdding(false);
      setAmount("");
      setDescription("");
      setReference("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-card">
      <h2 className="mb-3 font-display text-[19px] font-medium tracking-tightest text-ink">{tr("Transactions")}</h2>

      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <th className={th}>{tr("Date")}</th>
            <th className={th}>{tr("Time")}</th>
            <th className={th}>{tr("Type")}</th>
            {folios.length > 1 && <th className={th}>{tr("Folio")}</th>}
            <th className={th}>{tr("Payer Name")}</th>
            <th className={th}>{tr("Description")}</th>
            <th className={cn(th, "text-right")}>{tr("Amount")}</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const w = when(p);
            return (
              <tr key={p.paymentId} className={cn("border-b border-line", p.isReversed && "text-ink-faint line-through")}>
                <td className={cn(td, "whitespace-nowrap")}>{w.date}</td>
                <td className={cn(td, "whitespace-nowrap text-ink-muted")}>{w.time}</td>
                <td className={td}>
                  {p.method ?? tr("Payment")}
                  {p.isReversal && <span className="ml-1.5 text-[11px] text-warn-deep">{tr("reversed")}</span>}
                </td>
                {folios.length > 1 && <td className={cn(td, "tnum")}>#{p.folioNumber}</td>}
                <td className={td}>{p.payerName ?? "—"}</td>
                <td className={td}>
                  {p.description ?? ""}
                  {p.reference && <span className="ml-1.5 text-[11px] text-ink-faint">{p.reference}</span>}
                </td>
                <td className={cn(td, "tnum whitespace-nowrap text-right", p.amountCents < 0 ? "text-warn-deep" : "text-emerald-700")}>
                  {formatMoney(p.amountCents, currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {canCharge && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded border border-line bg-white px-3 py-1.5 text-[13px] text-ink hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
        >
          <span aria-hidden="true">+</span> {tr("Add Manual Transaction")}
        </button>
      )}

      {canCharge && adding && (
        <div className="mt-3 rounded-md border border-line bg-shell/60 p-3">
          {methods.length === 0 ? (
            <p className="text-[12.5px] text-ink-muted">{tr("None yet. Add at least cash and card.")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[10rem_8rem_1fr]">
              <label className="text-[12px] text-ink-muted">
                {tr("Type")}
                <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={cn(field, "mt-1")}>
                  {methods.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-[12px] text-ink-muted">
                {tr("Amount")}
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
                  autoFocus placeholder="0.00" className={cn(field, "tnum mt-1")} />
              </label>
              <label className="text-[12px] text-ink-muted">
                {tr("Payer Name")}
                <input value={payer} maxLength={200} onChange={(e) => setPayer(e.target.value)} className={cn(field, "mt-1")} />
              </label>
              {openFolios.length > 1 && (
                <label className="text-[12px] text-ink-muted sm:col-span-3">
                  {tr("Folio")}
                  <select value={folioId} onChange={(e) => setFolioId(e.target.value)} className={cn(field, "mt-1 max-w-xs")}>
                    {openFolios.map((f) => (
                      <option key={f.id} value={f.id}>
                        {tr("Folio #{n}", { n: f.number })}{f.customerName ? ` · ${f.customerName}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="text-[12px] text-ink-muted sm:col-span-2">
                {tr("Description")}
                <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} className={cn(field, "mt-1")} />
              </label>
              <label className="text-[12px] text-ink-muted">
                {tr("Reference")}
                <input value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} className={cn(field, "mt-1")} />
              </label>
            </div>
          )}
          {problem && <p role="alert" className="mt-2 text-[12.5px] text-rose-700">{problem}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setProblem(""); }}
              className="rounded border border-line bg-white px-3 py-1.5 text-[13px] hover:bg-shell">
              {tr("Cancel")}
            </button>
            {methods.length > 0 && (
              <button type="button" onClick={save} disabled={pending}
                className="rounded bg-chrome-800 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-60">
                {pending ? tr("Saving…") : tr("Save payment")}
              </button>
            )}
          </div>
        </div>
      )}

      <p className="mt-4 text-right text-[14px] font-semibold text-ink">
        {tr("Total payments:")} <span className="tnum text-emerald-700">{formatMoney(total, currency)}</span>
      </p>
    </div>
  );
}
