"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n";
import { cn } from "@/components/ui";
import { saveChannexConnection, testChannexConnection } from "@/lib/actions/settings";
import type { ChannexConnection } from "@/lib/queries";

/*
 * Settings -> Channel Manager -> Channex (0139): the hotel's connection.
 *
 * THE API KEY IS WRITE-ONLY. It goes to Supabase Vault and nothing reads it
 * back, so the field is always empty; a saved one shows as a placeholder and
 * a blank field keeps it. Channex is called from Postgres, never from here.
 *
 * Test connection lists the Channex properties the key can see, so this hotel
 * is mapped by picking one rather than by pasting an id.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "rounded-lg border border-line bg-white shadow-card";
const field =
  "w-full rounded border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const primary =
  "rounded-md bg-chrome-800 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-4 py-2 text-[12.5px] font-semibold text-ink hover:bg-shell disabled:opacity-50";

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <label htmlFor={htmlFor} className="text-[13px] text-ink sm:text-right">
        {label}
      </label>
      <div className="max-w-xl">{children}</div>
    </div>
  );
}

export function ChannexPanel({
  connection,
  timezone,
  canEdit,
  pending,
  run,
}: {
  connection: ChannexConnection | null;
  timezone: string;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const router = useRouter();
  const [environment, setEnvironment] = useState<"staging" | "production">(connection?.environment ?? "staging");
  const [apiKey, setApiKey] = useState("");
  const [propertyId, setPropertyId] = useState(connection?.channexPropertyId ?? "");
  const [isActive, setIsActive] = useState(connection?.isActive ?? false);
  const [found, setFound] = useState<{ id: string; title: string; currency: string | null }[] | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, startTest] = useTransition();

  function save() {
    run(async () => {
      const result = await saveChannexConnection({ environment, apiKey, channexPropertyId: propertyId, isActive });
      if (result.ok) setApiKey("");
      return result;
    }, tr("Channex saved."));
  }

  function test() {
    setTestError(null);
    startTest(async () => {
      const result = await testChannexConnection();
      if (!result.ok) {
        setTestError(result.error ?? "");
        return;
      }
      setFound(result.data.connected ? result.data.properties : null);
      if (!result.data.connected) setTestError(result.data.message);
      router.refresh();
    });
  }

  const status =
    connection?.lastTestedAt == null
      ? null
      : connection.lastTestOk
        ? { ok: true, text: tr("Connected · {when}", { when: tr.stamp(connection.lastTestedAt, timezone) }) }
        : { ok: false, text: `${tr.message(connection.lastTestMessage ?? "")} · ${tr.stamp(connection.lastTestedAt, timezone)}` };

  return (
    <section className={card}>
      <div className="px-4 pb-6 pt-6 sm:px-8">
        <h3 className="border-b border-line pb-2 text-[16px] text-ink">Channex</h3>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Row label={tr("Environment:")} htmlFor="cx-env">
            <select
              id="cx-env"
              value={environment}
              disabled={!canEdit}
              className={field}
              onChange={(e) => setEnvironment(e.target.value === "production" ? "production" : "staging")}
            >
              <option value="staging">{tr("Staging")}</option>
              <option value="production">{tr("Production")}</option>
            </select>
          </Row>
          <Row label={tr("API Key:")} htmlFor="cx-key">
            <input
              id="cx-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              disabled={!canEdit}
              placeholder={connection?.hasKey ? tr("Saved") : ""}
              className={field}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Row>
          <Row label={tr("Channex Property:")} htmlFor="cx-property">
            {found && found.length > 0 ? (
              <select id="cx-property" value={propertyId} disabled={!canEdit} className={field}
                onChange={(e) => setPropertyId(e.target.value)}>
                <option value="">—</option>
                {found.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}{p.currency ? ` (${p.currency})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input id="cx-property" value={propertyId} disabled={!canEdit} className={cn(field, "tnum")}
                onChange={(e) => setPropertyId(e.target.value)} />
            )}
          </Row>
          <Row label={tr("Is Active:")}>
            <input type="checkbox" className="h-4 w-4 accent-brass" checked={isActive} disabled={!canEdit}
              onChange={(e) => setIsActive(e.target.checked)} />
          </Row>
          {status && (
            <Row label={tr("Status:")}>
              <p className={cn("text-[13px]", status.ok ? "text-emerald-700" : "text-rose-700")}>{status.text}</p>
            </Row>
          )}
          {testError && (
            <Row label="">
              <p className="text-[13px] text-rose-700">{testError}</p>
            </Row>
          )}
          {found && found.length === 0 && (
            <Row label="">
              <p className="text-[13px] text-ink-muted">{tr("The key sees no Channex properties yet. Create the property in Channex first.")}</p>
            </Row>
          )}
          {canEdit && (
            <div className="flex gap-2 pt-1 sm:pl-[13rem]">
              <button type="submit" className={primary} disabled={pending}>
                {tr("Save")}
              </button>
              {connection?.hasKey && (
                <button type="button" className={secondary} disabled={testing || pending} onClick={test}>
                  {testing ? tr("Testing…") : tr("Test connection")}
                </button>
              )}
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
