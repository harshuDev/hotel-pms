"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useT } from "@/components/i18n";
import { useCurrency } from "@/components/currency";
import { cn } from "@/components/ui";
import { formatMoney, formatMoneyInput, parseMoney } from "@/lib/money";
import {
  cancelPaymentRequest,
  chargeCard,
  createPaymentRequest,
  removeCard,
  saveCard,
  startCardSetup,
  syncPaymentRequests,
} from "@/lib/actions/card-vault";
import type { BookingCard, FolioTabRef, PaymentRequest } from "@/lib/types";

/*
 * The Payment tab's Card Vault and Request payment (0130), as the
 * reference's, through Stripe.
 *
 * A card is typed into Stripe's own frame (PaymentElement) and never touches
 * this page's state, this server or this database: Stripe saves it and hands
 * back an id, a brand and the last four. Charging it, or sending the guest a
 * link to pay, are Server Actions that ask Stripe and then post the payment
 * through Postgres like any other.
 *
 * With no Stripe keys in the environment the sections say so in one line and
 * draw no controls -- nothing here pretends to work.
 */

const field =
  "w-full rounded border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const th = "px-2 pb-1.5 text-left text-[11.5px] font-medium text-ink-muted";
const td = "px-2 py-2 align-top text-[13px]";
const button =
  "rounded border border-line bg-white px-3 py-1.5 text-[13px] text-ink hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const primary =
  "rounded bg-chrome-800 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-60";

const stripes = new Map<string, Promise<StripeJs | null>>();
function stripeFor(key: string) {
  if (!stripes.has(key)) stripes.set(key, loadStripe(key));
  return stripes.get(key)!;
}

function newAttempt(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CardVault({
  bookingId,
  publishableKey,
  cards,
  requests,
  folios,
  dueCents,
  guestName,
  guestEmail,
  timezone,
  canCharge,
}: {
  bookingId: string;
  /** Null when no Stripe account is connected. */
  publishableKey: string | null;
  cards: BookingCard[];
  requests: PaymentRequest[];
  folios: FolioTabRef[];
  /** What the guest owes, to start the amount fields on. */
  dueCents: number;
  guestName: string;
  guestEmail: string | null;
  timezone: string;
  canCharge: boolean;
}) {
  const tr = useT();
  const router = useRouter();
  const synced = useRef(false);

  // Paid or expired at Stripe since the page was drawn? Ask once on arrival.
  useEffect(() => {
    if (synced.current || !publishableKey || !requests.some((r) => r.status === "open")) return;
    synced.current = true;
    syncPaymentRequests(bookingId).then((r) => {
      if (r.ok && r.data.changed > 0) router.refresh();
    });
  }, [bookingId, publishableKey, requests, router]);

  if (!publishableKey) {
    return (
      <div className="mt-6 rounded-lg border border-line bg-white p-5 shadow-card">
        <h2 className="font-display text-[19px] font-medium tracking-tightest text-ink">{tr("Card Vault")}</h2>
        <p className="mt-2 text-[12.5px] text-ink-muted">
          {tr("Card payments need a Stripe account connected to this system.")}
        </p>
      </div>
    );
  }

  const openFolios = folios.filter((f) => f.status === "open");
  return (
    <>
      <Vault
        bookingId={bookingId}
        publishableKey={publishableKey}
        cards={cards}
        openFolios={openFolios}
        dueCents={dueCents}
        guestName={guestName}
        canCharge={canCharge}
      />
      <Requests
        bookingId={bookingId}
        requests={requests}
        openFolios={openFolios}
        dueCents={dueCents}
        guestEmail={guestEmail}
        timezone={timezone}
        canCharge={canCharge}
      />
    </>
  );
}

function FolioPick({
  folios,
  value,
  onChange,
}: {
  folios: FolioTabRef[];
  value: string;
  onChange: (v: string) => void;
}) {
  const tr = useT();
  if (folios.length <= 1) return null;
  return (
    <label className="text-[12px] text-ink-muted">
      {tr("Folio")}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(field, "mt-1")}>
        {folios.map((f) => (
          <option key={f.id} value={f.id}>
            {tr("Folio #{n}", { n: f.number })}
            {f.customerName ? ` · ${f.customerName}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function amountOf(text: string): number | null {
  try {
    const c = parseMoney(text);
    return c > 0 ? c : null;
  } catch {
    return null;
  }
}

function centsText(cents: number): string {
  return cents > 0 ? (cents / 100).toFixed(2) : "";
}

/* ---------------------------------------------------------------------------
 * Card Vault
 * ------------------------------------------------------------------------- */

function Vault({
  bookingId,
  publishableKey,
  cards,
  openFolios,
  dueCents,
  guestName,
  canCharge,
}: {
  bookingId: string;
  publishableKey: string;
  cards: BookingCard[];
  openFolios: FolioTabRef[];
  dueCents: number;
  guestName: string;
  canCharge: boolean;
}) {
  const tr = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [setup, setSetup] = useState<{ clientSecret: string; setupIntentId: string } | null>(null);
  const [charging, setCharging] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  function addCard() {
    setProblem("");
    start(async () => {
      const r = await startCardSetup(bookingId);
      if (!r.ok) return setProblem(r.error);
      setSetup(r.data);
    });
  }

  return (
    <div className="mt-6 rounded-lg border border-line bg-white p-5 shadow-card">
      <h2 className="mb-3 font-display text-[19px] font-medium tracking-tightest text-ink">{tr("Card Vault")}</h2>

      {cards.length === 0 && !setup && (
        <p className="text-[12.5px] text-ink-muted">{tr("No card saved for this booking.")}</p>
      )}

      {cards.length > 0 && (
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>{tr("Card")}</th>
              <th className={th}>{tr("Cardholder")}</th>
              <th className={th}>{tr("Expires")}</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id} className="border-b border-line">
                <td className={td}>
                  <span className="capitalize">{c.brand ?? tr("Card")}</span>{" "}
                  <span className="tnum text-ink-muted">•••• {c.last4 ?? "----"}</span>
                </td>
                <td className={td}>{c.holderName ?? "—"}</td>
                <td className={cn(td, "tnum")}>
                  {c.expMonth && c.expYear ? `${String(c.expMonth).padStart(2, "0")}/${String(c.expYear).slice(-2)}` : "—"}
                </td>
                <td className={cn(td, "whitespace-nowrap text-right")}>
                  {canCharge && (
                    <span className="inline-flex gap-3">
                      <button type="button" onClick={() => { setRemoving(null); setCharging(charging === c.id ? null : c.id); }}
                        className="text-[12.5px] text-brass hover:underline">
                        {tr("Charge")}
                      </button>
                      <button type="button" onClick={() => { setCharging(null); setRemoving(removing === c.id ? null : c.id); }}
                        className="text-[12.5px] text-ink-muted hover:text-rose-700">
                        {tr("Remove")}
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {removing && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px]">
          {tr("Remove this card from the vault? It is deleted at Stripe too.")}
          <button type="button" disabled={pending}
            onClick={() => start(async () => {
              const r = await removeCard({ bookingId, cardId: removing });
              if (!r.ok) return setProblem(r.error);
              setRemoving(null);
              router.refresh();
            })}
            className="rounded bg-rose-600 px-2.5 py-1 font-semibold text-white disabled:opacity-60">
            {tr("Remove")}
          </button>
          <button type="button" onClick={() => setRemoving(null)} className="rounded border border-line bg-white px-2.5 py-1">
            {tr("Cancel")}
          </button>
        </div>
      )}

      {charging && (
        <ChargeForm
          key={charging}
          bookingId={bookingId}
          cardId={charging}
          openFolios={openFolios}
          dueCents={dueCents}
          guestName={guestName}
          onDone={() => { setCharging(null); router.refresh(); }}
          onCancel={() => setCharging(null)}
        />
      )}

      {setup && (
        <Elements
          stripe={stripeFor(publishableKey)}
          options={{ clientSecret: setup.clientSecret, appearance: { theme: "stripe" } }}
        >
          <AddCardForm
            bookingId={bookingId}
            setupIntentId={setup.setupIntentId}
            guestName={guestName}
            onDone={() => { setSetup(null); router.refresh(); }}
            onCancel={() => setSetup(null)}
          />
        </Elements>
      )}

      {problem && <p role="alert" className="mt-2 text-[12.5px] text-rose-700">{problem}</p>}

      {canCharge && !setup && (
        <button type="button" onClick={addCard} disabled={pending} className={cn(button, "mt-3 inline-flex items-center gap-1.5")}>
          <span aria-hidden="true">+</span> {tr("Add card")}
        </button>
      )}
    </div>
  );
}

function AddCardForm({
  bookingId,
  setupIntentId,
  guestName,
  onDone,
  onCancel,
}: {
  bookingId: string;
  setupIntentId: string;
  guestName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const stripe = useStripe();
  const elements = useElements();
  const [holder, setHolder] = useState(guestName);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function save() {
    if (!stripe || !elements) return;
    setProblem("");
    setBusy(true);
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: { payment_method_data: { billing_details: { name: holder.trim() || undefined } } },
    });
    if (error) {
      setBusy(false);
      return setProblem(error.message ?? tr("The card was not saved at the payment gateway"));
    }
    const r = await saveCard({ bookingId, setupIntentId: setupIntent?.id ?? setupIntentId, holderName: holder });
    setBusy(false);
    if (!r.ok) return setProblem(r.error);
    onDone();
  }

  return (
    <div className="mt-3 rounded-md border border-line bg-shell/60 p-3">
      <label className="mb-3 block text-[12px] text-ink-muted">
        {tr("Cardholder")}
        <input value={holder} maxLength={200} onChange={(e) => setHolder(e.target.value)} className={cn(field, "mt-1 max-w-sm")} />
      </label>
      <PaymentElement options={{ layout: "tabs" }} />
      {problem && <p role="alert" className="mt-2 text-[12.5px] text-rose-700">{problem}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={button}>{tr("Cancel")}</button>
        <button type="button" onClick={save} disabled={busy || !stripe || !elements} className={primary}>
          {busy ? tr("Saving…") : tr("Save card")}
        </button>
      </div>
    </div>
  );
}

function ChargeForm({
  bookingId,
  cardId,
  openFolios,
  dueCents,
  guestName,
  onDone,
  onCancel,
}: {
  bookingId: string;
  cardId: string;
  openFolios: FolioTabRef[];
  dueCents: number;
  guestName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const currency = useCurrency();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(centsText(dueCents));
  const [folioId, setFolioId] = useState(openFolios.find((f) => f.isPrimary)?.id ?? openFolios[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState("");
  // One attempt per form: pressing Charge again after a failure to record
  // asks Stripe for the same payment rather than a second one.
  const [attemptId] = useState(newAttempt);

  function charge() {
    setProblem("");
    const cents = amountOf(amount);
    if (cents === null) return setProblem(tr("That is not an amount. Try 120 or 120.50."));
    start(async () => {
      const r = await chargeCard({
        bookingId,
        cardId,
        folioId: folioId || null,
        amountCents: cents,
        description: description.trim() || tr("Card Vault"),
        payerName: guestName,
        attemptId,
      });
      if (!r.ok) return setProblem(r.error);
      onDone();
    });
  }

  const cents = amountOf(amount);
  return (
    <div className="mt-3 rounded-md border border-line bg-shell/60 p-3">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr]">
        <label className="text-[12px] text-ink-muted">
          {tr("Amount")}
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus
            placeholder={formatMoneyInput(0, currency)} className={cn(field, "tnum mt-1")} />
        </label>
        <label className="text-[12px] text-ink-muted">
          {tr("Description")}
          <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} className={cn(field, "mt-1")} />
        </label>
        <FolioPick folios={openFolios} value={folioId} onChange={setFolioId} />
      </div>
      {problem && <p role="alert" className="mt-2 text-[12.5px] text-rose-700">{problem}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={button}>{tr("Cancel")}</button>
        <button type="button" onClick={charge} disabled={pending} className={primary}>
          {pending ? tr("Charging…") : cents ? tr("Charge {amount}", { amount: formatMoney(cents, currency) }) : tr("Charge")}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Request payment
 * ------------------------------------------------------------------------- */

const STATUS_STYLE: Record<PaymentRequest["status"], string> = {
  open: "bg-warn-wash text-warn-deep",
  paid: "bg-emerald-50 text-emerald-700",
  expired: "bg-shell text-ink-muted",
  canceled: "bg-shell text-ink-muted",
};

function Requests({
  bookingId,
  requests,
  openFolios,
  dueCents,
  guestEmail,
  timezone,
  canCharge,
}: {
  bookingId: string;
  requests: PaymentRequest[];
  openFolios: FolioTabRef[];
  dueCents: number;
  guestEmail: string | null;
  timezone: string;
  canCharge: boolean;
}) {
  const tr = useT();
  const currency = useCurrency();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState(centsText(dueCents));
  const [folioId, setFolioId] = useState(openFolios.find((f) => f.isPrimary)?.id ?? openFolios[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const label: Record<PaymentRequest["status"], string> = {
    open: tr("Waiting"),
    paid: tr("Paid"),
    expired: tr("Expired"),
    canceled: tr("Cancelled"),
  };

  function create() {
    setProblem("");
    const cents = amountOf(amount);
    if (cents === null) return setProblem(tr("That is not an amount. Try 120 or 120.50."));
    start(async () => {
      const r = await createPaymentRequest({
        bookingId,
        folioId: folioId || null,
        amountCents: cents,
        description: description.trim(),
      });
      if (!r.ok) return setProblem(r.error);
      setAdding(false);
      setDescription("");
      router.refresh();
    });
  }

  function copy(r: PaymentRequest) {
    navigator.clipboard?.writeText(r.url).then(() => {
      setCopied(r.id);
      window.setTimeout(() => setCopied((c) => (c === r.id ? null : c)), 2000);
    });
  }

  function mailto(r: PaymentRequest): string {
    const subject = tr("Payment request");
    const body = `${r.description ? `${r.description}\n\n` : ""}${r.url}`;
    return `mailto:${encodeURIComponent(guestEmail ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <div className="mt-6 rounded-lg border border-line bg-white p-5 shadow-card">
      <h2 className="mb-3 font-display text-[19px] font-medium tracking-tightest text-ink">{tr("Payment requests")}</h2>

      {requests.length === 0 && !adding && (
        <p className="text-[12.5px] text-ink-muted">{tr("No payment requested yet.")}</p>
      )}

      {requests.length > 0 && (
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>{tr("Date")}</th>
              <th className={th}>{tr("Description")}</th>
              <th className={th}>{tr("Status")}</th>
              <th className={cn(th, "text-right")}>{tr("Amount")}</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-line">
                <td className={cn(td, "whitespace-nowrap")}>{tr.stamp(r.createdAt, timezone)}</td>
                <td className={td}>{r.description ?? "—"}</td>
                <td className={td}>
                  <span className={cn("rounded px-1.5 py-0.5 text-xxs font-medium", STATUS_STYLE[r.status])}>{label[r.status]}</span>
                </td>
                <td className={cn(td, "tnum whitespace-nowrap text-right")}>{formatMoney(r.amountCents, r.currency)}</td>
                <td className={cn(td, "whitespace-nowrap text-right")}>
                  {r.status === "open" && (
                    <span className="inline-flex gap-3 text-[12.5px]">
                      <button type="button" onClick={() => copy(r)} className="text-brass hover:underline">
                        {copied === r.id ? tr("Copied") : tr("Copy link")}
                      </button>
                      <a href={mailto(r)} className="text-brass hover:underline">{tr("Send")}</a>
                      {canCharge && (
                        <button type="button" disabled={pending}
                          onClick={() => start(async () => {
                            const res = await cancelPaymentRequest({ bookingId, requestId: r.id });
                            if (!res.ok) return setProblem(res.error);
                            router.refresh();
                          })}
                          className="text-ink-muted hover:text-rose-700">
                          {tr("Cancel")}
                        </button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding && (
        <div className="mt-3 rounded-md border border-line bg-shell/60 p-3">
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr]">
            <label className="text-[12px] text-ink-muted">
              {tr("Amount")}
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus
                placeholder={formatMoneyInput(0, currency)} className={cn(field, "tnum mt-1")} />
            </label>
            <label className="text-[12px] text-ink-muted">
              {tr("Description")}
              <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} className={cn(field, "mt-1")} />
            </label>
            <FolioPick folios={openFolios} value={folioId} onChange={setFolioId} />
          </div>
          {problem && <p role="alert" className="mt-2 text-[12.5px] text-rose-700">{problem}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setProblem(""); }} className={button}>{tr("Cancel")}</button>
            <button type="button" onClick={create} disabled={pending} className={primary}>
              {pending ? tr("Saving…") : tr("Create payment link")}
            </button>
          </div>
        </div>
      )}

      {!adding && problem && <p role="alert" className="mt-2 text-[12.5px] text-rose-700">{problem}</p>}

      {canCharge && !adding && (
        <button type="button" onClick={() => setAdding(true)} className={cn(button, "mt-3 inline-flex items-center gap-1.5")}>
          <span aria-hidden="true">+</span> {tr("Request payment")}
        </button>
      )}
    </div>
  );
}
