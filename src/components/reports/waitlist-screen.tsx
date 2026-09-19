"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import { EmptyState, cn } from "@/components/ui";
import { addToWaitlist, setWaitlistStatus } from "@/lib/actions/waitlist";
import type { RoomTypeSetting, WaitlistRow, WaitlistStatus } from "@/lib/types";

/**
 * The waitlist, and the two things you can do to it.
 *
 * This is the only report that is also a screen, because a waitlist nobody can
 * add to is a list of nothing — the rule about not shipping a control that does
 * nothing applies to a whole page as much as to a menu item.
 *
 * The read stays on the server. This owns what the browser has to own: whether
 * the add form is open and what is in it.
 */

const STATUS_LABEL: Record<WaitlistStatus, string> = {
  waiting: "Waiting",
  offered: "Offered",
  converted: "Converted",
  expired: "Expired",
  canceled: "Cancelled",
};

const STATUS_TONE: Record<WaitlistStatus, string> = {
  waiting: "text-warn-deep",
  offered: "text-brass",
  converted: "text-emerald-600",
  expired: "text-ink-faint",
  canceled: "text-ink-faint",
};

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";

interface FormState {
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  notes: string;
}

function emptyForm(businessDate: string): FormState {
  return {
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    roomTypeId: "",
    checkIn: businessDate,
    checkOut: businessDate,
    adults: 2,
    children: 0,
    notes: "",
  };
}

export function WaitlistScreen({
  rows,
  roomTypes,
  businessDate,
  canEdit,
}: {
  rows: WaitlistRow[];
  roomTypes: RoomTypeSetting[];
  businessDate: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!form) return;
    if (form.checkOut <= form.checkIn) {
      setMessage({
        ok: false,
        text: "The departure date has to be after the arrival date.",
      });
      return;
    }

    startTransition(async () => {
      const result = await addToWaitlist({
        checkIn: form.checkIn,
        checkOut: form.checkOut,
        // Always a loose contact for now. Linking an existing customer is the
        // Customers screen's job, and an enquiry that never becomes a booking
        // should not have to create a customer record to be written down.
        customerId: null,
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        roomTypeId: form.roomTypeId || null,
        adults: form.adults,
        children: form.children,
        notes: form.notes,
      });

      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setForm(null);
      setMessage({ ok: true, text: "Added to the waitlist." });
      router.refresh();
    });
  }

  function move(id: string, status: WaitlistStatus) {
    startTransition(async () => {
      const result = await setWaitlistStatus(id, status);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({ ok: true, text: `Marked ${STATUS_LABEL[status].toLowerCase()}.` });
      router.refresh();
    });
  }

  return (
    <div>
      {message && (
        <div
          className={cn(
            "mb-4 rounded-lg border px-4 py-3 text-[13px]",
            message.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700",
          )}
        >
          {message.text}
        </div>
      )}

      {canEdit && (
        <div className="mb-4">
          {form === null ? (
            <button
              onClick={() => {
                setMessage(null);
                setForm(emptyForm(businessDate));
              }}
              className="rounded-md bg-chrome-800 px-4 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              Add to waitlist
            </button>
          ) : (
            <div className="rounded-lg border border-line bg-white p-4 shadow-card">
              <h2 className="mb-3 font-display text-[15px] tracking-tightest text-ink">
                Add to waitlist
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className={label} htmlFor="w-name">Name</label>
                  <input
                    id="w-name"
                    value={form.contactName}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className={field}
                    placeholder="Who is waiting"
                  />
                </div>
                <div>
                  <label className={label} htmlFor="w-email">Email</label>
                  <input
                    id="w-email"
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="w-phone">Phone</label>
                  <input
                    id="w-phone"
                    value={form.contactPhone}
                    onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="w-type">Room type</label>
                  <select
                    id="w-type"
                    value={form.roomTypeId}
                    onChange={(e) => setForm({ ...form, roomTypeId: e.target.value })}
                    className={field}
                  >
                    {/* Any is first and is the default: somebody who wants a
                        room at all on a sold-out night does not care which. */}
                    <option value="">Any room type</option>
                    {roomTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="w-in">Arrival</label>
                  <input
                    id="w-in"
                    type="date"
                    value={form.checkIn}
                    onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="w-out">Departure</label>
                  <input
                    id="w-out"
                    type="date"
                    value={form.checkOut}
                    onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="w-adults">Adults</label>
                  <input
                    id="w-adults"
                    type="number"
                    min={1}
                    value={form.adults}
                    onChange={(e) =>
                      setForm({ ...form, adults: Number(e.target.value) || 1 })
                    }
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="w-children">Children</label>
                  <input
                    id="w-children"
                    type="number"
                    min={0}
                    value={form.children}
                    onChange={(e) =>
                      setForm({ ...form, children: Number(e.target.value) || 0 })
                    }
                    className={field}
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className={label} htmlFor="w-notes">Note</label>
                  <input
                    id="w-notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className={field}
                    placeholder="What they asked for"
                  />
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={submit}
                  disabled={pending}
                  className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
                >
                  {pending ? "Adding…" : "Add to waitlist"}
                </button>
                <button
                  onClick={() => setForm(null)}
                  className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
        {rows.length === 0 ? (
          <EmptyState
            title="Nobody is waiting for these dates"
            hint="When a guest asks for dates the hotel cannot sell, add them here rather than losing the enquiry."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  {["Guest", "Contact", "Room type", "Dates", "Party", "Status", "Note", ""].map(
                    (c, i) => (
                      <th
                        key={c || `c${i}`}
                        className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                      >
                        {c}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2.5 font-medium text-ink">{r.guestName}</td>
                    <td className="px-3 py-2.5 text-ink-muted">
                      {r.contactEmail ?? r.contactPhone ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted">{r.roomTypeName}</td>
                    <td className="tnum whitespace-nowrap px-3 py-2.5 text-ink-muted">
                      {format(parseISO(r.checkIn), "d MMM")} –{" "}
                      {format(parseISO(r.checkOut), "d MMM")}
                      <span className="ml-1 text-ink-faint">({r.nights}n)</span>
                    </td>
                    <td className="tnum px-3 py-2.5 text-ink-faint">
                      {r.adults}
                      {r.children > 0 ? ` + ${r.children}` : ""}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn("font-medium", STATUS_TONE[r.status])}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.convertedReference && (
                        <span className="ml-1 text-ink-faint">
                          {r.convertedReference}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2.5 text-ink-faint">
                      {r.notes ?? ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {canEdit && (r.status === "waiting" || r.status === "offered") && (
                        <span className="flex justify-end gap-1.5">
                          {r.status === "waiting" && (
                            <button
                              onClick={() => move(r.id, "offered")}
                              disabled={pending}
                              className="rounded border border-line px-2 py-1 text-xxs text-ink-muted hover:bg-shell disabled:opacity-50"
                            >
                              Offered
                            </button>
                          )}
                          {/*
                            No "Converted" button. Marking one converted needs the
                            booking it became, and taking that booking goes through
                            the ordinary booking form — a button here would either
                            guess at a reference or quietly make a second booking
                            path with none of the inventory checks on it.
                          */}
                          <Link
                            href={`/bookings/new?check_in=${r.checkIn}&check_out=${r.checkOut}`}
                            className="rounded border border-line px-2 py-1 text-xxs text-ink-muted hover:bg-shell"
                          >
                            Book
                          </Link>
                          <button
                            onClick={() => move(r.id, "canceled")}
                            disabled={pending}
                            className="rounded border border-line px-2 py-1 text-xxs text-ink-muted hover:bg-shell disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          A waitlist entry holds no room. Nothing here appears in occupancy,
          availability or any revenue figure until somebody takes a real booking
          for it — which is what &ldquo;Book&rdquo; opens. Entries are never
          deleted: one that came to nothing is cancelled or expired, because the
          fact that somebody asked is the only thing this list is evidence of.
        </p>
      </div>
    </div>
  );
}
