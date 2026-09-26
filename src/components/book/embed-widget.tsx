"use client";

import { useState } from "react";
import { inkOn } from "@/lib/calendar-settings";
import type { Locale } from "@/lib/i18n/locales";

/*
 * The Booking Widget (0100) inside a hotel's own website. A plain GET form
 * with `target="_top"`: Search leaves the hotel's page for the booking page
 * with `from`, `to`, the party and the language, and the booking page opens
 * on its room step. Nothing is decided here that the booking page does not
 * check again -- dates are re-validated on arrival, and availability, rates
 * and rules are Postgres's, as always.
 *
 * The hotel's colours are data, so they are inline styles, never classes.
 * The calendar is drawn from names handed down by the server, never
 * formatted in the browser.
 */

type Colors = { primary: string; text: string; background: string; label: string; border: string };

function ymd(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

function parts(s: string) {
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) - 1, d: Number(s.slice(8, 10)) };
}

function addDays(s: string, n: number): string {
  const p = parts(s);
  return ymd(p.y, p.m, p.d + n);
}

function MonthPicker({
  value,
  min,
  months,
  weekdays,
  colors,
  onPick,
}: {
  value: string;
  min: string;
  months: string[];
  weekdays: string[];
  colors: Colors;
  onPick: (day: string) => void;
}) {
  const start = parts(value);
  const [view, setView] = useState({ y: start.y, m: start.m });
  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: days }, (_, i) => ymd(view.y, view.m, i + 1)),
  ];
  const minP = parts(min);
  const canBack = view.y > minP.y || (view.y === minP.y && view.m > minP.m);
  const move = (n: number) => {
    const d = new Date(Date.UTC(view.y, view.m + n, 1));
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };
  return (
    <div
      className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md p-3 shadow-lg"
      style={{ background: colors.background, border: `1px solid ${colors.border}` }}
    >
      <div className="mb-2 flex items-center justify-between text-[14px]" style={{ color: colors.text }}>
        {canBack ? (
          <button type="button" aria-label="Previous month" onClick={() => move(-1)} className="px-2 text-[16px]">
            ‹
          </button>
        ) : (
          <span className="w-7" />
        )}
        <span className="font-semibold">
          {months[view.m]} {view.y}
        </span>
        <button type="button" aria-label="Next month" onClick={() => move(1)} className="px-2 text-[16px]">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]" style={{ color: colors.label }}>
        {weekdays.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-0.5 text-center text-[13px]">
        {cells.map((day, i) =>
          day === null ? (
            <span key={i} />
          ) : day < min ? (
            <span key={i} className="py-1.5 opacity-35" style={{ color: colors.text }}>
              {parts(day).d}
            </span>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => onPick(day)}
              className="rounded py-1.5"
              style={
                day === value
                  ? { background: colors.primary, color: inkOn(colors.primary) }
                  : { color: colors.text }
              }
            >
              {parts(day).d}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function EmbedWidget({
  bookHref,
  locale,
  today,
  months,
  weekdays,
  texts,
  showOccupancy,
  useCheckoutDate,
  colors,
}: {
  bookHref: string;
  locale: Locale;
  today: string;
  months: string[];
  weekdays: string[];
  texts: { title: string; button: string; checkIn: string; checkOut: string; nights: string; adults: string; children: string };
  showOccupancy: boolean;
  useCheckoutDate: boolean;
  colors: Colors;
}) {
  const [from, setFrom] = useState(today);
  const [nights, setNights] = useState(1);
  const [to, setTo] = useState(addDays(today, 1));
  const [open, setOpen] = useState<"from" | "to" | null>(null);
  const departure = useCheckoutDate ? to : addDays(from, nights);

  const label = (s: string) => {
    const p = parts(s);
    return `${p.d} ${months[p.m]} ${p.y}`;
  };
  const labelStyle = { color: colors.label };
  const fieldStyle = { color: colors.text, borderColor: colors.border, background: colors.background };
  const field = "flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left text-[14px]";

  return (
    <form
      action={bookHref}
      method="get"
      target="_top"
      className="min-h-screen p-1"
      style={{ background: "transparent" }}
    >
      <input type="hidden" name="lang" value={locale} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={departure} />
      <div
        className="space-y-3 rounded-lg p-5"
        style={{ background: colors.background, border: `1px solid ${colors.border}`, color: colors.text }}
      >
        <h1 className="text-[20px] font-semibold">{texts.title}</h1>

        <div className="relative">
          <span className="mb-1 block text-[12px]" style={labelStyle}>{texts.checkIn}</span>
          <button type="button" className={field} style={fieldStyle} onClick={() => setOpen(open === "from" ? null : "from")}>
            {label(from)}
            <span aria-hidden="true" style={labelStyle}>▾</span>
          </button>
          {open === "from" && (
            <MonthPicker
              value={from}
              min={today}
              months={months}
              weekdays={weekdays}
              colors={colors}
              onPick={(d) => {
                setFrom(d);
                if (to <= d) setTo(addDays(d, 1));
                setOpen(null);
              }}
            />
          )}
        </div>

        {useCheckoutDate ? (
          <div className="relative">
            <span className="mb-1 block text-[12px]" style={labelStyle}>{texts.checkOut}</span>
            <button type="button" className={field} style={fieldStyle} onClick={() => setOpen(open === "to" ? null : "to")}>
              {label(to)}
              <span aria-hidden="true" style={labelStyle}>▾</span>
            </button>
            {open === "to" && (
              <MonthPicker
                value={to}
                min={addDays(from, 1)}
                months={months}
                weekdays={weekdays}
                colors={colors}
                onPick={(d) => {
                  setTo(d);
                  setOpen(null);
                }}
              />
            )}
          </div>
        ) : (
          <label className="block">
            <span className="mb-1 block text-[12px]" style={labelStyle}>{texts.nights}</span>
            <select value={nights} onChange={(e) => setNights(Number(e.target.value))} className={field} style={fieldStyle}>
              {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}

        {showOccupancy && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[12px]" style={labelStyle}>{texts.adults}</span>
              <select name="adults" defaultValue={2} className={field} style={fieldStyle}>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px]" style={labelStyle}>{texts.children}</span>
              <select name="children" defaultValue={0} className={field} style={fieldStyle}>
                {Array.from({ length: 7 }, (_, i) => i).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        <button
          type="submit"
          className="w-full rounded-md px-4 py-3 text-[15px] font-semibold"
          style={{ background: colors.primary, color: inkOn(colors.primary) }}
        >
          {texts.button}
        </button>
      </div>
    </form>
  );
}
