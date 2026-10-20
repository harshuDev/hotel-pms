"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n";
import { cn } from "@/components/ui";
import {
  pushChannexAri,
  runChannexSetup,
  saveChannexConnection,
  testChannexConnection,
} from "@/lib/actions/settings";
import type { ChannexConnection, ChannexLink, ChannexSyncEntry } from "@/lib/queries";

/*
 * Settings -> Channel Manager -> Channex (0139, 0142). The platform team's
 * only: the page draws this for nobody else and every function behind it
 * refuses anybody else.
 *
 * THE API KEY IS WRITE-ONLY. It goes to Supabase Vault and nothing reads it
 * back, so the field is always empty; a saved one shows as a placeholder and
 * a blank field keeps it. Channex is called from Postgres, never from here.
 *
 * Create in Channex makes what is missing -- the property, a room type per
 * room type, a rate plan per (plan, room type) priced from the business
 * date -- and remembers each link. Push sends the rates, availability and
 * restrictions that changed since the last push; Push everything resends the
 * lot. With Is Active ticked, the push also runs every 15 minutes.
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
  overview,
  log,
  timezone,
  pending,
  run,
}: {
  connection: ChannexConnection | null;
  overview: ChannexLink[];
  log: ChannexSyncEntry[];
  timezone: string;
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
  const [working, startWork] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string; lines?: string[] } | null>(null);

  const hasKey = connection?.hasKey ?? false;
  const inChannex = Boolean(connection?.channexPropertyId);
  const busy = pending || working;

  function save() {
    run(async () => {
      const result = await saveChannexConnection({ environment, apiKey, channexPropertyId: propertyId, isActive });
      if (result.ok) setApiKey("");
      return result;
    }, tr("Channex saved."));
  }

  function test() {
    setTestError(null);
    startWork(async () => {
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

  function setup() {
    setOutcome(null);
    startWork(async () => {
      const result = await runChannexSetup();
      if (!result.ok) {
        setOutcome({ ok: false, text: result.error });
        return;
      }
      const { created, failed } = result.data;
      setOutcome({
        ok: failed.length === 0,
        text:
          failed.length === 0
            ? tr.plural(created, "{n} item created in Channex.", "{n} items created in Channex.")
            : tr("{created} created, {failed} refused by Channex.", { created, failed: failed.length }),
        lines: failed.map((f) => `${f.label}: ${tr.message(f.detail)}`),
      });
      router.refresh();
    });
  }

  function push(full: boolean) {
    setOutcome(null);
    startWork(async () => {
      const result = await pushChannexAri(full);
      if (!result.ok) {
        setOutcome({ ok: false, text: result.error });
        return;
      }
      setOutcome(
        result.data.error
          ? { ok: false, text: result.data.error }
          : result.data.sent === 0
            ? { ok: true, text: tr("Channex is up to date.") }
            : { ok: true, text: tr.plural(result.data.sent, "{n} date range sent to Channex.", "{n} date ranges sent to Channex.") },
      );
      router.refresh();
    });
  }

  const status =
    connection?.lastTestedAt == null
      ? null
      : connection.lastTestOk
        ? { ok: true, text: tr("Connected · {when}", { when: tr.stamp(connection.lastTestedAt, timezone) }) }
        : { ok: false, text: `${tr.message(connection.lastTestMessage ?? "")} · ${tr.stamp(connection.lastTestedAt, timezone)}` };

  const roomTypes = overview.filter((l) => l.kind === "room_type");
  const ratePlans = overview.filter((l) => l.kind === "rate_plan");
  const missing = overview.filter((l) => !l.channexId).length;

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
              placeholder={hasKey ? tr("Saved") : ""}
              className={field}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Row>
          <Row label={tr("Channex Property:")} htmlFor="cx-property">
            {found && found.length > 0 ? (
              <select id="cx-property" value={propertyId} className={field} onChange={(e) => setPropertyId(e.target.value)}>
                <option value="">{tr("Create a new one")}</option>
                {found.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                    {p.currency ? ` (${p.currency})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="cx-property"
                value={propertyId}
                className={cn(field, "tnum")}
                onChange={(e) => setPropertyId(e.target.value)}
              />
            )}
          </Row>
          <Row label={tr("Is Active:")}>
            <input
              type="checkbox"
              className="h-4 w-4 accent-brass"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
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
              <p className="text-[13px] text-ink-muted">{tr("The key sees no Channex properties yet.")}</p>
            </Row>
          )}
          <div className="flex flex-wrap gap-2 pt-1 sm:pl-[13rem]">
            <button type="submit" className={primary} disabled={busy}>
              {tr("Save")}
            </button>
            {hasKey && (
              <button type="button" className={secondary} disabled={busy} onClick={test}>
                {working ? tr("Working…") : tr("Test connection")}
              </button>
            )}
          </div>
        </form>

        {hasKey && (
          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
              <h4 className="text-[14px] font-semibold text-ink">{tr("Room types and rate plans")}</h4>
              <div className="flex flex-wrap gap-2">
                {(missing > 0 || !inChannex) && (
                  <button type="button" className={primary} disabled={busy} onClick={setup}>
                    {tr("Create in Channex")}
                  </button>
                )}
                {inChannex && (
                  <>
                    <button type="button" className={secondary} disabled={busy} onClick={() => push(false)}>
                      {tr("Push rates and availability")}
                    </button>
                    <button type="button" className={secondary} disabled={busy} onClick={() => push(true)}>
                      {tr("Push everything")}
                    </button>
                  </>
                )}
              </div>
            </div>

            {outcome && (
              <div className={cn("mt-3 text-[13px]", outcome.ok ? "text-emerald-700" : "text-rose-700")}>
                <p>{outcome.text}</p>
                {outcome.lines && outcome.lines.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-ink-muted">
                    {outcome.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-[13px]">
                <thead>
                  <tr className="bg-shell text-left text-xxs uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2 font-medium">{tr("Room type")}</th>
                    <th className="px-3 py-2 font-medium">{tr("Rate plan")}</th>
                    <th className="px-3 py-2 font-medium">{tr("Currency")}</th>
                    <th className="px-3 py-2 font-medium">Channex</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {roomTypes.map((t) => (
                    <LinkRows key={t.roomTypeId} type={t} plans={ratePlans.filter((p) => p.roomTypeId === t.roomTypeId)} />
                  ))}
                </tbody>
              </table>
            </div>

            {log.length > 0 && (
              <div className="mt-6">
                <h4 className="border-b border-line pb-2 text-[14px] font-semibold text-ink">{tr("Recent runs")}</h4>
                <ul className="mt-2 divide-y divide-line text-[13px]">
                  {log.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                      <span className="tnum w-28 shrink-0 text-ink-muted">{tr.stamp(entry.createdAt, timezone)}</span>
                      <span className="w-20 shrink-0 text-ink">{entry.kind === "setup" ? tr("Setup") : tr("Push")}</span>
                      <span className={cn("shrink-0", entry.ok ? "text-emerald-700" : "text-rose-700")}>
                        {entry.ok
                          ? tr("{sent} sent", { sent: entry.sent })
                          : tr("{sent} sent, {failed} failed", { sent: entry.sent, failed: entry.failed })}
                      </span>
                      {entry.message && <span className="min-w-0 truncate text-ink-faint">{tr.message(entry.message)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function LinkRows({ type, plans }: { type: ChannexLink; plans: ChannexLink[] }) {
  const tr = useT();
  const mark = (id: string | null) =>
    id ? (
      <span className="text-emerald-700" title={id}>
        {tr("Created")}
      </span>
    ) : (
      <span className="text-ink-faint">{tr("Not in Channex")}</span>
    );
  return (
    <>
      <tr>
        <td className="px-3 py-2 font-medium text-ink">{type.roomTypeName}</td>
        <td className="px-3 py-2 text-ink-faint">—</td>
        <td className="px-3 py-2" />
        <td className="px-3 py-2">{mark(type.channexId)}</td>
      </tr>
      {plans.map((p) => (
        <tr key={`${p.ratePlanId}-${p.roomTypeId}`}>
          <td className="px-3 py-2" />
          <td className="px-3 py-2 text-ink">{p.ratePlanName}</td>
          <td className="tnum px-3 py-2 text-ink-muted">{p.currency}</td>
          <td className="px-3 py-2">{mark(p.channexId)}</td>
        </tr>
      ))}
    </>
  );
}
