"use client";

import { useT } from "@/components/i18n";
import { msg, type Translator } from "@/lib/i18n/translate";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney, formatMoneyInput, parseMoney } from "@/lib/money";
import { savePromotion } from "@/lib/actions/promotions";
import type { Promotion, PromotionKind, RatePlan } from "@/lib/types";
import { useCurrency } from "@/components/currency";

/** Monday first; the names come from `tr.weekday()`. */
const DOW = [1, 2, 3, 4, 5, 6, 0].map((value) => ({ value }));

const KINDS: { value: PromotionKind; label: string; hint: string }[] = [
  {
    value: "percent_off",
    label: msg("Percentage off"),
    hint: msg("Comes off every night the offer covers."),
  },
  {
    value: "amount_off",
    label: msg("Amount off a night"),
    hint: msg("A fixed sum off each night, never more than the night costs."),
  },
  {
    value: "free_nights",
    label: msg("Stay N, pay M"),
    hint: msg("The cheapest qualifying nights go to zero. Stay 3 pay 2 gives one free night in every three."),
  },
];

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";

const EMPTY = {
  id: null as string | null,
  name: "",
  code: "",
  description: "",
  kind: "percent_off" as PromotionKind,
  percent: "",
  amount: "",
  freeNights: "1",
  paidNights: "2",
  sellFrom: "",
  sellTo: "",
  stayFrom: "",
  stayTo: "",
  minNights: "",
  maxNights: "",
  minAdvanceDays: "",
  maxAdvanceDays: "",
  arrivalDaysOfWeek: [] as number[],
  ratePlanIds: [] as string[],
  roomTypeIds: [] as string[],
  priority: "0",
  isActive: true,
};

/* -------------------------------------------------------------------------- */
/* The cards                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The headline figure on a card, short enough to sit in the artwork band.
 *
 * The poster version of what the offer takes off; the line under the name
 * (`scopeLine()`) says it as a phrase.
 */
function headline(p: Promotion, currency: string, tr: Translator) {
  switch (p.kind) {
    case "percent_off": {
      const pct = (p.percentBps ?? 0) / 100;
      return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
    }
    case "amount_off":
      return formatMoney(p.amountOffCents ?? 0, currency);
    case "free_nights":
      return tr("{n} free", { n: p.freeNights ?? 0 });
  }
}

/** The line under the name: what comes off, and what it comes off. */
function scopeLine(p: Promotion, currency: string, tr: Translator) {
  const off =
    p.kind === "percent_off"
      ? tr("{pct}% Discount", { pct: ((p.percentBps ?? 0) / 100).toFixed(1) })
      : p.kind === "amount_off"
        ? tr("{amount} Discount", { amount: formatMoney(p.amountOffCents ?? 0, currency) })
        : tr("Stay {stay}, pay {pay}", {
            stay: (p.paidNights ?? 0) + (p.freeNights ?? 0),
            pay: p.paidNights ?? 0,
          });
  return `${off}, ${p.roomTypeNames ?? tr("All Rooms")}`;
}

/**
 * The seven squares the reference draws under each offer.
 *
 * They are the arrival days the offer applies to. `arrivalDaysOfWeek` null
 * means no restriction, which is every day filled rather than none — an offer
 * with no weekday rule applies on all of them, and drawing that as seven empty
 * boxes would say the opposite.
 *
 * Monday first, matching the calendar's own week.
 */
function DayBoxes({ days }: { days: number[] | null }) {
  const tr = useT();
  return (
    <span className="flex gap-[3px]" title={
      days && days.length > 0
        ? tr("Arrivals on {days}", { days: days.map((d) => tr.weekday(d)).join(", ") })
        : tr("Arrivals any day")
    }>
      {DOW.map((d) => {
        const on = !days || days.length === 0 || days.includes(d.value);
        return (
          <span
            key={d.value}
            aria-hidden
            className={cn(
              "h-2.5 w-2.5 rounded-[2px]",
              on ? "bg-chrome-700" : "bg-line",
            )}
          />
        );
      })}
    </span>
  );
}

/** The stay window, as the reference prints it: "04 Apr - 30 Jun". */
function dateRange(p: Promotion, tr: Translator) {
  const from = p.stayFrom ?? p.sellFrom;
  const to = p.stayTo ?? p.sellTo;
  if (!from && !to) return tr("Any dates");
  return `${from ? tr.date(from, "dd MMM") : tr("Any")} - ${to ? tr.date(to, "dd MMM") : tr("Any")}`;
}

/**
 * The artwork band.
 *
 * The reference's cards carry uploaded promo graphics. There is no image
 * column and no storage bucket in this project, so rather than half-build an
 * upload path this draws the offer: the discount figure large, on a tint
 * chosen from the offer's own id so a given offer always looks the same and two
 * offers side by side do not. If the hotel wants real artwork later that is a
 * column plus Supabase Storage plus an upload control, and worth asking for.
 */
const TINTS = [
  "from-chrome-800 to-chrome-600",
  "from-brass to-chrome-700",
  "from-chrome-700 to-brass",
  "from-chrome-900 to-chrome-700",
];

function Artwork({ offer, muted }: { offer: Promotion; muted: boolean }) {
  const tr = useT();
  const currency = useCurrency();
  // Deterministic: the same offer keeps the same tint across renders and
  // reloads, which a random pick would not.
  let hash = 0;
  for (const ch of offer.promotionId) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  const tint = TINTS[hash % TINTS.length];

  return (
    <div
      className={cn(
        "flex h-24 items-center justify-center bg-gradient-to-br",
        tint,
        muted && "opacity-50 grayscale",
      )}
    >
      <span className="font-display text-3xl font-semibold tracking-tightest text-white">
        {headline(offer, currency, tr)}
      </span>
    </div>
  );
}

function OfferCard({
  offer,
  canEdit,
  onEdit,
}: {
  offer: Promotion;
  canEdit: boolean;
  onEdit: (p: Promotion) => void;
}) {
  const tr = useT();
  const currency = useCurrency();
  const muted = !offer.isActive;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-line bg-white shadow-card",
        muted && "opacity-90",
      )}
    >
      <Artwork offer={offer} muted={muted} />

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="min-w-0">
          <p className="truncate font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-ink">
            {offer.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">{scopeLine(offer, currency, tr)}</p>
        </div>

        <DayBoxes days={offer.arrivalDaysOfWeek} />

        <div className="flex min-w-0 items-center gap-2 text-xxs text-ink-faint">
          {offer.code ? (
            <span className="tnum shrink-0 rounded bg-chrome-800 px-1.5 py-0.5 font-medium text-white">
              {offer.code}
            </span>
          ) : (
            <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800">
              {tr("Automatic")}
            </span>
          )}
          {/*
            Kept from the old list: what the offer has actually cost. Truncated
            rather than wrapped — wrapping pushed the date range down and left
            the cards in a row at different heights.
          */}
          <span className="tnum truncate whitespace-nowrap">
            {tr.plural(offer.bookingsTaken, "{n} booking", "{n} bookings")}
            {offer.discountGivenCents > 0 &&
              ` · ${formatMoney(offer.discountGivenCents, currency)}`}
          </span>
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <span className="tnum text-xs font-semibold text-ink">
            {dateRange(offer, tr)}
          </span>
          {canEdit && (
            <button
              onClick={() => onEdit(offer)}
              className="rounded-md border border-line px-2.5 py-1 text-xxs text-ink-muted transition hover:bg-shell hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              {tr("Edit")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function OfferSection({
  title,
  offers,
  canEdit,
  onEdit,
  onAdd,
  emptyHint,
  tinted = false,
}: {
  title: string;
  offers: Promotion[];
  canEdit: boolean;
  onEdit: (p: Promotion) => void;
  /** Only the active section offers the Add tile. */
  onAdd?: () => void;
  emptyHint?: string;
  /** The reference sets the inactive section on a wash. */
  tinted?: boolean;
}) {
  const tr = useT();
  return (
    <section
      className={cn(
        "rounded-lg px-4 py-4",
        tinted ? "bg-shell/70" : "bg-transparent px-0",
      )}
    >
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tightest text-ink">
        {title}
      </h2>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
        {offers.map((offer) => (
          <OfferCard
            key={offer.promotionId}
            offer={offer}
            canEdit={canEdit}
            onEdit={onEdit}
          />
        ))}

        {canEdit && onAdd && (
          <button
            onClick={onAdd}
            className="flex min-h-[230px] flex-col items-center justify-center gap-1 rounded-lg border border-brass/40 bg-white text-brass transition hover:border-brass hover:bg-brass/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <span className="text-2xl leading-none">+</span>
            <span className="font-display text-[15px] font-medium tracking-tightest">
              {tr("Add offer")}
            </span>
          </button>
        )}

        {offers.length === 0 && !onAdd && (
          <p className="text-[13px] text-ink-muted">{tr("Nothing here.")}</p>
        )}
      </div>

      {offers.length === 0 && emptyHint && (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">{emptyHint}</p>
      )}
    </section>
  );
}

export function PromotionsScreen({
  promotions,
  ratePlans,
  roomTypes,
  canEdit,
}: {
  promotions: Promotion[];
  ratePlans: RatePlan[];
  roomTypes: { id: string; code: string; name: string }[];
  canEdit: boolean;
}) {
  const tr = useT();
  const currency = useCurrency();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function edit(p: Promotion) {
    setMessage(null);
    setForm({
      id: p.promotionId,
      name: p.name,
      code: p.code ?? "",
      description: p.description ?? "",
      kind: p.kind,
      percent: p.percentBps === null ? "" : String(p.percentBps / 100),
      amount: p.amountOffCents === null ? "" : formatMoneyInput(p.amountOffCents, currency),
      freeNights: String(p.freeNights ?? 1),
      paidNights: String(p.paidNights ?? 2),
      sellFrom: p.sellFrom ?? "",
      sellTo: p.sellTo ?? "",
      stayFrom: p.stayFrom ?? "",
      stayTo: p.stayTo ?? "",
      minNights: p.minNights === null ? "" : String(p.minNights),
      maxNights: p.maxNights === null ? "" : String(p.maxNights),
      minAdvanceDays: p.minAdvanceDays === null ? "" : String(p.minAdvanceDays),
      maxAdvanceDays: p.maxAdvanceDays === null ? "" : String(p.maxAdvanceDays),
      arrivalDaysOfWeek: p.arrivalDaysOfWeek ?? [],
      ratePlanIds: [],
      roomTypeIds: [],
      priority: String(p.priority),
      isActive: p.isActive,
    });
  }

  function num(value: string): number | null {
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }

  function submit() {
    if (!form) return;
    setMessage(null);

    let amountCents: number | null = null;
    if (form.kind === "amount_off") {
      try {
        amountCents = parseMoney(form.amount);
      } catch {
        setMessage({ ok: false, text: tr("That is not an amount. Try 25 or 25.50.") });
        return;
      }
    }

    const percent = form.percent.trim() === "" ? null : Number(form.percent);
    if (form.kind === "percent_off" && (percent === null || Number.isNaN(percent))) {
      setMessage({ ok: false, text: tr("Enter a percentage, like 15.") });
      return;
    }

    startTransition(async () => {
      const result = await savePromotion({
        id: form.id,
        name: form.name,
        code: form.code,
        description: form.description,
        kind: form.kind,
        // Basis points, like every other rate here: 15% is 1500.
        percentBps: percent === null ? null : Math.round(percent * 100),
        amountOffCents: amountCents,
        freeNights: num(form.freeNights),
        paidNights: num(form.paidNights),
        sellFrom: form.sellFrom,
        sellTo: form.sellTo,
        stayFrom: form.stayFrom,
        stayTo: form.stayTo,
        minNights: num(form.minNights),
        maxNights: num(form.maxNights),
        minAdvanceDays: num(form.minAdvanceDays),
        maxAdvanceDays: num(form.maxAdvanceDays),
        arrivalDaysOfWeek: form.arrivalDaysOfWeek,
        ratePlanIds: form.ratePlanIds,
        roomTypeIds: form.roomTypeIds,
        priority: num(form.priority) ?? 0,
        isActive: form.isActive,
      });

      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setForm(null);
      setMessage({ ok: true, text: tr("{name} saved.", { name: form.name }) });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex items-center justify-between rounded-lg border border-line bg-white px-5 py-4 shadow-card">
          <button
            onClick={() => {
              setMessage(null);
              setForm({ ...EMPTY });
            }}
            className="shrink-0 rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900"
          >
            {tr("Add offer")}
          </button>
        </div>
      )}

      {message && (
        <p
          className={cn(
            "rounded-md px-3 py-2.5 text-[13px] leading-relaxed",
            message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700",
          )}
        >
          {message.text}
        </p>
      )}

      {form && (
        <div className="rounded-lg border border-line bg-white p-5 shadow-card">
          <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
            {form.id ? tr("Edit offer") : tr("New offer")}
          </h2>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="p-name" className={label}>{tr("Name")}</label>
              <input
                id="p-name"
                value={form.name}
                placeholder={tr("Winter early bird")}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="p-code" className={label}>{tr("Code")}</label>
              <input
                id="p-code"
                value={form.code}
                placeholder={tr("Leave blank to apply automatically")}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="p-priority" className={label}>{tr("Priority")}</label>
              <input
                id="p-priority"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className={cn(field, "tnum")}
              />
              <p className="mt-1 text-xxs text-ink-faint">{tr("Breaks a tie only.")}</p>
            </div>

            <div className="sm:col-span-4">
              <span className={label}>{tr("What it takes off")}</span>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setForm({ ...form, kind: k.value })}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-[13px]",
                      form.kind === k.value
                        ? "border-chrome-800 bg-chrome-800 text-white"
                        : "border-line text-ink-muted hover:bg-shell hover:text-ink",
                    )}
                  >
                    {tr(k.label)}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-ink-faint">
                {tr(KINDS.find((k) => k.value === form.kind)?.hint ?? "")}
              </p>
            </div>

            {form.kind === "percent_off" && (
              <div>
                <label htmlFor="p-pct" className={label}>{tr("Percent off")}</label>
                <input
                  id="p-pct"
                  value={form.percent}
                  inputMode="decimal"
                  placeholder="15"
                  onChange={(e) => setForm({ ...form, percent: e.target.value })}
                  className={cn(field, "tnum")}
                />
              </div>
            )}
            {form.kind === "amount_off" && (
              <div>
                <label htmlFor="p-amt" className={label}>{tr("Off each night")}</label>
                <input
                  id="p-amt"
                  value={form.amount}
                  inputMode="decimal"
                  placeholder="25.00"
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className={cn(field, "tnum")}
                />
              </div>
            )}
            {form.kind === "free_nights" && (
              <>
                <div>
                  <label htmlFor="p-paid" className={label}>{tr("Nights paid for")}</label>
                  <input
                    id="p-paid"
                    value={form.paidNights}
                    inputMode="numeric"
                    onChange={(e) => setForm({ ...form, paidNights: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
                <div>
                  <label htmlFor="p-free" className={label}>{tr("Nights free")}</label>
                  <input
                    id="p-free"
                    value={form.freeNights}
                    inputMode="numeric"
                    onChange={(e) => setForm({ ...form, freeNights: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="p-sf" className={label}>{tr("Sold from")}</label>
              <input id="p-sf" type="date" value={form.sellFrom}
                onChange={(e) => setForm({ ...form, sellFrom: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-st" className={label}>{tr("Sold to")}</label>
              <input id="p-st" type="date" value={form.sellTo}
                onChange={(e) => setForm({ ...form, sellTo: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-yf" className={label}>{tr("Nights from")}</label>
              <input id="p-yf" type="date" value={form.stayFrom}
                onChange={(e) => setForm({ ...form, stayFrom: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-yt" className={label}>{tr("Nights to")}</label>
              <input id="p-yt" type="date" value={form.stayTo}
                onChange={(e) => setForm({ ...form, stayTo: e.target.value })}
                className={cn(field, "tnum")} />
            </div>

            <div>
              <label htmlFor="p-min" className={label}>{tr("Min nights")}</label>
              <input id="p-min" value={form.minNights} inputMode="numeric"
                onChange={(e) => setForm({ ...form, minNights: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-max" className={label}>{tr("Max nights")}</label>
              <input id="p-max" value={form.maxNights} inputMode="numeric"
                onChange={(e) => setForm({ ...form, maxNights: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-adv" className={label}>{tr("Booked at least (days ahead)")}</label>
              <input id="p-adv" value={form.minAdvanceDays} inputMode="numeric"
                onChange={(e) => setForm({ ...form, minAdvanceDays: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-last" className={label}>{tr("Booked within (days)")}</label>
              <input id="p-last" value={form.maxAdvanceDays} inputMode="numeric"
                onChange={(e) => setForm({ ...form, maxAdvanceDays: e.target.value })}
                className={cn(field, "tnum")} />
            </div>

            <div className="sm:col-span-2">
              <span className={label}>{tr("Only for arrivals on")}</span>
              <div className="flex flex-wrap gap-1">
                {DOW.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        arrivalDaysOfWeek: form.arrivalDaysOfWeek.includes(d.value)
                          ? form.arrivalDaysOfWeek.filter((x) => x !== d.value)
                          : [...form.arrivalDaysOfWeek, d.value],
                      })
                    }
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs",
                      form.arrivalDaysOfWeek.includes(d.value)
                        ? "border-chrome-800 bg-chrome-800 text-white"
                        : "border-line text-ink-muted hover:bg-shell hover:text-ink",
                    )}
                  >
                    {tr.weekday(d.value)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className={label}>{tr("Rate plans")}</span>
              <div className="flex flex-wrap gap-1">
                {ratePlans.map((rp) => (
                  <button
                    key={rp.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        ratePlanIds: form.ratePlanIds.includes(rp.id)
                          ? form.ratePlanIds.filter((x) => x !== rp.id)
                          : [...form.ratePlanIds, rp.id],
                      })
                    }
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs",
                      form.ratePlanIds.includes(rp.id)
                        ? "border-chrome-800 bg-chrome-800 text-white"
                        : "border-line text-ink-muted hover:bg-shell hover:text-ink",
                    )}
                  >
                    {rp.name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xxs text-ink-faint">{tr("None picked means every plan.")}</p>
            </div>
            <div>
              <span className={label}>{tr("Room types")}</span>
              <div className="flex flex-wrap gap-1">
                {roomTypes.map((rt) => (
                  <button
                    key={rt.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        roomTypeIds: form.roomTypeIds.includes(rt.id)
                          ? form.roomTypeIds.filter((x) => x !== rt.id)
                          : [...form.roomTypeIds, rt.id],
                      })
                    }
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs",
                      form.roomTypeIds.includes(rt.id)
                        ? "border-chrome-800 bg-chrome-800 text-white"
                        : "border-line text-ink-muted hover:bg-shell hover:text-ink",
                    )}
                  >
                    {rt.name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xxs text-ink-faint">{tr("None picked means every type.")}</p>
            </div>

            <div className="sm:col-span-4">
              <label htmlFor="p-desc" className={label}>{tr("Description")}</label>
              <input
                id="p-desc"
                value={form.description}
                placeholder={tr("Optional — what staff should know about it")}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className={field}
              />
            </div>
          </div>

          {form.id && (
            <label className="mt-4 flex items-center gap-2 text-[13px] text-ink-muted">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              {tr("Live")}
            </label>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setForm(null)}
              className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
            >
              {tr("Cancel")}
            </button>
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-md bg-chrome-800 px-6 py-2.5 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
            >
              {pending ? tr("Saving…") : tr("Save offer")}
            </button>
          </div>
          {form.id && (
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              {tr("Saving replaces which rate plans and room types this applies to with whatever is picked above.")}
            </p>
          )}
        </div>
      )}

      {/*
        Active and inactive, as two sections of cards — the client sent the
        reference system's Offers screen and asked for it. Everything a card
        shows we already held: the discount phrase, the room scope, the arrival
        weekdays (those seven squares) and the stay dates.
      */}
      <OfferSection
        title={tr("Active offers")}
        offers={promotions.filter((p) => p.isActive)}
        canEdit={canEdit}
        onEdit={edit}
        onAdd={() => {
          setMessage(null);
          setForm({ ...EMPTY });
        }}
        emptyHint={
          canEdit
            ? tr("Add one to take a percentage or an amount off, or to give a night free on a longer stay.")
            : tr("A manager or administrator sets these up.")
        }
      />

      {promotions.some((p) => !p.isActive) && (
        <OfferSection
          title={tr("Inactive offers")}
          offers={promotions.filter((p) => !p.isActive)}
          canEdit={canEdit}
          onEdit={edit}
          tinted
        />
      )}
    </div>
  );
}
