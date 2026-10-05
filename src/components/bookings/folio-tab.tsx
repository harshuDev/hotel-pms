"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { useT } from "@/components/i18n";
import { useCurrency } from "@/components/currency";
import { cn } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";
import { parsePercentBps, type Discount } from "@/lib/finance-profiles";
import {
  addFolio,
  applyFolioDiscount,
  loadDiscounts,
  loadFolioView,
  moveFolioItems,
  reverseFolioCharges,
  setFolioCustomer,
  setFolioNotes,
} from "@/lib/actions/booking-edit";
import { searchCustomers } from "@/lib/actions/bookings";
import type { BookingFolioView, FolioViewRoom, FolioViewTax } from "@/lib/types";

/*
 * The booking's Folio tab, laid out as the client's current system has it
 * (0127, 0129): a tab per folio and "+ Add Folio"; Remove, Create Invoice,
 * Print, Send, PDF, Move To, Add discount and View By; "Folio For" with its
 * pencil; Accommodation and Extras with a tick per line; Payments; the folio
 * notes and overlay text; Total, the sub-totals, each tax on its base, Due.
 *
 * Every figure is booking_folio()'s, one folio at a time. Nothing here adds
 * money up, and every change is a Postgres function on the append-only
 * ledger: Remove and Move To post reversals (Move To a copy where the charge
 * lands), Add discount posts a discount row on a charged line or reprices a
 * night not charged yet. A room's nights not yet charged belong to the folio
 * the room is routed to, the primary until it is moved.
 */

const th = "px-2 pb-1.5 text-[11.5px] font-medium text-ink-muted";
const td = "px-2 py-2 align-top";
const toolbarLink =
  "inline-flex items-center gap-1 text-[12.5px] text-brass hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const field =
  "rounded border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";

type Panel = null | "remove" | "discount" | "customer" | "notes" | "move";
type Result = { ok: true } | { ok: false; error: string };

function taxLabel(t: FolioViewTax, unnamed: string): string {
  return t.name ?? unnamed;
}

export function FolioTab({
  bookingId,
  view: initial,
  guestName,
  guestEmail,
  guestDetails,
  timezone,
  canCharge,
  canEdit,
}: {
  bookingId: string;
  view: BookingFolioView;
  guestName: string;
  guestEmail: string | null;
  /** Country and document, already in words, for the "Folio For" block. */
  guestDetails: string[];
  timezone: string;
  /** May post money: Remove, Move To, notes. */
  canCharge: boolean;
  /** Front office: Add Folio, Folio For, Add discount. */
  canEdit: boolean;
}) {
  const tr = useT();
  const currency = useCurrency();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [view, setView] = useState(initial);
  const [selected, setSelected] = useState<string | null>(initial.folio?.id ?? null);
  const [open, setOpen] = useState<Record<string, "nights" | "taxes" | null>>({});
  const [tickedItems, setTickedItems] = useState<string[]>([]);
  const [tickedRooms, setTickedRooms] = useState<string[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [viewBy, setViewBy] = useState<"type" | "date">("type");
  const [problem, setProblem] = useState("");

  // A refresh re-renders the page with the primary folio; take it only while
  // the primary is the one on screen.
  useEffect(() => {
    if (!selected || selected === initial.folio?.id) setView(initial);
  }, [initial, selected]);

  const folio = view.folio;
  const isOpen = folio?.status === "open";
  const others = view.folios.filter((f) => f.id !== folio?.id && f.status === "open");
  const taxName = (id: string | null) => view.taxes.find((t) => t.taxRateId === id)?.name ?? tr("Tax");
  const accTax = view.rooms.reduce((a, r) => a + r.taxCents, 0);
  const extTax = view.extras.reduce((a, e) => a + e.taxCents, 0);
  const anyTicked = tickedItems.length + tickedRooms.length > 0;
  const mayTick = (canCharge || canEdit) && isOpen;
  const tickable = (e: BookingFolioView["extras"][number]) =>
    !e.isReversal && !e.isReversed && !e.isDiscounted && !e.isDiscount;

  function clearTicks() {
    setTickedItems([]);
    setTickedRooms([]);
  }

  /** Reads one folio again (after a change, or a tab click). */
  async function reload(id: string | null) {
    if (!id) return router.refresh();
    const r = await loadFolioView(bookingId, id);
    if (r.ok) setView(r.data);
    else setProblem(r.error);
  }

  function run(fn: () => Promise<Result>, next?: string | null) {
    setProblem("");
    start(async () => {
      const r = await fn();
      if (!r.ok) return setProblem(r.error);
      clearTicks();
      setPanel(null);
      const id = next ?? selected;
      if (next) setSelected(next);
      await reload(id);
      router.refresh();
    });
  }

  function showFolio(id: string) {
    setProblem("");
    setPanel(null);
    clearTicks();
    setSelected(id);
    start(() => reload(id));
  }

  function needTicks(message: string): boolean {
    if (anyTicked) return false;
    setProblem(message);
    return true;
  }

  // Send: the folio in plain words, to the guest, from the desk's own mail.
  const mailBody = folio
    ? [
        `${tr("Folio #{n}", { n: folio.number })} · ${folio.customerName ?? guestName}`,
        "",
        ...view.rooms.map(
          (r) =>
            `${r.roomType}${r.roomNumber ? ` (${tr("Room: {n}", { n: r.roomNumber })})` : ""} x${r.count}: ${formatMoney(r.netCents + r.taxCents, currency)}`,
        ),
        ...view.extras.map((e) => `${tr.message(e.description)}: ${formatMoney(e.totalCents, currency)}`),
        "",
        `${tr("Total:")} ${formatMoney(view.totalCents, currency)}`,
        `${tr("Paid:")} ${formatMoney(view.paidCents, currency)}`,
        `${tr("Due:")} ${formatMoney(view.dueCents, currency)}`,
      ].join("\n")
    : "";
  const mailto = `mailto:${encodeURIComponent(guestEmail ?? "")}?subject=${encodeURIComponent(
    folio ? tr("Folio #{n}", { n: folio.number }) : tr("Folio"),
  )}&body=${encodeURIComponent(mailBody)}`;

  // View By: Date -- every line of the folio by its date.
  const byDate = [
    ...view.rooms.flatMap((r) =>
      r.nights.map((n) => ({
        key: `${r.bookingRoomId}-${n.stayDate}`,
        date: n.stayDate,
        title: `${r.roomType}${r.roomNumber ? ` (${tr("Room: {n}", { n: r.roomNumber })})` : ""}`,
        net: n.netCents,
        tax: n.taxCents,
        note: n.charged ? null : tr("At check-out"),
      })),
    ),
    ...view.extras.map((e) => ({
      key: e.folioItemId,
      date: e.businessDate,
      title: tr.message(e.description),
      net: e.netCents,
      tax: e.taxCents,
      note: null as string | null,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="rounded-lg border border-line bg-white shadow-card">
      {/* A tab per folio, as the reference's, and "+ Add Folio". */}
      <div className="flex items-end gap-1 overflow-x-auto border-b border-line bg-shell/60 px-3 pt-2">
        {view.folios.length === 0 && (
          <div className="rounded-t-md border border-b-0 border-line bg-white px-3 py-1.5">
            <p className="text-[12.5px] font-semibold text-ink">{tr("Folio")}</p>
            <p className="max-w-[12rem] truncate text-[11px] text-ink-muted">{guestName}</p>
          </div>
        )}
        {view.folios.map((f) => {
          const active = f.id === folio?.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => !active && showFolio(f.id)}
              aria-pressed={active}
              className={cn(
                "rounded-t-md border border-b-0 px-3 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass",
                active ? "border-line bg-white" : "border-transparent hover:bg-white/60",
              )}
            >
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                <span className={cn("h-2 w-2 rounded-full", f.status === "open" ? "bg-rose-500" : "bg-ink-faint")} aria-hidden="true" />
                {tr("Folio #{n}", { n: f.number })}
              </span>
              <span className="block max-w-[12rem] truncate text-[11px] text-ink-muted">{f.customerName ?? guestName}</span>
            </button>
          );
        })}
        {canEdit && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setProblem("");
              start(async () => {
                const r = await addFolio(bookingId);
                if (!r.ok) return setProblem(r.error);
                clearTicks();
                setPanel(null);
                setSelected(r.data.folioId);
                await reload(r.data.folioId);
                router.refresh();
              });
            }}
            className="mb-1.5 ml-auto inline-flex shrink-0 items-center gap-1 text-[12.5px] text-brass hover:underline"
          >
            <span aria-hidden="true">+</span> {tr("Add Folio")}
          </button>
        )}
      </div>

      {/* Toolbar, in the reference's order. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-2.5">
        {canCharge && isOpen && (
          <button
            type="button"
            onClick={() => {
              setProblem("");
              if (tickedItems.length === 0) {
                return setProblem(
                  tickedRooms.length > 0
                    ? tr("Accommodation is changed on the Rooms tab. Tick extras to remove them.")
                    : tr("Tick the extras to remove first."),
                );
              }
              setPanel("remove");
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
          <a href={mailto} className={toolbarLink}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M2 4h12v8H2zM2 4l6 5 6-5" />
            </svg>
            {tr("Send")}
          </a>
          <Link href={`/bookings/${bookingId}/invoice?print=1`} target="_blank" className={toolbarLink}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M4 1.5h5.5L12 4v10.5H4zM9.5 1.5V4H12" />
            </svg>
            {tr("PDF")}
          </Link>
          {canCharge && isOpen && others.length > 0 && (
            <span className="relative">
              <button
                type="button"
                onClick={() => {
                  setProblem("");
                  if (needTicks(tr("Tick the lines to move first."))) return;
                  setPanel(panel === "move" ? null : "move");
                }}
                className={toolbarLink}
                aria-expanded={panel === "move"}
              >
                {tr("Move To")} ▾
              </button>
              {panel === "move" && (
                <span className="absolute right-0 top-full z-20 mt-1 block min-w-[12rem] rounded-md border border-line bg-white py-1 shadow-card">
                  {others.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          moveFolioItems({
                            bookingId,
                            targetFolioId: f.id,
                            folioItemIds: tickedItems,
                            bookingRoomIds: tickedRooms,
                          }),
                        )
                      }
                      className="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-shell"
                    >
                      {tr("Folio #{n}", { n: f.number })}
                      <span className="ml-1 text-ink-muted">{f.customerName ?? guestName}</span>
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
          {canEdit && isOpen && (
            <button
              type="button"
              onClick={() => {
                setProblem("");
                if (needTicks(tr("Tick the lines to discount first."))) return;
                setPanel(panel === "discount" ? null : "discount");
              }}
              className={toolbarLink}
            >
              % {tr("Add discount")}
            </button>
          )}
          <label className="inline-flex items-center gap-1 text-[12.5px] text-brass">
            {tr("View By")}
            <select
              value={viewBy}
              onChange={(e) => setViewBy(e.target.value === "date" ? "date" : "type")}
              className="rounded border border-line bg-white px-1.5 py-0.5 text-[12px] text-ink"
            >
              <option value="type">{tr("Type")}</option>
              <option value="date">{tr("Date")}</option>
            </select>
          </label>
        </span>
      </div>

      {panel === "remove" && (
        <div className="flex flex-wrap items-center gap-3 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-[12.5px] text-ink">
          {tr.plural(
            tickedItems.length,
            "Reverse {n} charge? A reversing line is posted; nothing is deleted.",
            "Reverse {n} charges? A reversing line is posted for each; nothing is deleted.",
          )}
          <button type="button" disabled={pending}
            onClick={() => run(() => reverseFolioCharges({ bookingId, folioItemIds: tickedItems }))}
            className="rounded bg-rose-600 px-2.5 py-1 font-semibold text-white disabled:opacity-60">
            {tr("Remove")}
          </button>
          <button type="button" onClick={() => setPanel(null)} className="rounded border border-line bg-white px-2.5 py-1">
            {tr("Cancel")}
          </button>
        </div>
      )}

      {panel === "discount" && folio && (
        <DiscountPanel
          pending={pending}
          onCancel={() => setPanel(null)}
          onApply={(d) =>
            run(() =>
              applyFolioDiscount({
                bookingId,
                folioId: folio.id,
                folioItemIds: tickedItems,
                bookingRoomIds: tickedRooms,
                ...d,
              }),
            )
          }
        />
      )}

      {problem && <p role="alert" className="border-b border-line px-4 py-2 text-[12.5px] text-rose-700">{problem}</p>}

      <div className="space-y-6 p-5 text-[13px]">
        {/* Folio For */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] text-ink-muted">{tr("Folio For:")}</p>
            <p className="flex items-center gap-1.5 text-[16px] font-semibold text-ink">
              {folio?.customerName ?? guestName}
              {canEdit && folio && (
                <button
                  type="button"
                  onClick={() => setPanel(panel === "customer" ? null : "customer")}
                  className="grid h-6 w-6 place-items-center rounded text-ink-muted hover:bg-shell hover:text-ink"
                  aria-label={tr("Change who this folio is for")}
                  title={tr("Change who this folio is for")}
                >
                  <PencilIcon />
                </button>
              )}
            </p>
            {guestDetails.length > 0 && (!folio?.customerName || folio.customerName === guestName) && (
              <p className="mt-0.5 text-[12px] italic text-ink-muted">{guestDetails.join(", ")}</p>
            )}
            {panel === "customer" && folio && (
              <CustomerSearch
                pending={pending}
                onPick={(id) => run(() => setFolioCustomer({ bookingId, folioId: folio.id, customerId: id }))}
                onCancel={() => setPanel(null)}
              />
            )}
          </div>
          <div className="text-right">
            <p className="text-[14px] text-ink">
              {tr("Status:")} <span className="font-semibold">{isOpen || !folio ? tr("Folio") : tr("Closed")}</span>
            </p>
            {folio && (
              <>
                <p className="mt-2 text-[12px] text-ink-muted">
                  {tr("No:")} <span className="tnum text-ink">{folio.number}</span>
                </p>
                <p className="text-[12px] text-ink-muted">
                  {tr("Date:")} <span className="text-ink">{tr.stamp(folio.openedAt, timezone)}</span>
                </p>
              </>
            )}
          </div>
        </div>

        {viewBy === "date" ? (
          <section>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className={th}>{tr("Date")}</th>
                  <th className={th}>{tr("Title")}</th>
                  <th className={cn(th, "text-right")}>{tr("Net")}</th>
                  <th className={cn(th, "text-right")}>{tr("Taxes")}</th>
                  <th className={cn(th, "text-right")}>{tr("Total")}</th>
                </tr>
              </thead>
              <tbody>
                {byDate.map((l) => (
                  <tr key={l.key} className="border-b border-line">
                    <td className={cn(td, "whitespace-nowrap text-ink-muted")}>{tr.date(l.date, "EEE d MMM yyyy")}</td>
                    <td className={td}>
                      {l.title}
                      {l.note && <span className="ml-2 text-[11px] text-ink-faint">{l.note}</span>}
                    </td>
                    <td className={cn(td, "tnum text-right")}>{formatMoney(l.net, currency)}</td>
                    <td className={cn(td, "tnum text-right")}>{formatMoney(l.tax, currency)}</td>
                    <td className={cn(td, "tnum text-right")}>{formatMoney(l.net + l.tax, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <>
            {/* Accommodation */}
            <section>
              <h3 className="mb-2 text-[15px] font-semibold text-ink">{tr("Accommodation")}</h3>
              {view.rooms.length === 0 ? (
                <p className="text-ink-muted">{tr("No accommodation on this folio.")}</p>
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
                    {view.rooms.map((r) => (
                      <RoomRow
                        key={r.bookingRoomId}
                        room={r}
                        shown={open[r.bookingRoomId] ?? null}
                        onToggle={(what) =>
                          setOpen((o) => ({ ...o, [r.bookingRoomId]: o[r.bookingRoomId] === what ? null : what }))
                        }
                        tickable={mayTick}
                        ticked={tickedRooms.includes(r.bookingRoomId)}
                        onTick={(on) =>
                          setTickedRooms((t) => (on ? [...t, r.bookingRoomId] : t.filter((x) => x !== r.bookingRoomId)))
                        }
                        taxName={taxName}
                      />
                    ))}
                    <tr className="font-semibold">
                      <td className={cn(td, "text-right")} colSpan={2}>{tr("Total")}</td>
                      <td className={cn(td, "tnum text-right")}>{formatMoney(view.accommodationNetCents, currency)}</td>
                      <td className={cn(td, "tnum text-right")}>{formatMoney(accTax, currency)}</td>
                      <td className={cn(td, "tnum text-right")}>{formatMoney(view.accommodationNetCents + accTax, currency)}</td>
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
                      const can = mayTick && tickable(e);
                      return (
                        <tr key={e.folioItemId} className={cn("border-b border-line", e.isReversed && "text-ink-faint line-through")}>
                          <td className={td}>
                            <span className="flex items-start gap-2">
                              {mayTick && !can && <span className="w-3.5 shrink-0" aria-hidden="true" />}
                              {can && (
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-3.5 w-3.5 accent-brass"
                                  checked={tickedItems.includes(e.folioItemId)}
                                  aria-label={tr("Select {name}", { name: tr.message(e.description) })}
                                  onChange={(ev) =>
                                    setTickedItems((t) =>
                                      ev.target.checked ? [...t, e.folioItemId] : t.filter((x) => x !== e.folioItemId),
                                    )
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
                          <td className={cn(td, "tnum text-right", e.isDiscount && "text-emerald-700")}>
                            {formatMoney(e.totalCents, currency)}
                          </td>
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
          </>
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
          )}
        </section>

        <div className="flex flex-wrap items-start justify-between gap-6">
          {/* Folio notes and overlay text, as the reference's two pencils. */}
          <div className="min-w-[14rem] flex-1 text-[12.5px] italic text-ink-muted">
            {panel === "notes" && folio ? (
              <NotesForm
                notes={folio.notes ?? ""}
                overlay={folio.overlayText ?? ""}
                pending={pending}
                onCancel={() => setPanel(null)}
                onSave={(notes, overlayText) =>
                  run(() => setFolioNotes({ bookingId, folioId: folio.id, notes, overlayText }))
                }
              />
            ) : (
              <>
                <p className="flex items-start gap-1.5">
                  <span className="whitespace-pre-line">{folio?.notes || tr("Write Your Folio Notes")}</span>
                  {canCharge && folio && (
                    <button type="button" onClick={() => setPanel("notes")} className="text-ink-muted hover:text-ink"
                      aria-label={tr("Write Your Folio Notes")}>
                      <PencilIcon />
                    </button>
                  )}
                </p>
                <p className="mt-1 flex items-start gap-1.5">
                  <span>{folio?.overlayText || tr("Write Your Folio Overlay Text")}</span>
                  {canCharge && folio && (
                    <button type="button" onClick={() => setPanel("notes")} className="text-ink-muted hover:text-ink"
                      aria-label={tr("Write Your Folio Overlay Text")}>
                      <PencilIcon />
                    </button>
                  )}
                </p>
              </>
            )}
          </div>

          {/* Totals, as the reference: Total, the sub-totals, each tax on its base, Due. */}
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

function RoomRow({
  room: r,
  shown,
  onToggle,
  tickable,
  ticked,
  onTick,
  taxName,
}: {
  room: FolioViewRoom;
  shown: "nights" | "taxes" | null;
  onToggle: (what: "nights" | "taxes") => void;
  tickable: boolean;
  ticked: boolean;
  onTick: (on: boolean) => void;
  taxName: (id: string | null) => string;
}) {
  const tr = useT();
  const currency = useCurrency();
  const details = [r.roomNumber ? tr("Room: {n}", { n: r.roomNumber }) : tr("No room assigned"), r.ratePlan]
    .filter(Boolean)
    .join(", ");
  return (
    <Fragment>
      <tr className="border-b border-line">
        <td className={td}>
          <span className="flex items-start gap-2">
            {tickable && (
              <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 accent-brass"
                checked={ticked}
                aria-label={tr("Select {name}", { name: r.roomType })}
                onChange={(e) => onTick(e.target.checked)}
              />
            )}
            <span>
              <span className="text-ink">
                {r.roomType} <span className="text-ink-muted">({details})</span>
              </span>
              {r.discounted && (
                <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10.5px] text-emerald-700">{tr("Discount")}</span>
              )}
              <span className="mt-0.5 flex gap-3 text-[12px]">
                <button type="button" onClick={() => onToggle("nights")} className="text-brass hover:underline">
                  {tr("Nights breakdown")} {shown === "nights" ? "▴" : "▾"}
                </button>
                <button type="button" onClick={() => onToggle("taxes")} className="text-brass hover:underline">
                  {tr("Tax breakdown")} {shown === "taxes" ? "▴" : "▾"}
                </button>
              </span>
            </span>
          </span>
          {shown === "nights" && (
            <table className="ml-5 mt-2 w-full max-w-md text-[12px]">
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
            <table className="ml-5 mt-2 w-full max-w-xs text-[12px]">
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
}

/** Add discount: one from Inventory -> Discounts, or the desk's own. */
function DiscountPanel({
  pending,
  onApply,
  onCancel,
}: {
  pending: boolean;
  onApply: (d: { percentBps: number | null; amountCents: number | null; description: string }) => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const currency = useCurrency();
  const [catalog, setCatalog] = useState<Discount[] | null>(null);
  const [choice, setChoice] = useState<string>("custom");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let live = true;
    loadDiscounts().then((r) => {
      if (!live) return;
      if (r.ok) {
        setCatalog(r.data);
        if (r.data.length > 0) setChoice(r.data[0].id);
      } else setProblem(r.error);
    });
    return () => {
      live = false;
    };
  }, []);

  const picked = catalog?.find((d) => d.id === choice) ?? null;

  function apply() {
    setProblem("");
    if (picked) {
      return onApply({
        percentBps: picked.kind === "percent" ? picked.percentBps : null,
        amountCents: picked.kind === "fixed" ? picked.amountCents : null,
        description: description.trim() || picked.title,
      });
    }
    if (kind === "percent") {
      const bps = parsePercentBps(value);
      if (bps === null || bps < 1 || bps > 10000) return setProblem(tr("A percentage discount is between 0.01 and 100"));
      return onApply({ percentBps: bps, amountCents: null, description: description.trim() || tr("Discount") });
    }
    let cents: number;
    try {
      cents = parseMoney(value);
    } catch {
      return setProblem(tr("That is not an amount. Try 120 or 120.50."));
    }
    if (!(cents > 0)) return setProblem(tr("A discount must be more than zero"));
    onApply({ percentBps: null, amountCents: cents, description: description.trim() || tr("Discount") });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-line bg-shell/60 px-4 py-3 text-[12.5px]">
      <label className="text-ink-muted">
        {tr("Discount")}
        <select value={choice} onChange={(e) => setChoice(e.target.value)} className={cn(field, "mt-1 block")}>
          {(catalog ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.title} ({d.kind === "percent" ? `${(d.percentBps ?? 0) / 100}%` : formatMoney(d.amountCents ?? 0, currency)})
            </option>
          ))}
          <option value="custom">{tr("Custom")}</option>
        </select>
      </label>
      {!picked && (
        <>
          <label className="text-ink-muted">
            {tr("Type")}
            <select value={kind} onChange={(e) => setKind(e.target.value === "fixed" ? "fixed" : "percent")}
              className={cn(field, "mt-1 block")}>
              <option value="percent">{tr("Percent")}</option>
              <option value="fixed">{tr("Fixed")}</option>
            </select>
          </label>
          <label className="text-ink-muted">
            {tr("Amount")}
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus
              placeholder={kind === "percent" ? "10" : "0.00"} className={cn(field, "tnum mt-1 block w-24")} />
          </label>
        </>
      )}
      <label className="text-ink-muted">
        {tr("Description")}
        <input value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)}
          placeholder={picked?.title ?? tr("Discount")} className={cn(field, "mt-1 block w-48")} />
      </label>
      <span className="flex gap-2">
        <button type="button" onClick={onCancel} className="rounded border border-line bg-white px-3 py-1.5">
          {tr("Cancel")}
        </button>
        <button type="button" disabled={pending} onClick={apply}
          className="rounded bg-chrome-800 px-3 py-1.5 font-medium text-white hover:bg-chrome-900 disabled:opacity-60">
          {tr("Apply discount")}
        </button>
      </span>
      {problem && <p role="alert" className="w-full text-rose-700">{problem}</p>}
    </div>
  );
}

/** The "Folio For" pencil: bill this folio to another guest or a company. */
function CustomerSearch({
  pending,
  onPick,
  onCancel,
}: {
  pending: boolean;
  onPick: (customerId: string) => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string; detail: string }[]>([]);
  const newest = useRef(0);

  useEffect(() => {
    const ask = ++newest.current;
    const t = window.setTimeout(() => {
      searchCustomers(q).then((r) => {
        if (ask !== newest.current) return;
        setHits(r.ok ? r.data : []);
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <div className="mt-2 w-72 rounded-md border border-line bg-white p-2 shadow-card">
      <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
        placeholder={tr("Search a guest or company")} className={cn(field, "w-full")} />
      <ul className="mt-1 max-h-48 overflow-y-auto">
        {hits.map((h) => (
          <li key={h.id}>
            <button type="button" disabled={pending} onClick={() => onPick(h.id)}
              className="block w-full rounded px-2 py-1 text-left text-[12.5px] hover:bg-shell">
              <span className="text-ink">{h.name}</span>
              <span className="block text-[11px] text-ink-muted">{h.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onCancel} className="mt-1 text-[12px] text-ink-muted hover:text-ink">
        {tr("Cancel")}
      </button>
    </div>
  );
}

function NotesForm({
  notes,
  overlay,
  pending,
  onSave,
  onCancel,
}: {
  notes: string;
  overlay: string;
  pending: boolean;
  onSave: (notes: string, overlay: string) => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const [n, setN] = useState(notes);
  const [o, setO] = useState(overlay);
  return (
    <div className="space-y-2 not-italic">
      <label className="block text-[12px] text-ink-muted">
        {tr("Folio Notes")}
        <textarea value={n} maxLength={2000} rows={3} onChange={(e) => setN(e.target.value)} autoFocus
          className={cn(field, "mt-1 block w-full")} />
      </label>
      <label className="block text-[12px] text-ink-muted">
        {tr("Folio Overlay Text")}
        <input value={o} maxLength={200} onChange={(e) => setO(e.target.value)} className={cn(field, "mt-1 block w-full")} />
      </label>
      <span className="flex gap-2">
        <button type="button" onClick={onCancel} className="rounded border border-line bg-white px-3 py-1.5 text-[12.5px]">
          {tr("Cancel")}
        </button>
        <button type="button" disabled={pending} onClick={() => onSave(n, o)}
          className="rounded bg-chrome-800 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-chrome-900 disabled:opacity-60">
          {tr("Save")}
        </button>
      </span>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z" />
    </svg>
  );
}
