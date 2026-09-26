"use client";

import { useState } from "react";
import { cn } from "@/components/ui";
import { Menu, MenuItem } from "@/components/menu";
import { EditIcon } from "@/components/settings/finance-panels";
import {
  SYSTEM_CATEGORIES,
  systemProvider,
  type SystemCategory,
  type SystemConnection,
  type SystemProvider,
} from "@/lib/system-connections";
import { deleteSystemConnection, saveSystemConnection } from "@/lib/actions/settings";

/*
 * Settings -> Connectivity Settings -> Key Lock Systems (0102) and
 * Housekeeping Systems (0103), cloned from the client's reference: the list,
 * "No Data" when empty, and Add offering the category's systems. One panel
 * for both, over one table. STORED, NOT YET CONNECTED. The secret is
 * write-only (Supabase Vault), exactly like a channel manager's password.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

type Draft = {
  id: string | null;
  provider: string;
  name: string;
  isActive: boolean;
  accountId: string;
  secret: string;
  hasSecret: boolean;
};

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-4 py-2 text-[12px] font-semibold text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-4 py-2 text-[12px] font-semibold text-ink hover:bg-shell";
const field =
  "w-full rounded border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-brass";

function Row({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <label htmlFor={htmlFor} className="pt-1.5 text-[13px] text-ink-muted">{label}</label>
      <div>{children}</div>
    </div>
  );
}

export function SystemConnectionsPanel({
  category,
  systems,
  canEdit,
  pending,
  run,
}: {
  category: SystemCategory;
  systems: SystemConnection[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const taken = new Set(systems.map((s) => s.provider));
  const providers: readonly SystemProvider[] = SYSTEM_CATEGORIES[category].providers;
  const free = providers.filter((p) => !taken.has(p.id));
  const labels = draft ? systemProvider(category, draft.provider) : null;

  function save(d: Draft) {
    run(async () => {
      const result = await saveSystemConnection({
        id: d.id,
        provider: d.provider,
        name: d.name,
        isActive: d.isActive,
        accountId: d.accountId,
        secret: d.secret,
      });
      if (result.ok) setDraft(null);
      return result;
    }, `${d.name.trim() || systemProvider(category, d.provider).label} saved.`);
  }

  return (
    <div className="max-w-6xl space-y-2">
      <h2 className="border-b border-line pb-1 text-[24px] text-ink">{SYSTEM_CATEGORIES[category].title}</h2>
      <section className={cn(card, "px-4 py-5 sm:px-6")}>
        {systems.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-ink-faint">
            <svg viewBox="0 0 48 36" className="h-10 w-14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M6 20 12 6h24l6 14v10H6z" />
              <path d="M6 20h11l2 4h10l2-4h11" />
            </svg>
            <p className="mt-2 text-[13px]">No Data</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <th className="px-2 py-2.5 text-left font-semibold text-ink">Title</th>
                <th className="px-2 py-2.5 text-left font-semibold text-ink">System</th>
                <th className="px-2 py-2.5 text-left font-semibold text-ink">Is Active</th>
                <th className="w-20" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {systems.map((s) => (
                <tr key={s.id} className={cn("border-b border-line", draft?.id === s.id && "bg-shell/70")}>
                  <td className="px-2 py-1.5 text-ink">{s.name}</td>
                  <td className="px-2 py-1.5 text-ink-muted">{systemProvider(category, s.provider).label}</td>
                  <td className="px-2 py-1.5 text-ink">{s.isActive ? "Yes" : "No"}</td>
                  <td className="py-0.5">
                    {canEdit && (
                      <span className="flex justify-end">
                        <button type="button" aria-label={`Edit ${s.name}`}
                          className="grid h-8 w-8 place-items-center rounded text-brass hover:bg-shell"
                          onClick={() =>
                            setDraft({
                              id: s.id, provider: s.provider, name: s.name, isActive: s.isActive,
                              accountId: s.accountId ?? "", secret: "", hasSecret: s.hasSecret,
                            })
                          }>
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${s.name}`}
                          className="grid h-8 w-8 place-items-center rounded text-brass hover:bg-shell"
                          onClick={() => {
                            if (!confirm(`Delete ${s.name}? Its saved secret goes with it.`)) return;
                            run(async () => {
                              const result = await deleteSystemConnection(s.id);
                              if (result.ok && draft?.id === s.id) setDraft(null);
                              return result;
                            }, `${s.name} deleted.`);
                          }}
                        >
                          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor"
                            strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {draft && labels && (
          <form
            className="mt-4 space-y-3 rounded border border-line p-4"
            onSubmit={(e) => {
              e.preventDefault();
              save(draft);
            }}
          >
            <h3 className="border-b border-line pb-1 text-[15px] text-ink">{labels.label}</h3>
            <Row label="Name" htmlFor="kl-name">
              <input id="kl-name" value={draft.name} maxLength={80} autoFocus
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} />
            </Row>
            <Row label={labels.account} htmlFor="kl-account">
              <input id="kl-account" value={draft.accountId} maxLength={200} autoComplete="off"
                onChange={(e) => setDraft({ ...draft, accountId: e.target.value })} className={field} />
            </Row>
            <Row label={labels.secret} htmlFor="kl-secret">
              <input id="kl-secret" type="password" value={draft.secret} maxLength={500} autoComplete="new-password"
                placeholder={draft.hasSecret ? "Saved" : ""}
                onChange={(e) => setDraft({ ...draft, secret: e.target.value })} className={field} />
            </Row>
            <label className="flex items-center gap-2 text-[13px] text-ink sm:pl-[13rem]">
              <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              Is Active
            </label>
            <div className="flex justify-end gap-3">
              <button type="button" className={secondary} onClick={() => setDraft(null)}>Cancel</button>
              <button type="submit" className={primary} disabled={pending}>Save</button>
            </div>
          </form>
        )}

        {canEdit && !draft && free.length > 0 && (
          <div className="mt-4">
            <Menu label="Add" open={menuOpen} onOpenChange={setMenuOpen} triggerClassName={primary}
              triggerContent={<span>Add</span>}>
              {free.map((p) => (
                <MenuItem
                  key={p.id}
                  onSelect={() => {
                    setMenuOpen(false);
                    setDraft({ id: null, provider: p.id, name: p.label, isActive: false, accountId: "", secret: "", hasSecret: false });
                  }}
                >
                  {p.label}
                </MenuItem>
              ))}
            </Menu>
          </div>
        )}
      </section>
    </div>
  );
}
