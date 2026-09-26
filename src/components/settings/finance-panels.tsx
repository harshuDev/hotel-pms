"use client";

import { useState } from "react";
import { cn } from "@/components/ui";
import {
  deleteTaxRate,
  savePaymentType,
  saveTaxRate,
  setTaxRateOrder,
} from "@/lib/actions/settings";
import type { PaymentMethodKind, PaymentMethodSetting, TaxRateSetting } from "@/lib/types";

/*
 * Settings -> Finances, cloned from the client's reference (0079):
 * Custom Payment Types and Tax Information ("Taxes And Fees").
 *
 * Both are a card with the title in its header, a table, a pencil per row and
 * an Add button in the footer, as theirs are. Adding and editing open the same
 * dialog.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "overflow-hidden rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-ink hover:bg-shell disabled:opacity-50";
const label = "block text-[12px] text-ink-muted";
const field =
  "mt-1 w-full rounded-md border border-line px-3 py-2 text-[14px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const iconButton =
  "grid h-8 w-8 place-items-center rounded text-brass hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const th = "px-2 py-2.5 text-left text-[12.5px] font-semibold text-ink";

function EditIcon() {
  // The reference's pencil-in-a-box.
  return (
    <svg viewBox="0 0 24 24" className="h-[20px] w-[20px]" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6" />
      <path d="M17.5 2.5a2.1 2.1 0 0 1 3 3L12 14l-4 1 1-4z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]" fill="currentColor" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z" />
    </svg>
  );
}

function HandleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="finance-dialog-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 id="finance-dialog-title" className="text-[17px] text-ink">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-muted hover:bg-shell hover:text-ink"
          >
            <span aria-hidden="true" className="text-lg leading-none">✕</span>
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">{children}</div>
        <div className="flex justify-end gap-2 border-t border-line bg-shell/60 px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Custom Payment Types                                                       */
/* -------------------------------------------------------------------------- */

/*
 * What a payment type IS, as far as the money goes. Cash is the only kind that
 * touches the drawer, by check constraint, so the blind count rests on this.
 * UPI is in the enum from before and is not offered.
 */
const PAYMENT_KINDS: { value: PaymentMethodKind; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "ota_prepaid", label: "Prepaid to the channel" },
  { value: "virtual_card", label: "Virtual card" },
  { value: "complimentary", label: "Complimentary" },
  { value: "other", label: "Other" },
];

type PaymentDraft = {
  id: string | null;
  title: string;
  description: string;
  kind: PaymentMethodKind;
  isActive: boolean;
  /** Payments taken on it: the kind can no longer change. */
  frozen: boolean;
};

export function PaymentTypesPanel({
  methods,
  canEdit,
  pending,
  run,
}: {
  methods: PaymentMethodSetting[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState<PaymentDraft | null>(null);

  function save(d: PaymentDraft) {
    run(async () => {
      const result = await savePaymentType({
        id: d.id,
        title: d.title,
        description: d.description,
        kind: d.kind,
        isActive: d.isActive,
      });
      if (result.ok) setDraft(null);
      return result;
    }, `${d.title.trim() || "Payment type"} saved.`);
  }

  return (
    <div className="max-w-4xl">
      <section className={card}>
        <h2 className="border-b border-line px-4 py-4 text-[19px] text-ink">Payment Types</h2>
        {methods.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ink-muted">None yet. Add at least cash and card.</p>
        ) : (
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-line">
                <th className={cn(th, "w-[34%]")}>Title</th>
                <th className={th}>Description</th>
                <th className="w-12" aria-label="Edit" />
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m.id} className="border-b border-line even:bg-shell/70">
                  <td className={cn("px-2 py-2", m.isActive ? "text-ink" : "text-ink-faint")}>
                    {m.name}
                    {!m.isActive && <span className="ml-2 text-xxs uppercase tracking-wide">Inactive</span>}
                  </td>
                  <td className="px-2 py-2 text-ink-muted">{m.description}</td>
                  <td className="px-2 py-1 text-right">
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Edit ${m.name}`}
                        className={cn(iconButton, "ml-auto")}
                        onClick={() =>
                          setDraft({
                            id: m.id,
                            title: m.name,
                            description: m.description ?? "",
                            kind: m.kind,
                            isActive: m.isActive,
                            frozen: m.paymentCount > 0,
                          })
                        }
                      >
                        <EditIcon />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <div className="bg-shell/60 px-4 py-4">
            <button
              type="button"
              className={primary}
              onClick={() =>
                setDraft({
                  id: null,
                  title: "",
                  description: "",
                  kind: "other",
                  isActive: true,
                  frozen: false,
                })
              }
            >
              Add new payment type
            </button>
          </div>
        )}
      </section>

      {draft && (
        <Dialog
          title={draft.id ? "Edit payment type" : "New payment type"}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button type="button" className={secondary} onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="button" className={primary} disabled={pending} onClick={() => save(draft)}>
                Save
              </button>
            </>
          }
        >
          <label className={label}>
            Title
            <input
              autoFocus
              value={draft.title}
              maxLength={80}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className={field}
            />
          </label>
          <label className={label}>
            Description
            <textarea
              rows={2}
              value={draft.description}
              maxLength={500}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className={field}
            />
          </label>
          {/*
            Once payments are taken on a type its kind is settled -- moving it
            across the cash line would restate every shift already counted --
            so it is shown rather than offered.
          */}
          {draft.frozen ? (
            <p className="text-[13px] text-ink">
              <span className={label}>Kind</span>
              <span className="mt-1 block">
                {PAYMENT_KINDS.find((k) => k.value === draft.kind)?.label ?? draft.kind}
              </span>
            </p>
          ) : (
            <label className={label}>
              Kind
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as PaymentMethodKind })}
                className={field}
              >
                {PAYMENT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-[14px] text-ink">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              className="h-4 w-4 accent-brass"
            />
            Active
          </label>
        </Dialog>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tax Information -- Taxes And Fees                                          */
/* -------------------------------------------------------------------------- */

type TaxDraft = {
  id: string | null;
  name: string;
  percent: string;
  inclusion: "inclusive" | "exclusive";
  isActive: boolean;
  /** Charges posted at it: the rate and its inclusion are settled. */
  frozen: boolean;
};

/** "20%", "12.5%" -- basis points as a percentage, without trailing zeros. */
function percentOf(bps: number) {
  return `${bps / 100}%`;
}

export function TaxesPanel({
  taxRates,
  canEdit,
  pending,
  run,
}: {
  taxRates: TaxRateSetting[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState<TaxDraft | null>(null);
  const [order, setOrder] = useState<string[]>(taxRates.map((t) => t.id));
  const [dragging, setDragging] = useState<string | null>(null);

  const byId = new Map(taxRates.map((t) => [t.id, t]));
  const rows = order.map((id) => byId.get(id)).filter((t): t is TaxRateSetting => Boolean(t));
  // The booking form seeds its tax with the first ACTIVE rate in this order.
  const defaultId = rows.find((t) => t.isActive)?.id ?? null;

  function commit(next: string[]) {
    if (next.join() === order.join()) return;
    setOrder(next);
    run(() => setTaxRateOrder(next), "Order saved.");
  }

  function move(id: string, to: number) {
    const from = order.indexOf(id);
    if (from < 0 || to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    commit(next);
  }

  function save(d: TaxDraft) {
    run(async () => {
      const result = await saveTaxRate({
        id: d.id,
        name: d.name,
        rateBps: Math.round((Number(d.percent) || 0) * 100),
        inclusion: d.inclusion,
        isActive: d.isActive,
      });
      if (result.ok) setDraft(null);
      return result;
    }, `${d.name.trim() || "Tax"} saved.`);
  }

  return (
    <div className="max-w-4xl">
      <section className={card}>
        <h2 className="border-b border-line px-4 py-4 text-[19px] text-ink">Taxes And Fees</h2>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ink-muted">None yet. Without one, charges post with no tax.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-[13.5px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={cn(th, "w-[32%]")}>Name</th>
                  <th className={th}>Type</th>
                  <th className={th}>Value</th>
                  <th className={th}>Applicable</th>
                  <th className="w-24" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => (
                  <tr
                    key={t.id}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      setDragging(t.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (dragging) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragging) move(dragging, i);
                      setDragging(null);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cn(
                      "border-b border-line bg-shell/70",
                      dragging === t.id && "opacity-50",
                      !t.isActive && "text-ink-faint",
                    )}
                  >
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-1.5">
                        {canEdit && (
                          /*
                            The handle is also a keyboard control: the arrow
                            keys move the row, because a drag alone would
                            leave anyone working by tab unable to reorder.
                          */
                          <button
                            type="button"
                            aria-label={`Move ${t.name}. Use the arrow keys.`}
                            className="cursor-grab rounded p-0.5 text-ink hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                            onKeyDown={(e) => {
                              if (e.key === "ArrowUp") {
                                e.preventDefault();
                                move(t.id, i - 1);
                              } else if (e.key === "ArrowDown") {
                                e.preventDefault();
                                move(t.id, i + 1);
                              }
                            }}
                          >
                            <HandleIcon />
                          </button>
                        )}
                        {t.name}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">Tax</td>
                    <td className="tnum px-2 py-1.5">{percentOf(t.rateBps)}</td>
                    <td className="px-2 py-1.5">
                      {!t.isActive ? "Retired" : t.id === defaultId ? "By default" : "When chosen"}
                    </td>
                    <td className="px-2 py-1">
                      {canEdit && (
                        <span className="flex justify-end">
                          <button
                            type="button"
                            aria-label={`Edit ${t.name}`}
                            className={iconButton}
                            onClick={() =>
                              setDraft({
                                id: t.id,
                                name: t.name,
                                percent: String(t.rateBps / 100),
                                inclusion: t.inclusion,
                                isActive: t.isActive,
                                frozen: t.chargeCount > 0,
                              })
                            }
                          >
                            <EditIcon />
                          </button>
                          {/* Only a tax nothing has used can go; one in use is
                              retired from its form instead. */}
                          {!t.inUse && (
                            <button
                              type="button"
                              aria-label={`Delete ${t.name}`}
                              className={iconButton}
                              onClick={() => {
                                if (!confirm(`Delete ${t.name}?`)) return;
                                run(() => deleteTaxRate(t.id), `${t.name} deleted.`);
                              }}
                            >
                              <TrashIcon />
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div className="px-4 py-4">
            <button
              type="button"
              className={primary}
              onClick={() =>
                setDraft({
                  id: null,
                  name: "",
                  percent: "",
                  // Inclusive, which is what a hotel selling to the public does.
                  inclusion: "inclusive",
                  isActive: true,
                  frozen: false,
                })
              }
            >
              Add tax
            </button>
          </div>
        )}
      </section>

      {draft && (
        <Dialog
          title={draft.id ? "Edit tax" : "New tax"}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button type="button" className={secondary} onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="button" className={primary} disabled={pending} onClick={() => save(draft)}>
                Save
              </button>
            </>
          }
        >
          <label className={label}>
            Name
            <input
              autoFocus
              value={draft.name}
              maxLength={80}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className={field}
            />
          </label>
          {/*
            A rate with charges posted at it is settled: a folio item records
            which rate it used. The figure and the inclusion are shown, not
            offered -- retire it and add a new one.
          */}
          {draft.frozen ? (
            <div className="grid grid-cols-2 gap-4 text-[14px] text-ink">
              <p>
                <span className={label}>Value</span>
                <span className="tnum mt-1 block">{draft.percent}%</span>
              </p>
              <p>
                <span className={label}>Quoted</span>
                <span className="mt-1 block">
                  {draft.inclusion === "inclusive" ? "Included in the rate" : "On top of the rate"}
                </span>
              </p>
              <p className="col-span-2 text-[12.5px] text-ink-muted">
                Charges have been posted at this rate, so its value is fixed.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <label className={label}>
                Value %
                <input
                  inputMode="decimal"
                  value={draft.percent}
                  onChange={(e) => setDraft({ ...draft, percent: e.target.value })}
                  className={cn(field, "tnum")}
                />
              </label>
              <label className={label}>
                Quoted
                <select
                  value={draft.inclusion}
                  onChange={(e) =>
                    setDraft({ ...draft, inclusion: e.target.value as "inclusive" | "exclusive" })
                  }
                  className={field}
                >
                  <option value="inclusive">Included in the rate</option>
                  <option value="exclusive">On top of the rate</option>
                </select>
              </label>
            </div>
          )}
          <label className="flex items-center gap-2 text-[14px] text-ink">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              className="h-4 w-4 accent-brass"
            />
            Active
          </label>
        </Dialog>
      )}
    </div>
  );
}
