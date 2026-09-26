"use client";

import { useT } from "@/components/i18n";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Card, cn } from "@/components/ui";
import { formatMoney, formatMoneyInput, parseMoney } from "@/lib/money";
import {
  closeShift,
  openShift,
  recordPaidOut,
  takePayment,
} from "@/lib/actions/cashier";
import type {
  Booking,
  PaidOutCategory,
  PaymentMethod,
  Shift,
} from "@/lib/types";
import { useCurrency } from "@/components/currency";

const CATEGORIES: { key: PaidOutCategory; label: string }[] = [
  { key: "taxi", label: "Taxi" },
  { key: "guest_purchase", label: "Guest purchase" },
  { key: "medical", label: "Medical" },
  { key: "supplies", label: "Supplies" },
  { key: "staff_advance", label: "Staff advance" },
  { key: "other", label: "Other" },
];

/** A variance past this gets called out on the closing receipt. */
const LARGE_VARIANCE_CENTS = 20000;

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative";
}) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <p className="text-xxs uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={cn(
          "tnum mt-1 text-xl font-semibold",
          tone === "positive" && "text-emerald-600",
          tone === "negative" && "text-rose-600",
          tone === "default" && "text-ink",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xxs text-ink-faint">{hint}</p>}
    </div>
  );
}

export function CashierClient({
  shift,
  methods,
  payableBookings,
  businessDate,
  suggestedFloatCents,
  canSeeExpected,
}: {
  shift: Shift | null;
  methods: PaymentMethod[];
  payableBookings: Booking[];
  businessDate: string;
  suggestedFloatCents: number | null;
  canSeeExpected: boolean;
}) {
  const tr = useT();
  const currency = useCurrency();
  const [modal, setModal] = useState<null | "payment" | "paidout" | "close">(
    null,
  );
  const [closed, setClosed] = useState<{
    counted: number;
    expected: number;
    variance: number;
  } | null>(null);

  const totals = useMemo(() => {
    if (!shift) return { drawerIn: 0, allIn: 0, out: 0, expected: 0 };

    const drawerIn = shift.payments
      .filter((p) => p.affectsDrawer)
      .reduce((s, p) => s + p.amountCents, 0);
    const allIn = shift.payments.reduce((s, p) => s + p.amountCents, 0);
    const out = shift.paidOuts.reduce((s, p) => s + p.amountCents, 0);

    // A running figure from what is on this screen. The authoritative number
    // comes from the database when the shift closes, and also counts cash
    // drops and adjustments, which this screen cannot create.
    return {
      drawerIn,
      allIn,
      out,
      expected: shift.openingFloatCents + drawerIn - out,
    };
  }, [shift]);

  if (closed) {
    return (
      <ClosedReceipt
        closed={closed}
        onOpenAnother={() => setClosed(null)}
      />
    );
  }

  if (!shift) {
    return (
      <OpenShiftPanel
        businessDate={businessDate}
        suggestedFloatCents={suggestedFloatCents}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-tightest text-ink">
            {tr("Cashier")}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {shift.userName} {tr("· opened")}{" "}
            {format(parseISO(shift.openedAt), "h:mm a")} {tr("· business date")}{" "}
            {format(parseISO(shift.businessDate), "d MMM yyyy")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setModal("payment")}
            className="rounded bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {tr("Take payment")}
          </button>
          <button
            onClick={() => setModal("paidout")}
            className="rounded bg-brass px-4 py-2.5 text-sm font-medium text-white hover:bg-[#9C6F32]"
          >
            {tr("Record paid-out")}
          </button>
          <button
            onClick={() => setModal("close")}
            className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium text-ink hover:bg-shell"
          >
            {tr("Close shift")}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={tr("Opening float")}
          value={formatMoney(shift.openingFloatCents, currency)}
        />
        <Stat
          label={tr("Payments taken")}
          value={formatMoney(totals.allIn, currency)}
          hint={`${formatMoney(totals.drawerIn, currency)} of it in cash`}
          tone="positive"
        />
        <Stat
          label={tr("Paid out")}
          value={formatMoney(totals.out, currency)}
          hint={`${shift.paidOuts.length} transactions`}
          tone="negative"
        />
        <Stat
          label={tr("Expected in drawer")}
          value={canSeeExpected ? formatMoney(totals.expected, currency) : "—"}
          hint={
            canSeeExpected
              ? tr("Cash only — non-cash payments excluded")
              : tr("You count it blind; the figure appears at close")
          }
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card title={tr("Payments this shift")}>
          {shift.payments.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
              {tr("No payments yet. Take one with the button above.")}
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-line">
                {shift.payments.map((p) => (
                  <tr key={p.id} className="hover:bg-shell">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{p.guestName}</p>
                      <p className="text-xxs text-ink-faint">{p.bookingRef}</p>
                    </td>
                    <td className="px-2 py-2.5">
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
                    <td className="tnum px-4 py-2.5 text-right font-medium text-ink">
                      {formatMoney(p.amountCents, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title={tr("Paid-outs this shift")}>
          {shift.paidOuts.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
              {tr("Nothing has left the drawer this shift.")}
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-line">
                {shift.paidOuts.map((p) => (
                  <tr key={p.id} className="hover:bg-shell">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{p.reason}</p>
                      <p className="text-xxs text-ink-faint">
                        {p.payee} ·{" "}
                        {p.rechargeBookingRef
                          ? `recharged to ${p.rechargeBookingRef}`
                          : tr("house expense")}
                      </p>
                    </td>
                    <td className="tnum px-4 py-2.5 text-right font-medium text-rose-600">
                      −{formatMoney(p.amountCents, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {modal === "payment" && (
        <PaymentModal
          methods={methods}
          bookings={payableBookings}
          shiftId={shift.id}
          businessDate={shift.businessDate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "paidout" && (
        <PaidOutModal
          bookings={payableBookings}
          shiftId={shift.id}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "close" && (
        <CloseShiftModal
          shiftId={shift.id}
          onCancel={() => setModal(null)}
          onClosed={(result) => {
            setClosed(result);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ClosedReceipt({
  closed,
  onOpenAnother,
}: {
  closed: { counted: number; expected: number; variance: number };
  onOpenAnother: () => void;
}) {
  const tr = useT();
  const currency = useCurrency();
  const large = Math.abs(closed.variance) > LARGE_VARIANCE_CENTS;

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-line bg-white p-8 text-center shadow-sm">
      <h1 className="font-display text-[26px] font-semibold tracking-tightest text-ink">
        {tr("Shift closed")}
      </h1>
      <dl className="mt-6 space-y-2 text-sm">
        {[
          ["Expected in drawer", formatMoney(closed.expected, currency)],
          ["Counted", formatMoney(closed.counted, currency)],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line pb-2">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="tnum font-medium">{v}</dd>
          </div>
        ))}
        <div className="flex justify-between pt-1">
          <dt className="font-medium">{tr("Variance")}</dt>
          <dd
            className={cn(
              "tnum font-semibold",
              closed.variance === 0 && "text-emerald-600",
              closed.variance !== 0 && "text-rose-600",
            )}
          >
            {closed.variance > 0 ? "+" : ""}
            {formatMoney(closed.variance, currency)}
          </dd>
        </div>
      </dl>

      {large && (
        <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
          {tr("That is over")}{" "}{formatMoney(LARGE_VARIANCE_CENTS, currency)} {tr("out. A manager should look at this shift before the drawer is used again.")}
        </p>
      )}

      <p className="mt-6 text-xs leading-relaxed text-ink-faint">
        {tr("The next receptionist can now open a shift.")}
      </p>
      <button
        onClick={onOpenAnother}
        className="mt-6 rounded bg-chrome-800 px-5 py-2 text-sm font-medium text-white hover:bg-chrome-900"
      >
        {tr("Open a new shift")}
      </button>
    </div>
  );
}

function OpenShiftPanel({
  businessDate,
  suggestedFloatCents,
}: {
  businessDate: string;
  suggestedFloatCents: number | null;
}) {
  const tr = useT();
  const currency = useCurrency();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [float, setFloat] = useState(
    suggestedFloatCents === null ? "" : formatMoneyInput(suggestedFloatCents),
  );
  const [error, setError] = useState("");

  const submit = () => {
    let cents: number;
    try {
      cents = parseMoney(float);
    } catch {
      return setError(tr("Enter the float like 500 or 500.00"));
    }
    if (cents < 0) return setError(tr("The float cannot be negative."));

    startTransition(async () => {
      const result = await openShift(cents);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-line bg-white p-8 shadow-sm">
      <h1 className="font-display text-[26px] font-semibold tracking-tightest text-ink">
        {tr("Open a shift")}
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        {tr("Business date")}{" "}{format(parseISO(businessDate), "d MMM yyyy")}{tr(". Nothing can be taken or paid out until a shift is open.")}
      </p>

      <div className="mt-6">
        <label className={labelCls}>{tr("Opening float")}</label>
        <input
          value={float}
          onChange={(e) => {
            setFloat(e.target.value);
            setError("");
          }}
          placeholder="0.00"
          inputMode="decimal"
          autoFocus
          className={cn(inputCls, "tnum text-lg")}
        />
        <p className="mt-1.5 text-xxs text-ink-faint">
          {suggestedFloatCents === null
            ? tr("Count the float into the drawer and enter the total.")
            : `The last shift opened at ${formatMoney(suggestedFloatCents, currency)}.`}
        </p>
      </div>

      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

      <button
        onClick={submit}
        disabled={pending}
        className="mt-6 w-full rounded bg-chrome-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-chrome-900 disabled:opacity-60"
      >
        {pending ? tr("Opening…") : tr("Open shift")}
      </button>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const tr = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[17px] font-medium">{title}</h2>
          <button
            onClick={onClose}
            className="text-ink-faint hover:text-ink"
            aria-label={tr("Close")}
          >
            ✕
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded border border-line px-3 py-2 text-sm placeholder:text-ink-faint";
const labelCls = "mb-1 block text-xs font-medium text-ink-muted";

function PaymentModal({
  methods,
  bookings,
  shiftId,
  businessDate,
  onClose,
}: {
  methods: PaymentMethod[];
  bookings: Booking[];
  shiftId: string;
  businessDate: string;
  onClose: () => void;
}) {
  const tr = useT();
  const currency = useCurrency();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [bookingId, setBookingId] = useState(bookings[0]?.id ?? "");
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  const booking = bookings.find((b) => b.id === bookingId);

  const submit = () => {
    if (!booking) return setError(tr("Choose a booking first."));
    if (!methodId) return setError(tr("Choose a payment method."));
    let cents: number;
    try {
      cents = parseMoney(amount);
    } catch {
      return setError(tr("Enter an amount like 2500 or 2500.50"));
    }
    if (cents <= 0) return setError(tr("Amount must be more than zero."));

    startTransition(async () => {
      const result = await takePayment({
        bookingId: booking.id,
        paymentMethodId: methodId,
        amountCents: cents,
        businessDate,
        shiftId,
      });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  };

  return (
    <Modal title={tr("Take payment")} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>{tr("Booking")}</label>
          {bookings.length === 0 ? (
            <p className="text-[13px] text-ink-muted">
              {tr("No booking has an outstanding balance right now.")}
            </p>
          ) : (
            <select
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
              className={inputCls}
            >
              {bookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.reference} — {b.customerName}
                </option>
              ))}
            </select>
          )}
          {booking && (
            <p className="mt-1 text-xxs text-ink-faint">
              {tr("Outstanding balance")}{" "}{formatMoney(booking.balanceCents, currency)}
            </p>
          )}
        </div>

        <div>
          <label className={labelCls}>{tr("Method")}</label>
          <div className="flex flex-wrap gap-2">
            {methods.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethodId(m.id)}
                className={cn(
                  "rounded border px-3 py-1.5 text-xs",
                  methodId === m.id
                    ? "border-chrome-800 bg-chrome-800 text-white"
                    : "border-line hover:bg-shell",
                )}
              >
                {m.name}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xxs text-ink-faint">
            {methods.find((m) => m.id === methodId)?.affectsDrawer
              ? tr("Cash — this will change the drawer total.")
              : tr("Not cash — recorded against the folio but the drawer is unaffected.")}
          </p>
        </div>

        <div>
          <label className={labelCls}>{tr("Amount")}</label>
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError("");
            }}
            placeholder="0.00"
            inputMode="decimal"
            className={inputCls}
          />
          {booking && (
            <button
              onClick={() => setAmount(formatMoneyInput(booking.balanceCents))}
              className="mt-1.5 text-xxs text-brass hover:underline"
            >
              {tr("Use full balance")}
            </button>
          )}
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded border border-line px-4 py-2 text-sm hover:bg-shell"
          >
            {tr("Cancel")}
          </button>
          <button
            onClick={submit}
            disabled={pending}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? tr("Taking…") : tr("Take payment")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PaidOutModal({
  bookings,
  shiftId,
  onClose,
}: {
  bookings: Booking[];
  shiftId: string;
  onClose: () => void;
}) {
  const tr = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<PaidOutCategory>("taxi");
  const [reason, setReason] = useState("");
  const [payee, setPayee] = useState("");
  const [recharge, setRecharge] = useState(bookings.length > 0);
  const [bookingId, setBookingId] = useState(bookings[0]?.id ?? "");
  const [error, setError] = useState("");

  const submit = () => {
    let cents: number;
    try {
      cents = parseMoney(amount);
    } catch {
      return setError(tr("Enter an amount like 450 or 450.00"));
    }
    if (cents <= 0) return setError(tr("Amount must be more than zero."));
    if (!reason.trim()) return setError(tr("Say what the money was for."));
    if (recharge && !bookingId) {
      return setError(tr("Choose the booking to charge, or untick the box."));
    }

    startTransition(async () => {
      const result = await recordPaidOut({
        shiftId,
        amountCents: cents,
        category,
        reason,
        payee,
        rechargeBookingId: recharge ? bookingId : null,
      });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  };

  return (
    <Modal title={tr("Record paid-out")} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{tr("Amount")}</label>
            <input
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError("");
              }}
              placeholder="0.00"
              inputMode="decimal"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>{tr("Category")}</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as PaidOutCategory)}
              className={inputCls}
            >
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>{tr("What was it for")}</label>
          <input
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError("");
            }}
            placeholder={tr("Airport transfer for arriving guest")}
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>{tr("Paid to")}</label>
          <input
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder={tr("City Cabs")}
            className={inputCls}
          />
        </div>

        <div className="rounded border border-line bg-shell p-3">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={recharge}
              disabled={bookings.length === 0}
              onChange={(e) => setRecharge(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brass"
            />
            <span className="text-sm">
              {tr("Charge this back to a guest")}
              <span className="mt-0.5 block text-xxs text-ink-faint">
                {bookings.length === 0
                  ? tr("No booking has an open balance, so this must be a house expense.")
                  : tr("Unticked, the hotel absorbs it as a house expense.")}
              </span>
            </span>
          </label>
          {recharge && bookings.length > 0 && (
            <select
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
              className={cn(inputCls, "mt-2.5 bg-white")}
            >
              {bookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.reference} — {b.customerName}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded border border-line px-4 py-2 text-sm hover:bg-shell"
          >
            {tr("Cancel")}
          </button>
          <button
            onClick={submit}
            disabled={pending}
            className="rounded bg-brass px-4 py-2 text-sm font-medium text-white hover:bg-[#9C6F32] disabled:opacity-60"
          >
            {pending ? tr("Recording…") : tr("Record paid-out")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The count goes in, the close happens, and only then does the database say
 * what the drawer should have held. There is no step in between where the
 * expected figure could be read, which is the whole point of a blind count.
 */
function CloseShiftModal({
  shiftId,
  onCancel,
  onClosed,
}: {
  shiftId: string;
  onCancel: () => void;
  onClosed: (result: {
    counted: number;
    expected: number;
    variance: number;
  }) => void;
}) {
  const tr = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    let cents: number;
    try {
      cents = parseMoney(counted);
    } catch {
      return setError(tr("Enter the counted total, e.g. 18400"));
    }
    if (cents < 0) return setError(tr("The counted total cannot be negative."));

    startTransition(async () => {
      const result = await closeShift({
        shiftId,
        countedCents: cents,
        notes: note,
      });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClosed({
        counted: cents,
        expected: result.data.expectedCents,
        variance: result.data.varianceCents,
      });
    });
  };

  return (
    <Modal title={tr("Close shift")} onClose={onCancel}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          {tr("Count the cash in the drawer and enter the total.")}
        </p>
        <div>
          <label className={labelCls}>{tr("Cash counted")}</label>
          <input
            value={counted}
            onChange={(e) => {
              setCounted(e.target.value);
              setError("");
            }}
            placeholder="0.00"
            inputMode="decimal"
            autoFocus
            className={cn(inputCls, "tnum text-lg")}
          />
        </div>
        <div>
          <label className={labelCls}>{tr("Note (optional)")}</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className={inputCls}
            placeholder={tr("Anything the next shift or a manager should know.")}
          />
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-line px-4 py-2 text-sm hover:bg-shell"
          >
            {tr("Cancel")}
          </button>
          <button
            onClick={submit}
            disabled={pending}
            className="rounded bg-chrome-800 px-4 py-2 text-sm font-medium text-white hover:bg-chrome-900 disabled:opacity-60"
          >
            {pending ? tr("Closing…") : tr("Close shift")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
