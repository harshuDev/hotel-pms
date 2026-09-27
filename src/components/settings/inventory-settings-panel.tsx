"use client";

import { useT } from "@/components/i18n";
import { useState } from "react";
import { cn } from "@/components/ui";
import {
  INVENTORY_VISIBILITY,
  type InventorySettings,
  type InventoryVisibility,
} from "@/lib/inventory-settings";
import {
  saveInventoryVisibility,
  saveOnlineBookingCutoff,
  saveSameDayBookingCutoff,
} from "@/lib/actions/settings";

/*
 * Settings -> Inventory -> Settings (0088), cloned from the client's
 * reference: three cards, each saving only its own fields.
 *
 * All three are live. The cut-offs govern the guest booking page, decided in
 * Postgres so the endpoint agrees with the page. A visibility tick takes that
 * restriction's screen out of the Inventory menu -- and Postgres refuses to
 * hide one still set on a night to come, so hiding never leaves a rule working
 * unseen.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "overflow-hidden rounded border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const tickbox = "h-4 w-4 accent-brass";
const field =
  "border-0 border-b border-line bg-transparent px-0.5 py-1 text-[14px] text-ink outline-none focus:border-brass disabled:opacity-100";

function Card({
  title,
  canEdit,
  pending,
  onSave,
  children,
}: {
  title: string;
  canEdit: boolean;
  pending: boolean;
  onSave: () => void;
  children: React.ReactNode;
}) {
  const tr = useT();
  return (
    <section className={card}>
      <div className="px-5 pb-6 pt-5">
        <h3 className="border-b border-line pb-1 text-[15px] text-ink">{title}</h3>
        <div className="mt-3">{children}</div>
      </div>
      {canEdit && (
        <div className="flex justify-end border-t border-line bg-shell/60 px-4 py-3">
          <button type="button" className={primary} disabled={pending} onClick={onSave}>
            {tr("Save")}
          </button>
        </div>
      )}
    </section>
  );
}

function Tick({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex w-fit items-center gap-2 py-1.5 text-[13px] text-ink">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={tickbox}
      />
      {label}
    </label>
  );
}

export function InventorySettingsPanel({
  settings,
  businessDate,
  canEdit,
  pending,
  run,
}: {
  settings: InventorySettings;
  /** The earliest cut-off date Postgres accepts. */
  businessDate: string;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [cutoff, setCutoff] = useState({
    enabled: settings.onlineCutoffEnabled,
    date: settings.onlineCutoffDate ?? "",
  });
  const [sameDay, setSameDay] = useState({
    enabled: settings.sameDayCutoffEnabled,
    time: settings.sameDayCutoffTime ?? "",
  });
  const [visibility, setVisibility] = useState<InventoryVisibility>(settings.visibility);

  return (
    <div className="max-w-5xl space-y-5">
      <h2 className="border-b border-line pb-0.5 text-[17px] text-ink">{tr("Inventory Settings")}</h2>

      <Card
        title={tr("Online Booking Cut Off Date")}
        canEdit={canEdit}
        pending={pending}
        onSave={() =>
          run(
            () => saveOnlineBookingCutoff({ enabled: cutoff.enabled, date: cutoff.date || null }),
            tr("Online booking cut-off date saved."),
          )
        }
      >
        <Tick
          label={tr("Set Cut-Off Date")}
          checked={cutoff.enabled}
          disabled={!canEdit}
          onChange={(enabled) => setCutoff({ ...cutoff, enabled })}
        />
        {cutoff.enabled && (
          <input
            type="date"
            aria-label={tr("Cut-off date")}
            value={cutoff.date}
            min={businessDate}
            disabled={!canEdit}
            onChange={(e) => setCutoff({ ...cutoff, date: e.target.value })}
            className={cn(field, "tnum mt-2 w-48")}
          />
        )}
      </Card>

      <Card
        title={tr("Same Day Booking Cut Off Time")}
        canEdit={canEdit}
        pending={pending}
        onSave={() =>
          run(
            () => saveSameDayBookingCutoff({ enabled: sameDay.enabled, time: sameDay.time || null }),
            tr("Same day booking cut-off time saved."),
          )
        }
      >
        <Tick
          label={tr("Set Time")}
          checked={sameDay.enabled}
          disabled={!canEdit}
          onChange={(enabled) => setSameDay({ ...sameDay, enabled })}
        />
        {sameDay.enabled && (
          <input
            type="time"
            aria-label={tr("Cut-off time")}
            value={sameDay.time}
            disabled={!canEdit}
            onChange={(e) => setSameDay({ ...sameDay, time: e.target.value })}
            className={cn(field, "tnum mt-2 w-32")}
          />
        )}
      </Card>

      <Card
        title={tr("Inventory Options Visibility")}
        canEdit={canEdit}
        pending={pending}
        onSave={() => run(() => saveInventoryVisibility(visibility), tr("Inventory options visibility saved."))}
      >
        <div className="space-y-1.5">
          {INVENTORY_VISIBILITY.map((v) => (
            <Tick
              key={v.field}
              label={tr(v.label)}
              checked={visibility[v.field]}
              disabled={!canEdit}
              onChange={(checked) => setVisibility({ ...visibility, [v.field]: checked })}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
