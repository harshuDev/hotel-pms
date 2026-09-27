"use client";

import { useT } from "@/components/i18n";
import { useState } from "react";
import { cn } from "@/components/ui";
import { EditIcon } from "@/components/settings/finance-panels";
import {
  ACCOUNTING_SYSTEMS,
  PAYMENT_GATEWAYS,
  accountingSystemLabel,
  type AccountingSystem,
  type PaymentGateway,
} from "@/lib/finance-profiles";
import {
  deleteAccountingSystem,
  deletePaymentGateway,
  saveAccountingSystem,
  savePaymentGateway,
} from "@/lib/actions/settings";

/*
 * Settings -> Finances -> Payment Gateway (0086) and Accounting Systems
 * (0087), cloned from the client's reference. BOTH ARE STORED, NOT YET LIVE:
 * no gateway takes a payment and nothing is exported to a ledger. Each is
 * connected per client as they ask for it, and neither table holds a
 * credential -- a secret belongs to the server, never to a row staff can
 * read. See the migrations and CLAUDE.md.
 *
 * The add and edit forms open inside the card, above the Add button, as
 * elsewhere in Finances.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-ink hover:bg-shell disabled:opacity-50";
const th = "px-1.5 py-3 text-left text-[12.5px] font-semibold text-ink";
const iconButton =
  "grid h-8 w-8 place-items-center rounded text-brass hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const line =
  "w-full border-0 border-b border-line bg-transparent px-0.5 py-1.5 text-[14px] text-ink outline-none placeholder:text-ink-muted focus:border-brass";
const tickbox = "h-[18px] w-[18px] accent-brass";

function PageHeading({ title }: { title: string }) {
  return <h2 className="border-b border-line pb-1 text-[24px] text-ink">{title}</h2>;
}

function Tick({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={label} className="h-3.5 w-3.5 fill-ink">
      <circle cx="8" cy="8" r="8" />
      <path d="M4.5 8.2l2.2 2.2 4.8-4.8" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function FormFrame({
  title,
  pending,
  onCancel,
  onSave,
  children,
}: {
  title: string;
  pending: boolean;
  onCancel: () => void;
  onSave: () => void;
  children: React.ReactNode;
}) {
  const tr = useT();
  return (
    <form
      className="mt-4 rounded border border-line p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <h3 className="border-b border-line pb-1 text-[18px] text-ink">{title}</h3>
      {children}
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" className={secondary} onClick={onCancel}>
          {tr("Cancel")}
        </button>
        <button type="submit" className={primary} disabled={pending}>
          {tr("Save")}
        </button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Payment Gateways                                                           */
/* -------------------------------------------------------------------------- */

type GatewayDraft = { id: string | null; provider: string; title: string; isDefault: boolean };

export function PaymentGatewaysPanel({
  gateways,
  canEdit,
  pending,
  run,
}: {
  gateways: PaymentGateway[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [draft, setDraft] = useState<GatewayDraft | null>(null);

  function save(d: GatewayDraft) {
    run(async () => {
      const result = await savePaymentGateway(d);
      if (result.ok) setDraft(null);
      return result;
    }, tr("{name} saved.", { name: d.title.trim() || tr("Gateway") }));
  }

  return (
    <div className="max-w-5xl space-y-2">
      <PageHeading title={tr("Payment Gateways")} />
      <section className={cn(card, "px-4 pb-6 pt-6 sm:px-8")}>
        {gateways.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={cn(th, "w-[70%]")}>{tr("Title")}</th>
                  <th className={th}>{tr("Is Default")}</th>
                  <th className="w-20" aria-label={tr("Actions")} />
                </tr>
              </thead>
              <tbody>
                {gateways.map((g) => (
                  <tr
                    key={g.id}
                    className={cn("border-b border-line", draft?.id === g.id && "bg-shell/70")}
                  >
                    <td className="px-1.5 py-1.5 text-ink">{g.title}</td>
                    <td className="px-1.5 py-1.5">{g.isDefault ? <Tick label={tr("Default")} /> : null}</td>
                    <td className="py-0.5">
                      {canEdit && (
                        <span className="flex justify-end">
                          <button
                            type="button"
                            aria-label={tr("Edit {name}", { name: g.title })}
                            className={iconButton}
                            onClick={() =>
                              setDraft({
                                id: g.id,
                                provider: g.provider,
                                title: g.title,
                                isDefault: g.isDefault,
                              })
                            }
                          >
                            <EditIcon />
                          </button>
                          <button
                            type="button"
                            aria-label={tr("Delete {name}", { name: g.title })}
                            className={iconButton}
                            onClick={() => {
                              if (!confirm(tr("Delete {name}?", { name: g.title }))) return;
                              run(async () => {
                                const result = await deletePaymentGateway(g.id);
                                if (result.ok && draft?.id === g.id) setDraft(null);
                                return result;
                              }, tr("{name} deleted.", { name: g.title }));
                            }}
                          >
                            <CrossIcon />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pb-2 text-center text-[13px] text-ink">
            {tr("You do not have any payment gateways added")}
          </p>
        )}

        {draft && (
          <FormFrame
            title={draft.id ? tr("Edit Gateway") : tr("Add Gateway")}
            pending={pending}
            onCancel={() => setDraft(null)}
            onSave={() => save(draft)}
          >
            <div className="mt-4 grid items-end gap-6 sm:grid-cols-3">
              <select
                aria-label={tr("Gateway")}
                value={draft.provider}
                onChange={(e) => {
                  const provider = e.target.value;
                  const label = PAYMENT_GATEWAYS.find((p) => p.id === provider)?.label ?? "";
                  // The title starts as the gateway's name; it stays the
                  // hotel's to change.
                  const untouched =
                    draft.title === "" || PAYMENT_GATEWAYS.some((p) => p.label === draft.title);
                  setDraft({ ...draft, provider, title: untouched ? label : draft.title });
                }}
                className={cn(line, "cursor-pointer", draft.provider === "" && "text-ink-muted")}
              >
                <option value="">{tr("Gateway")}</option>
                {PAYMENT_GATEWAYS.map((p) => (
                  <option key={p.id} value={p.id} className="text-ink">
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                aria-label={tr("Title")}
                placeholder={tr("Title")}
                value={draft.title}
                maxLength={80}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className={line}
              />
              <label className="flex items-center gap-2.5 text-[14px] text-ink">
                <input
                  type="checkbox"
                  checked={draft.isDefault}
                  onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
                  className={tickbox}
                />
                {tr("Default")}
              </label>
            </div>
          </FormFrame>
        )}

        {canEdit && !draft && (
          <button
            type="button"
            className={cn(primary, "mt-3")}
            onClick={() =>
              setDraft({ id: null, provider: "", title: "", isDefault: gateways.length === 0 })
            }
          >
            {tr("Add gateway")}
          </button>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Accounting Systems                                                         */
/* -------------------------------------------------------------------------- */

type SystemDraft = { id: string | null; provider: string; isEnabled: boolean };

export function AccountingSystemsPanel({
  systems,
  canEdit,
  pending,
  run,
}: {
  systems: AccountingSystem[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [draft, setDraft] = useState<SystemDraft | null>(null);
  // One row per system: a new one is offered only the systems not yet added.
  const taken = new Set(systems.filter((s) => s.id !== draft?.id).map((s) => s.provider));
  const free = ACCOUNTING_SYSTEMS.filter((s) => !taken.has(s.id));

  function save(d: SystemDraft) {
    run(async () => {
      const result = await saveAccountingSystem(d);
      if (result.ok) setDraft(null);
      return result;
    }, tr("{name} saved.", { name: d.provider ? accountingSystemLabel(d.provider) : tr("Accounting system") }));
  }

  return (
    <div className="max-w-5xl space-y-2">
      <PageHeading title={tr("Accounting Systems")} />
      <section className={cn(card, "px-4 pb-6 pt-6 sm:px-8")}>
        {systems.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={cn(th, "w-[70%]")}>{tr("System")}</th>
                  <th className={th}>{tr("Is Enabled")}</th>
                  <th className="w-20" aria-label={tr("Actions")} />
                </tr>
              </thead>
              <tbody>
                {systems.map((s) => {
                  const label = accountingSystemLabel(s.provider);
                  return (
                    <tr
                      key={s.id}
                      className={cn("border-b border-line", draft?.id === s.id && "bg-shell/70")}
                    >
                      <td className="px-1.5 py-1.5 text-ink">{label}</td>
                      <td className="px-1.5 py-1.5">{s.isEnabled ? <Tick label={tr("Enabled")} /> : null}</td>
                      <td className="py-0.5">
                        {canEdit && (
                          <span className="flex justify-end">
                            <button
                              type="button"
                              aria-label={tr("Edit {name}", { name: label })}
                              className={iconButton}
                              onClick={() =>
                                setDraft({ id: s.id, provider: s.provider, isEnabled: s.isEnabled })
                              }
                            >
                              <EditIcon />
                            </button>
                            <button
                              type="button"
                              aria-label={tr("Delete {name}", { name: label })}
                              className={iconButton}
                              onClick={() => {
                                if (!confirm(tr("Delete {name}?", { name: label }))) return;
                                run(async () => {
                                  const result = await deleteAccountingSystem(s.id);
                                  if (result.ok && draft?.id === s.id) setDraft(null);
                                  return result;
                                }, tr("{name} deleted.", { name: label }));
                              }}
                            >
                              <CrossIcon />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pb-2 text-center text-[13px] text-ink">
            {tr("You do not have any accounting systems connected")}
          </p>
        )}

        {draft && (
          <FormFrame
            title={draft.id ? tr("Edit Accounting System") : tr("Add Accounting System")}
            pending={pending}
            onCancel={() => setDraft(null)}
            onSave={() => save(draft)}
          >
            <div className="mt-4 grid items-end gap-6 sm:grid-cols-2">
              <select
                aria-label={tr("System")}
                value={draft.provider}
                onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
                className={cn(line, "cursor-pointer", draft.provider === "" && "text-ink-muted")}
              >
                <option value="">{tr("System")}</option>
                {free.map((s) => (
                  <option key={s.id} value={s.id} className="text-ink">
                    {s.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2.5 text-[14px] text-ink">
                <input
                  type="checkbox"
                  checked={draft.isEnabled}
                  onChange={(e) => setDraft({ ...draft, isEnabled: e.target.checked })}
                  className={tickbox}
                />
                {tr("Enabled")}
              </label>
            </div>
          </FormFrame>
        )}

        {canEdit && !draft && free.length > 0 && (
          <button
            type="button"
            className={cn(primary, "mt-3")}
            onClick={() => setDraft({ id: null, provider: "", isEnabled: true })}
          >
            {tr("Add accounting system")}
          </button>
        )}
      </section>
    </div>
  );
}
