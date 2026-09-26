"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { chargeExtra } from "@/lib/actions/booking-edit";
import type { ExtrasCatalog } from "@/lib/extras";
import { useCurrency } from "@/components/currency";

/*
 * Charging an extra from the catalog (0069) on the booking's Extras tab.
 *
 * The browser sends which extra and how many -- never a price. The amount,
 * the tax and the accounting category are read from the catalog inside
 * `charge_extra()`, and the posting is `post_charge()`, so the folio and the
 * Extras report see exactly what any other charge looks like.
 *
 * Until 0069 nothing in the staff application could put an extra on a folio
 * at all; the empty state used to send people to the cashier, which could not
 * do it either.
 */
export function ChargeExtra({
  bookingId,
  catalog,
}: {
  bookingId: string;
  catalog: ExtrasCatalog;
}) {
  const currency = useCurrency();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [extraId, setExtraId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (catalog.extras.length === 0) {
    return (
      <p className="text-[13px] text-ink-muted">
        No extras to charge yet.{" "}
        <Link href="/settings?tab=extras" className="text-brass underline-offset-2 hover:underline">
          Add them in Settings
        </Link>
        .
      </p>
    );
  }

  const chosen = catalog.extras.find((e) => e.id === extraId) ?? null;

  function submit() {
    if (!chosen) {
      setMessage({ ok: false, text: "Pick the extra to charge." });
      return;
    }
    const qty = Number(quantity);
    const what = chosen.title;
    setMessage(null);
    startTransition(async () => {
      const result = await chargeExtra({ bookingId, extraId: chosen.id, quantity: qty });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({ ok: true, text: `${qty > 1 ? `${qty} × ` : ""}${what} charged.` });
      setExtraId("");
      setQuantity("1");
      router.refresh();
    });
  }

  const field =
    "rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[14rem] flex-1 text-[12px] text-ink-muted">
          Extra
          <select
            value={extraId}
            onChange={(e) => setExtraId(e.target.value)}
            className={cn(field, "mt-1 w-full")}
          >
            <option value="">Choose…</option>
            {catalog.categories.map((c) => {
              const inCategory = catalog.extras.filter((e) => e.categoryId === c.id);
              if (inCategory.length === 0) return null;
              return (
                <optgroup key={c.id} label={c.title}>
                  {inCategory.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title} · {formatMoney(e.priceCents, currency)}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
        <label className="w-20 text-[12px] text-ink-muted">
          Quantity
          <input
            type="number"
            min={1}
            max={999}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={cn(field, "tnum mt-1 w-full")}
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-chrome-800 px-4 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
        >
          {pending ? "Charging…" : "Charge"}
        </button>
      </div>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={cn("mt-2 text-[12.5px]", message.ok ? "text-emerald-700" : "text-rose-600")}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
