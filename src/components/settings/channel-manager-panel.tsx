"use client";

import { useT } from "@/components/i18n";
import { useState } from "react";
import { cn } from "@/components/ui";
import { Menu, MenuItem } from "@/components/menu";
import { EditIcon } from "@/components/settings/finance-panels";
import { formatStampInProperty } from "@/lib/dates";
import {
  CHANNEL_MANAGERS,
  DAYS_TO_SYNC,
  MAX_CONFIG_CHARS,
  REGIONS,
  channelManagerLabel,
  type ChannelManager,
  type ChannelManagerProvider,
} from "@/lib/channel-managers";
import {
  deleteChannelManager,
  getChannelManagerConfig,
  saveChannelManager,
} from "@/lib/actions/settings";

/*
 * Settings -> Connectivity Settings -> Channel Manager (0097), cloned from the
 * client's reference: the Channel Managers list (Title, Is Active, Is Synced,
 * Synced At), ADD CHANNEL offering Site Minder or Vertical Booking, and each
 * one's own form opening inside the card.
 *
 * STORED, NOT YET CONNECTED: nothing syncs, so Is Synced reads No.
 *
 * THE PASSWORD IS WRITE-ONLY. It goes to Supabase Vault and nothing reads it
 * back, so the field is always empty; a saved one shows as a placeholder, and
 * leaving the field blank keeps it.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

/** undefined keeps the saved file, null removes it, a value replaces it. */
type FileDraft = { name: string; csv: string } | null | undefined;

type Draft = {
  id: string | null;
  provider: ChannelManagerProvider;
  connectionName: string;
  isActive: boolean;
  username: string;
  password: string;
  hasPassword: boolean;
  hotelCode: string;
  requestorId: string;
  region: string;
  daysToSync: number;
  syncMultiOccupancy: boolean;
  savedRoomConfig: string | null;
  savedRateConfig: string | null;
  roomConfig: FileDraft;
  rateConfig: FileDraft;
};

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[12px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-5 py-2 text-[12px] font-semibold uppercase tracking-wide text-ink hover:bg-shell disabled:opacity-50";
const th = "px-1.5 py-3 text-left text-[12.5px] font-semibold text-ink";
const iconButton =
  "grid h-8 w-8 place-items-center rounded text-brass hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const field =
  "w-full rounded border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-brass";
const labelCls = "pt-1.5 text-[13px] text-ink-muted";
const tickbox = "h-[16px] w-[16px] accent-brass";

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function newDraft(provider: ChannelManagerProvider): Draft {
  return {
    id: null,
    provider,
    connectionName: "",
    isActive: false,
    username: "",
    password: "",
    hasPassword: false,
    hotelCode: "",
    requestorId: "",
    region: "",
    daysToSync: 400,
    syncMultiOccupancy: false,
    savedRoomConfig: null,
    savedRateConfig: null,
    roomConfig: undefined,
    rateConfig: undefined,
  };
}

function draftOf(c: ChannelManager): Draft {
  return {
    id: c.id,
    provider: c.provider,
    connectionName: c.connectionName,
    isActive: c.isActive,
    username: c.username ?? "",
    password: "",
    hasPassword: c.hasPassword,
    hotelCode: c.hotelCode ?? "",
    requestorId: c.requestorId ?? "",
    region: c.region ?? "",
    daysToSync: c.daysToSync,
    syncMultiOccupancy: c.syncMultiOccupancy,
    savedRoomConfig: c.roomConfigName,
    savedRateConfig: c.rateConfigName,
    roomConfig: undefined,
    rateConfig: undefined,
  };
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[16rem_1fr] sm:gap-4">
      <label htmlFor={htmlFor} className={labelCls}>
        {label}
      </label>
      <div>{children}</div>
    </div>
  );
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ConfigFileField({
  id,
  label,
  connectionId,
  which,
  saved,
  value,
  onChange,
  onError,
}: {
  id: string;
  label: string;
  connectionId: string | null;
  which: "room" | "rate";
  saved: string | null;
  value: FileDraft;
  onChange: (v: FileDraft) => void;
  onError: (message: string) => void;
}) {
  const tr = useT();
  const current = value === undefined ? saved : value === null ? null : value.name;
  return (
    <Row label={label} htmlFor={id}>
      <input
        id={id}
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const csv = await file.text();
          if (csv.length > MAX_CONFIG_CHARS) {
            onError(`${file.name} is larger than 256 KB.`);
            return;
          }
          onChange({ name: file.name, csv });
        }}
        className={cn(field, "py-1 file:mr-3 file:rounded file:border file:border-line file:bg-shell file:px-2 file:py-0.5 file:text-[12px] file:text-ink")}
      />
      {current && (
        <p className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-ink-muted">
          <span className="text-ink">{current}</span>
          {value === undefined && connectionId && (
            <button
              type="button"
              className="text-brass hover:underline"
              onClick={async () => {
                const result = await getChannelManagerConfig(connectionId, which);
                if (result.ok) download(result.data.name, result.data.csv);
                else onError(result.error);
              }}
            >
              {tr("Download")}
            </button>
          )}
          <button type="button" className="text-rose-700 hover:underline" onClick={() => onChange(saved ? null : undefined)}>
            {tr("Remove")}
          </button>
        </p>
      )}
    </Row>
  );
}

export function ChannelManagerPanel({
  channelManagers,
  timezone,
  canEdit,
  pending,
  run,
}: {
  channelManagers: ChannelManager[];
  timezone: string;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const taken = new Set(channelManagers.map((c) => c.provider));
  const free = CHANNEL_MANAGERS.filter((c) => !taken.has(c.id));

  function set(patch: Partial<Draft>) {
    if (draft) setDraft({ ...draft, ...patch });
  }

  function save(d: Draft) {
    setFileError(null);
    const vb = d.provider === "vertical_booking";
    run(async () => {
      const result = await saveChannelManager({
        id: d.id,
        provider: d.provider,
        connectionName: d.connectionName,
        isActive: d.isActive,
        username: d.username,
        password: d.password,
        hotelCode: d.hotelCode,
        requestorId: vb ? d.requestorId : "",
        region: vb || d.region === "" ? null : d.region,
        daysToSync: d.daysToSync,
        syncMultiOccupancy: vb && d.syncMultiOccupancy,
        roomConfig: d.roomConfig,
        rateConfig: vb ? d.rateConfig : undefined,
      });
      if (result.ok) setDraft(null);
      return result;
    }, `${d.connectionName.trim() || channelManagerLabel(d.provider)} saved.`);
  }

  const vb = draft?.provider === "vertical_booking";
  const who = vb ? "Vertical Booking" : "Site Minder";

  return (
    <div className="max-w-6xl space-y-2">
      <h2 className="border-b border-line pb-1 text-[24px] text-ink">{tr("Channel Manager Settings")}</h2>
      <section className={card}>
        <div className="px-4 pb-6 pt-6 sm:px-8">
          <h3 className="border-b border-line pb-2 text-[16px] text-ink">{tr("Channel Managers")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={cn(th, "w-[40%]")}>{tr("Title")}</th>
                  <th className={th}>{tr("Is Active")}</th>
                  <th className={th}>{tr("Is Synced")}</th>
                  <th className={th}>{tr("Synced At")}</th>
                  <th className="w-20" aria-label={tr("Actions")} />
                </tr>
              </thead>
              <tbody>
                {channelManagers.map((c) => (
                  <tr key={c.id} className={cn("border-b border-line", draft?.id === c.id && "bg-shell/70")}>
                    <td className="px-1.5 py-1.5 text-ink">
                      {c.connectionName}
                      <span className="ml-2 text-[11.5px] text-ink-muted">{channelManagerLabel(c.provider)}</span>
                    </td>
                    <td className="px-1.5 py-1.5 text-ink">{c.isActive ? tr("Yes") : tr("No")}</td>
                    <td className="px-1.5 py-1.5 text-ink">{c.isSynced ? tr("Yes") : tr("No")}</td>
                    <td className="tnum px-1.5 py-1.5 text-ink">
                      {c.syncedAt ? formatStampInProperty(c.syncedAt, timezone) : "—"}
                    </td>
                    <td className="py-0.5">
                      {canEdit && (
                        <span className="flex justify-end">
                          <button type="button" aria-label={`Edit ${c.connectionName}`} className={iconButton}
                            onClick={() => { setFileError(null); setDraft(draftOf(c)); }}>
                            <EditIcon />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${c.connectionName}`}
                            className={iconButton}
                            onClick={() => {
                              if (!confirm(`Delete ${c.connectionName}? Its saved password goes with it.`)) return;
                              run(async () => {
                                const result = await deleteChannelManager(c.id);
                                if (result.ok && draft?.id === c.id) setDraft(null);
                                return result;
                              }, `${c.connectionName} deleted.`);
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

          {draft && (
            <form
              className="mt-2 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save(draft);
              }}
            >
              <Row label={tr("Name:")}>
                <p className="rounded border border-line bg-shell px-2.5 py-1.5 text-[13px] text-ink-muted">
                  {draft.provider}
                </p>
              </Row>
              <Row label={tr("Connection Name")} htmlFor="cm-name">
                <input id="cm-name" value={draft.connectionName} maxLength={80} autoFocus
                  onChange={(e) => set({ connectionName: e.target.value })} className={field} />
              </Row>
              <div className="flex justify-center py-1">
                <label className="flex items-center gap-2 text-[13px] text-ink">
                  <input type="checkbox" checked={draft.isActive} className={tickbox}
                    onChange={(e) => set({ isActive: e.target.checked })} />
                  {tr("Is Active")}
                </label>
              </div>
              <Row label={vb ? `${who} Username` : `${who} Username:`} htmlFor="cm-user">
                <input id="cm-user" value={draft.username} maxLength={120} autoComplete="off"
                  onChange={(e) => set({ username: e.target.value })} className={field} />
              </Row>
              <Row label={vb ? `${who} password` : `${who} password:`} htmlFor="cm-pass">
                <input id="cm-pass" type="password" value={draft.password} maxLength={200}
                  autoComplete="new-password"
                  placeholder={draft.hasPassword ? tr("Saved") : ""}
                  onChange={(e) => set({ password: e.target.value })} className={field} />
              </Row>
              {vb && (
                <Row label={tr("Requestor ID")} htmlFor="cm-req">
                  <input id="cm-req" value={draft.requestorId} maxLength={60}
                    onChange={(e) => set({ requestorId: e.target.value })} className={field} />
                </Row>
              )}
              <Row label={vb ? tr("Hotel ID") : tr("Hotel Code:")} htmlFor="cm-hotel">
                <input id="cm-hotel" value={draft.hotelCode} maxLength={60}
                  onChange={(e) => set({ hotelCode: e.target.value })} className={field} />
              </Row>
              {!vb && (
                <Row label={tr("Region:")} htmlFor="cm-region">
                  <select id="cm-region" value={draft.region} onChange={(e) => set({ region: e.target.value })}
                    className={cn(field, "cursor-pointer")}>
                    <option value="" />
                    {REGIONS.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                </Row>
              )}
              <Row label={tr("Days to sync:")} htmlFor="cm-days">
                <select id="cm-days" value={draft.daysToSync}
                  onChange={(e) => set({ daysToSync: Number(e.target.value) })}
                  className={cn(field, "cursor-pointer")}>
                  {DAYS_TO_SYNC.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </Row>
              <ConfigFileField
                id="cm-room"
                label={vb ? tr("Room CVS configuration") : tr("Room & Rate configuration")}
                connectionId={draft.id}
                which="room"
                saved={draft.savedRoomConfig}
                value={draft.roomConfig}
                onChange={(roomConfig) => set({ roomConfig })}
                onError={setFileError}
              />
              {vb && (
                <ConfigFileField
                  id="cm-rate"
                  label={tr("Rate CVS configuration")}
                  connectionId={draft.id}
                  which="rate"
                  saved={draft.savedRateConfig}
                  value={draft.rateConfig}
                  onChange={(rateConfig) => set({ rateConfig })}
                  onError={setFileError}
                />
              )}
              {vb && (
                <div className="flex justify-center py-1">
                  <label className="flex items-center gap-2 text-[13px] text-ink">
                    <input type="checkbox" checked={draft.syncMultiOccupancy} className={tickbox}
                      onChange={(e) => set({ syncMultiOccupancy: e.target.checked })} />
                    {tr("Sync as multi occupancy rates")}
                  </label>
                </div>
              )}
              <p className="text-center text-[12px] text-ink">{tr("Upload CSV Configuration to allocate Rooms and Rates")}</p>
              {fileError && <p role="alert" className="text-center text-[12.5px] text-rose-700">{fileError}</p>}
              <div className="flex justify-end gap-3">
                <button type="submit" className={primary} disabled={pending}>{tr("Save")}</button>
                <button type="button" className={secondary} onClick={() => { setFileError(null); setDraft(null); }}>
                  {tr("Cancel")}
                </button>
              </div>
            </form>
          )}
        </div>

        {canEdit && !draft && free.length > 0 && (
          <div className="rounded-b-lg border-t border-line bg-shell px-4 py-4 sm:px-8">
            <Menu
              label={tr("Add channel")}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              triggerClassName={primary}
            >
              {free.map((c) => (
                <MenuItem
                  key={c.id}
                  onSelect={() => {
                    setMenuOpen(false);
                    setFileError(null);
                    setDraft(newDraft(c.id));
                  }}
                >
                  {c.label}
                </MenuItem>
              ))}
            </Menu>
          </div>
        )}
      </section>
    </div>
  );
}
