"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Card, cn } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";
import type {
  Booking,
  PaidOut,
  PaidOutCategory,
  PaymentMethod,
  Shift,
  ShiftPayment,
} from "@/lib/types";

const CATEGORIES: { key: PaidOutCategory; label: string }[] = [
  { key: "taxi", label: "Taxi" },
  { key: "guest_purchase", label: "Guest purchase" },
  { key: "medical", label: "Medical" },
  { key: "supplies", label: "Supplies" },
  { key: "staff_advance", label: "Staff advance" },
  { key: "other", label: "Other" },
];

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
  initialShift,
  methods,
  payableBookings,
}: {
  initialShift: Shift;
  methods: PaymentMethod[];
  payableBookings: Booking[];
}) {
  const [shift, setShift] = useState<Shift>(initialShift);
  const [modal, setModal] = useState<null | "payment" | "paidout" | "close">(null);
  const [closed, setClosed] = useState<{
    declared: number;
    expected: number;
  } | null>(null);

  const totals = useMemo(() => {
    const drawerIn = shift.payments
      .filter((p) => p.affectsDrawer)
      .reduce((s, p) => s + p.amountCents, 0);
    const allIn = shift.payments.reduce((s, p) => s + p.amountCents, 0);
    const out = shift.paidOuts.reduce((s, p) => s + p.amountCents, 0);
    return {
      drawerIn,
      allIn,
      out,
      expected: shift.openingFloatCents + drawerIn - out,
    };
  }, [shift]);

  const addPayment = (p: ShiftPayment) =>
    setShift((s) => ({ ...s, payments: [p, ...s.payments] }));
  const addPaidOut = (p: PaidOut) =>
    setShift((s) => ({ ...s, paidOuts: [p, ...s.paidOuts] }));

  if (closed) {
    const variance = closed.declared - closed.expected;
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-line bg-white p-8 text-center shadow-sm">
        <h1 className="font-display text-[26px] font-semibold tracking-tightest text-ink">Shift closed</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {shift.userName} · {format(parseISO(shift.businessDate), "d MMM yyyy")}
        </p>
        <dl className="mt-6 space-y-2 text-sm">
          {[
            ["Expected in drawer", formatMoney(closed.expected)],
            ["Counted", formatMoney(closed.declared)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-line pb-2">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="tnum font-medium">{v}</dd>
            </div>
          ))}
          <div className="flex justify-between pt-1">
            <dt className="font-medium">Variance</dt>
            <dd
              className={cn(
                "tnum font-semibold",
                variance === 0 && "text-emerald-600",
                variance !== 0 && "text-rose-600",
              )}
            >
              {variance > 0 ? "+" : ""}
              {formatMoney(variance)}
            </dd>
          </div>
        </dl>
        <p className="mt-6 text-xs leading-relaxed text-ink-faint">
          The next receptionist can now open a shift. This one is locked — no
          payment or paid-out can be posted against it.
        </p>
        <button
          onClick={() => {
            setClosed(null);
            setShift(initialShift);
          }}
          className="mt-6 rounded bg-chrome-800 px-5 py-2 text-sm font-medium text-white hover:bg-chrome-900"
        >
          Open a new shift
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-tightest text-ink">Cashier</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {shift.userName} · opened{" "}
            {format(parseISO(shift.openedAt), "h:mm a")} · business date{" "}
            {format(parseISO(shift.businessDate), "d MMM yyyy")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setModal("payment")}
            className="rounded bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Take payment
          </button>
          <button
            onClick={() => setModal("paidout")}
            className="rounded bg-brass px-4 py-2.5 text-sm font-medium text-white hover:bg-[#9C6F32]"
          >
            Record paid-out
          </button>
          <button
            onClick={() => setModal("close")}
            className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium text-ink hover:bg-shell"
          >
            Close shift
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Opening float"
          value={formatMoney(shift.openingFloatCents)}
        />
        <Stat
          label="Payments taken"
          value={formatMoney(totals.allIn)}
          hint={`${formatMoney(totals.drawerIn)} of it in cash`}
          tone="positive"
        />
        <Stat
          label="Paid out"
          value={formatMoney(totals.out)}
          hint={`${shift.paidOuts.length} transactions`}
          tone="negative"
        />
        <Stat
          label="Expected in drawer"
          value={formatMoney(totals.expected)}
          hint="Cash only — card and UPI excluded"
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Payments this shift">
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
                    {formatMoney(p.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Paid-outs this shift">
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
                        : "house expense"}
                    </p>
                  </td>
                  <td className="tnum px-4 py-2.5 text-right font-medium text-rose-600">
                    −{formatMoney(p.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {modal === "payment" && (
        <PaymentModal
          methods={methods}
          bookings={payableBookings}
          onClose={() => setModal(null)}
          onSave={(p) => {
            addPayment(p);
            setModal(null);
          }}
        />
      )}
      {modal === "paidout" && (
        <PaidOutModal
          bookings={payableBookings}
          onClose={() => setModal(null)}
          onSave={(p) => {
            addPaidOut(p);
            setModal(null);
          }}
        />
      )}
      {modal === "close" && (
        <CloseShiftModal
          expected={totals.expected}
          onCancel={() => setModal(null)}
          onConfirm={(declared) => {
            setClosed({ declared, expected: totals.expected });
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[17px] font-medium">{title}</h2>
          <button
            onClick={onClose}
            className="text-ink-faint hover:text-ink"
            aria-label="Close"
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
  onClose,
  onSave,
}: {
  methods: PaymentMethod[];
  bookings: Booking[];
  onClose: () => void;
  onSave: (p: ShiftPayment) => void;
}) {
  const [bookingId, setBookingId] = useState(bookings[0]?.id ?? "");
  const [methodId, setMethodId] = useState(methods[0].id);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  const booking = bookings.find((b) => b.id === bookingId);

  const submit = () => {
    if (!booking) return setError("Choose a booking first.");
    let cents: number;
    try {
      cents = parseMoney(amount);
    } catch {
      return setError("Enter an amount like 2500 or 2500.50");
    }
    if (cents <= 0) return setError("Amount must be more than zero.");
    const m = methods.find((x) => x.id === methodId)!;
    onSave({
      id: `sp-${Date.now()}`,
      bookingRef: booking.reference,
      guestName: booking.customerName,
      methodId: m.id,
      methodName: m.name,
      affectsDrawer: m.affectsDrawer,
      amountCents: cents,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <Modal title="Take payment" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Booking</label>
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
          {booking && (
            <p className="mt-1 text-xxs text-ink-faint">
              Outstanding balance {formatMoney(booking.balanceCents)}
            </p>
          )}
        </div>

        <div>
          <label className={labelCls}>Method</label>
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
              ? "Cash — this will change the drawer total."
              : "Not cash — recorded against the folio but the drawer is unaffected."}
          </p>
        </div>

        <div>
          <label className={labelCls}>Amount</label>
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
              onClick={() => setAmount(String(booking.balanceCents / 100))}
              className="mt-1.5 text-xxs text-brass hover:underline"
            >
              Use full balance
            </button>
          )}
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded border border-line px-4 py-2 text-sm hover:bg-shell"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Take payment
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PaidOutModal({
  bookings,
  onClose,
  onSave,
}: {
  bookings: Booking[];
  onClose: () => void;
  onSave: (p: PaidOut) => void;
}) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<PaidOutCategory>("taxi");
  const [reason, setReason] = useState("");
  const [payee, setPayee] = useState("");
  const [recharge, setRecharge] = useState(true);
  const [bookingId, setBookingId] = useState(bookings[0]?.id ?? "");
  const [error, setError] = useState("");

  const submit = () => {
    let cents: number;
    try {
      cents = parseMoney(amount);
    } catch {
      return setError("Enter an amount like 450 or 450.00");
    }
    if (cents <= 0) return setError("Amount must be more than zero.");
    if (!reason.trim()) return setError("Say what the money was for.");
    onSave({
      id: `po-${Date.now()}`,
      amountCents: cents,
      category,
      reason: reason.trim(),
      payee: payee.trim() || "—",
      rechargeBookingRef: recharge
        ? (bookings.find((b) => b.id === bookingId)?.reference ?? null)
        : null,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <Modal title="Record paid-out" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Amount</label>
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
            <label className={labelCls}>Category</label>
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
          <label className={labelCls}>What was it for</label>
          <input
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError("");
            }}
            placeholder="Airport transfer for arriving guest"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Paid to</label>
          <input
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="City Cabs"
            className={inputCls}
          />
        </div>

        <div className="rounded border border-line bg-shell p-3">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={recharge}
              onChange={(e) => setRecharge(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brass"
            />
            <span className="text-sm">
              Charge this back to a guest
              <span className="mt-0.5 block text-xxs text-ink-faint">
                Unticked, the hotel absorbs it as a house expense.
              </span>
            </span>
          </label>
          {recharge && (
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
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded bg-brass px-4 py-2 text-sm font-medium text-white hover:bg-[#9C6F32]"
          >
            Record paid-out
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CloseShiftModal({
  expected,
  onCancel,
  onConfirm,
}: {
  expected: number;
  onCancel: () => void;
  onConfirm: (declared: number) => void;
}) {
  const [step, setStep] = useState<"count" | "reveal">("count");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const declared = (() => {
    try {
      return parseMoney(counted);
    } catch {
      return NaN;
    }
  })();
  const variance = declared - expected;
  const needsNote = Math.abs(variance) > 20000; // ₹200

  return (
    <Modal title="Close shift" onClose={onCancel}>
      {step === "count" ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-muted">
            Count the cash in the drawer and enter the total. The expected
            figure stays hidden until you have — a blind count is the only way a
            real discrepancy ever surfaces.
          </p>
          <div>
            <label className={labelCls}>Cash counted</label>
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
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="rounded border border-line px-4 py-2 text-sm hover:bg-shell"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                Number.isNaN(declared)
                  ? setError("Enter the counted total, e.g. 18400")
                  : setStep("reveal")
              }
              className="rounded bg-chrome-800 px-4 py-2 text-sm font-medium text-white hover:bg-chrome-900"
            >
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Expected</dt>
              <dd className="tnum">{formatMoney(expected)}</dd>
            </div>
            <div className="flex justify-between border-b border-line pb-2">
              <dt className="text-ink-muted">Counted</dt>
              <dd className="tnum">{formatMoney(declared)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="font-medium">Variance</dt>
              <dd
                className={cn(
                  "tnum font-semibold",
                  variance === 0 ? "text-emerald-600" : "text-rose-600",
                )}
              >
                {variance > 0 ? "+" : ""}
                {formatMoney(variance)}
              </dd>
            </div>
          </dl>

          {needsNote && (
            <div>
              <label className={labelCls}>
                Explain the variance (required over {formatMoney(20000)})
              </label>
              <textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setError("");
                }}
                rows={3}
                className={inputCls}
                placeholder="Short of ₹300 — suspect an unrecorded taxi paid-out."
              />
            </div>
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setStep("count")}
              className="rounded border border-line px-4 py-2 text-sm hover:bg-shell"
            >
              Back
            </button>
            <button
              onClick={() =>
                needsNote && !note.trim()
                  ? setError("A note is required for this variance.")
                  : onConfirm(declared)
              }
              className="rounded bg-chrome-800 px-4 py-2 text-sm font-medium text-white hover:bg-chrome-900"
            >
              Close shift
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
