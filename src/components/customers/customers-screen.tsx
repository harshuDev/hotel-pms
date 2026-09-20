"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { EmptyState, cn } from "@/components/ui";
import { formatDue, formatMoney } from "@/lib/money";
import {
  exportCustomersCsv,
  getCustomerForEdit,
  mergeCustomers,
  saveCustomer,
  setExcludeFromEmail,
} from "@/lib/actions/customers";
import { COUNTRIES } from "@/lib/countries";
import type { Customer, CustomerKind } from "@/lib/types";

/**
 * The Customers table, and the three controls above it.
 *
 * Create Customer, Merge Selected and Export to Excel all shipped `disabled`
 * with "Available in Phase 2" on them, and the row tickboxes were disabled too
 * — which is why Merge could never have worked whatever you clicked: nothing
 * was selectable. This makes all three do what they say.
 *
 * The read stays on the server. This takes the rows as a prop and owns only
 * what the browser has to own: which rows are ticked, and which dialog is open.
 */

const TABS = [
  { key: "all", label: "All" },
  { key: "personal", label: "Personal" },
  { key: "company", label: "Company" },
];

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const toolbar =
  "rounded-md border border-line px-3 py-1.5 text-xxs font-semibold uppercase tracking-[0.1em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

interface FormState {
  id: string | null;
  kind: CustomerKind;
  firstName: string;
  lastName: string;
  companyName: string;
  nationalIdNumber: string;
  email: string;
  phone: string;
  excludeFromEmail: boolean;
  nationality: string;
  country: string;
  passportNumber: string;
  passportExpiry: string;
  dateOfBirth: string;
}

const EMPTY: FormState = {
  id: null,
  kind: "personal",
  firstName: "",
  lastName: "",
  companyName: "",
  nationalIdNumber: "",
  email: "",
  phone: "",
  excludeFromEmail: false,
  nationality: "",
  country: "",
  passportNumber: "",
  passportExpiry: "",
  dateOfBirth: "",
};

export function CustomersScreen({
  rows,
  total,
  page,
  perPage,
  q,
  kind,
  canMerge,
  canEdit,
}: {
  rows: Customer[];
  total: number;
  page: number;
  perPage: number;
  q: string;
  kind: string;
  /** Merging rewrites booking history, so it is manager and above. */
  canMerge: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormState | null>(null);
  const [merging, setMerging] = useState(false);
  const [keepId, setKeepId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const pages = Math.max(1, Math.ceil(total / perPage));
  const selectedRows = rows.filter((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate() {
    setMessage(null);
    setForm({ ...EMPTY });
  }

  function openEdit(id: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await getCustomerForEdit(id);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setForm(result.data);
    });
  }

  function submit() {
    if (!form) return;
    setMessage(null);
    startTransition(async () => {
      const result = await saveCustomer(form);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setForm(null);
      setMessage({
        ok: true,
        text: form.id ? "Customer saved." : "Customer created.",
      });
      router.refresh();
    });
  }

  function toggleExclude(c: Customer) {
    setMessage(null);
    startTransition(async () => {
      const result = await setExcludeFromEmail(c.id, !c.excludeFromEmail);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      router.refresh();
    });
  }

  function openMerge() {
    setMessage(null);
    if (selectedRows.length < 2) {
      setMessage({
        ok: false,
        text: "Tick two or more customers to merge them into one.",
      });
      return;
    }
    // Default to the one with the most bookings: merging the busy record into
    // the empty one is the wrong way round and easy to do by accident.
    const busiest = [...selectedRows].sort(
      (a, b) => b.bookingCount - a.bookingCount,
    )[0];
    setKeepId(busiest.id);
    setMerging(true);
  }

  function confirmMerge() {
    if (!keepId) return;
    setMessage(null);
    const others = selectedRows.filter((r) => r.id !== keepId).map((r) => r.id);
    startTransition(async () => {
      const result = await mergeCustomers(keepId, others);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      const d = result.data;
      setMerging(false);
      setSelected(new Set());
      setMessage({
        ok: true,
        text: `${d.customersMerged} record${d.customersMerged === 1 ? "" : "s"} merged. ${d.bookingsMoved} booking${d.bookingsMoved === 1 ? "" : "s"} and ${d.foliosMoved} folio${d.foliosMoved === 1 ? "" : "s"} moved across.`,
      });
      router.refresh();
    });
  }

  function exportCsv() {
    setMessage(null);
    startTransition(async () => {
      const result = await exportCustomersCsv({ q, kind });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      /*
       * Built on the server, downloaded from the browser.
       *
       * A download would normally be a route handler, and this codebase does
       * not have API routes. A Server Action returning the text and an
       * object URL here does the same job without one.
       *
       * The BOM is for Excel: without it, it reads the file as the local
       * codepage and a name with an accent in it comes out mangled.
       */
      const blob = new Blob(["﻿" + result.data.csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.data.filename;
      a.click();
      URL.revokeObjectURL(url);

      setMessage({
        ok: true,
        text: result.data.capped
          ? `${result.data.rows} customers exported — the export stops at ${result.data.rows}, so this is not the whole list. Narrow the search and export again.`
          : `${result.data.rows} customer${result.data.rows === 1 ? "" : "s"} exported to ${result.data.filename}.`,
      });
    });
  }

  const pageHref = (p: number) =>
    `/customers?kind=${kind}&page=${p}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tightest text-ink">
            Customer Profiles
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={openCreate}
            disabled={!canEdit || pending}
            title={
              canEdit
                ? "Add a customer without taking a booking"
                : "Front desk, manager and admin accounts can add a customer"
            }
            className={cn(
              toolbar,
              canEdit
                ? "text-ink-muted hover:bg-shell hover:text-ink"
                : "cursor-not-allowed text-ink-faint",
            )}
          >
            Create Customer
          </button>
          <button
            onClick={openMerge}
            disabled={!canMerge || pending}
            title={
              canMerge
                ? "Tick two or more rows, then fold them into one record"
                : "Only a manager or administrator can merge customers"
            }
            className={cn(
              toolbar,
              canMerge
                ? "text-ink-muted hover:bg-shell hover:text-ink"
                : "cursor-not-allowed text-ink-faint",
            )}
          >
            Merge Selected
            {selected.size > 0 && (
              <span className="ml-1.5 tnum rounded bg-brass px-1.5 py-0.5 text-white">
                {selected.size}
              </span>
            )}
          </button>
          <button
            onClick={exportCsv}
            disabled={pending}
            title="Download every customer matching this search, as a CSV Excel opens"
            className={cn(toolbar, "text-ink-muted hover:bg-shell hover:text-ink")}
          >
            Export to Excel
          </button>
        </div>
      </div>

      {message && (
        <p
          className={cn(
            "mb-3 rounded-md px-3 py-2.5 text-[13px] leading-relaxed",
            message.ok
              ? "bg-emerald-50 text-emerald-800"
              : "bg-rose-50 text-rose-700",
          )}
        >
          {message.text}
        </p>
      )}

      {form && (
        <div className="mb-4 rounded-lg border border-line bg-shell/60 p-4">
          <h2 className="mb-3 font-display text-[15px] font-semibold tracking-tightest text-ink">
            {form.id ? "Edit customer" : "New customer"}
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={label} htmlFor="c-kind">Kind</label>
              <select
                id="c-kind"
                value={form.kind}
                onChange={(e) =>
                  setForm({ ...form, kind: e.target.value as CustomerKind })
                }
                className={field}
              >
                <option value="personal">Person</option>
                <option value="company">Company</option>
              </select>
            </div>

            {form.kind === "personal" ? (
              <>
                <div>
                  <label className={label} htmlFor="c-first">First name</label>
                  <input
                    id="c-first"
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="c-last">Last name</label>
                  <input
                    id="c-last"
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className={field}
                  />
                </div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <label className={label} htmlFor="c-company">Company name</label>
                <input
                  id="c-company"
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  className={field}
                />
              </div>
            )}

            <div>
              <label className={label} htmlFor="c-nid">National id number</label>
              <input
                id="c-nid"
                value={form.nationalIdNumber}
                onChange={(e) =>
                  setForm({ ...form, nationalIdNumber: e.target.value })
                }
                className={field}
              />
            </div>
            <div>
              <label className={label} htmlFor="c-email">Email</label>
              <input
                id="c-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={field}
              />
            </div>
            <div>
              <label className={label} htmlFor="c-phone">Phone</label>
              <input
                id="c-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={field}
              />
            </div>
          </div>

          {/*
            Identity, in its own band because it is filled in at a different
            moment from everything above it: a booking is taken over the phone,
            a passport is seen at the desk. Every field is optional -- making
            any of it required would refuse the commonest thing this form does.

            Nationality and country are separate on purpose. A German passport
            holder living in Paris is a German national and a French booking,
            and the two reports that read these ask different questions.
          */}
          <fieldset className="mt-4 rounded-md border border-line bg-shell/50 p-3">
            <legend className="px-1 text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              Identity
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="c-nationality">Nationality</label>
                <select
                  id="c-nationality"
                  value={form.nationality}
                  onChange={(e) =>
                    setForm({ ...form, nationality: e.target.value })
                  }
                  className={field}
                >
                  <option value="">Not recorded</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="c-country">Country of residence</label>
                <select
                  id="c-country"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  className={field}
                >
                  <option value="">Not recorded</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="c-passport">Passport number</label>
                <input
                  id="c-passport"
                  value={form.passportNumber}
                  onChange={(e) =>
                    setForm({ ...form, passportNumber: e.target.value })
                  }
                  className={field}
                />
              </div>
              <div>
                <label className={label} htmlFor="c-passport-exp">Passport expiry</label>
                <input
                  id="c-passport-exp"
                  type="date"
                  value={form.passportExpiry}
                  onChange={(e) =>
                    setForm({ ...form, passportExpiry: e.target.value })
                  }
                  className={field}
                />
              </div>
              <div>
                <label className={label} htmlFor="c-dob">Date of birth</label>
                <input
                  id="c-dob"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) =>
                    setForm({ ...form, dateOfBirth: e.target.value })
                  }
                  className={field}
                />
              </div>
            </div>
          </fieldset>

          <label className="mt-3 flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={form.excludeFromEmail}
              onChange={(e) =>
                setForm({ ...form, excludeFromEmail: e.target.checked })
              }
              className="h-3.5 w-3.5 accent-brass"
            />
            Exclude from email
          </label>

          <div className="mt-4 flex gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save customer"}
            </button>
            <button
              onClick={() => setForm(null)}
              className="rounded-md border border-line px-5 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {merging && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn-wash p-4">
          <h2 className="font-display text-[15px] font-semibold tracking-tightest text-warn-deep">
            Merge {selectedRows.length} customers into one
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-warn-deep">
            Choose the record to keep. Everything on the others moves to it.
            This cannot be undone from here.
          </p>

          <div className="mt-3 space-y-1.5">
            {selectedRows.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 rounded-md bg-white/70 px-3 py-2 text-[13px] text-ink"
              >
                <input
                  type="radio"
                  name="keep"
                  checked={keepId === c.id}
                  onChange={() => setKeepId(c.id)}
                  className="accent-brass"
                />
                <span className="font-medium">{c.name}</span>
                <span className="text-xxs text-ink-faint">Id: {c.ref}</span>
                <span className="tnum ml-auto text-xxs text-ink-muted">
                  {c.bookingCount} booking{c.bookingCount === 1 ? "" : "s"}
                  {c.email ? ` · ${c.email}` : ""}
                </span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={confirmMerge}
              disabled={pending || !keepId}
              className="rounded-md bg-warn-deep px-5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Merging…" : "Merge them"}
            </button>
            <button
              onClick={() => setMerging(false)}
              className="rounded-md border border-line bg-white px-5 py-2 text-[13px] text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-4">
        <form className="flex flex-1 gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name, email or phone"
            className="min-w-[220px] flex-1 rounded-md border border-line px-3.5 py-2 text-[13px] placeholder:text-ink-faint"
          />
          <input type="hidden" name="kind" value={kind} />
          <button className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900">
            Search
          </button>
        </form>
        <div className="flex items-center gap-2 text-sm">
          {TABS.map((t, i) => (
            <span key={t.key} className="flex items-center gap-2">
              {i > 0 && <span className="text-line">|</span>}
              <Link
                href={`/customers?kind=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={cn(
                  kind === t.key
                    ? "font-medium text-ink"
                    : "text-nav hover:underline",
                )}
              >
                {t.label}
              </Link>
            </span>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No customers match this search"
          hint="Search covers name, email and phone number."
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selected.size === rows.length}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? new Set(rows.map((r) => r.id))
                            : new Set(),
                        )
                      }
                      className="h-3.5 w-3.5 accent-brass"
                      aria-label="Select every customer on this page"
                    />
                  </th>
                  <th className="px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]">Name</th>
                  <th className="px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]">National Id Number</th>
                  <th className="px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]">Email</th>
                  <th className="px-3 pb-2.5 text-center text-xxs font-semibold uppercase tracking-[0.1em]">
                    Exclude from email
                  </th>
                  <th className="px-3 pb-2.5 text-center text-xxs font-semibold uppercase tracking-[0.1em]">
                    No of Bookings
                  </th>
                  <th className="px-3 pb-2.5 text-right text-xxs font-semibold uppercase tracking-[0.1em]">
                    Total Revenue
                  </th>
                  <th className="px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]">Last Booking Date</th>
                  <th className="px-3 pb-2.5 text-right text-xxs font-semibold uppercase tracking-[0.1em]">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className={cn(
                      "hover:bg-shell",
                      selected.has(c.id) && "bg-brass/5",
                    )}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        className="h-3.5 w-3.5 accent-brass"
                        aria-label={`Select ${c.name}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      {canEdit ? (
                        <button
                          onClick={() => openEdit(c.id)}
                          className="font-medium text-ink hover:text-brass hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                          title="Edit this customer"
                        >
                          {c.name}
                        </button>
                      ) : (
                        <span className="font-medium text-ink">{c.name}</span>
                      )}
                      <span className="ml-1.5 text-xxs text-ink-faint">
                        Id: {c.ref}
                      </span>
                      {c.kind === "company" && (
                        <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                          company
                        </span>
                      )}
                    </td>
                    <td className="tnum px-3 py-3 text-ink-muted">
                      {c.nationalIdNumber ?? ""}
                    </td>
                    <td
                      className="max-w-[190px] truncate px-3 py-3 text-ink-muted"
                      title={c.email ?? ""}
                    >
                      {c.email ?? ""}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={c.excludeFromEmail}
                        onChange={() => toggleExclude(c)}
                        disabled={!canEdit || pending}
                        className="h-3.5 w-3.5 accent-brass disabled:cursor-not-allowed"
                        aria-label={`Exclude ${c.name} from email`}
                        title={
                          canEdit
                            ? "Keep this customer off mailings"
                            : "Front desk, manager and admin accounts can change this"
                        }
                      />
                    </td>
                    <td className="tnum px-3 py-3 text-center text-ink-muted">
                      {c.bookingCount}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-3 text-right text-ink">
                      {formatMoney(c.totalRevenueCents)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-muted">
                      {c.lastBookingDate
                        ? format(parseISO(c.lastBookingDate), "MMM d, yyyy")
                        : "—"}
                    </td>
                    <td
                      className={cn(
                        "tnum whitespace-nowrap px-3 py-3 text-right font-medium",
                        c.balanceCents > 0 ? "text-rose-600" : "text-ink-muted",
                      )}
                    >
                      {formatDue(c.balanceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm text-ink-muted">
            <p>
              {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of{" "}
              {total}
            </p>
            <div className="flex gap-1">
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <Link
                  key={p}
                  href={pageHref(p)}
                  className={cn(
                    "rounded px-3 py-1.5",
                    p === page
                      ? "bg-chrome-800 font-medium text-white"
                      : "border border-line hover:bg-shell",
                  )}
                >
                  {p}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
