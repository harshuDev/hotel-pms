"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n";
import { cn } from "@/components/ui";
import Link from "next/link";
import {
  pullChannexBookings,
  pushChannexAri,
  saveChannexConnection,
  sendChannexRoomTypes,
  testChannexConnection,
} from "@/lib/actions/settings";
import { formatMoney } from "@/lib/money";
import type { ChannexBookingRevision, ChannexConnection, ChannexRoom, ChannexSyncEntry } from "@/lib/queries";

/*
 * Settings -> Channel Manager -> Channex (0139, 0142, 0144, 0145). The platform team's
 * only: the page draws this for nobody else and every function behind it
 * refuses anybody else.
 *
 * THE API KEY IS WRITE-ONLY. It goes to Supabase Vault and nothing reads it
 * back, so the field is always empty; a saved one shows as a placeholder and
 * a blank field keeps it. Channex is called from Postgres, never from here.
 *
 * The room list is the client's (0143): every room type with its name,
 * rooms left tonight and the main rate's price tonight, each with a tick.
 * "Send to Channex" sends only the ticked ones -- created in Channex, or
 * updated when already there -- and makes their plans match the ticks under
 * them (0148-0149): a ticked plan goes on Channex, an unticked one in Channex
 * comes off it, or is closed (stop sell) when Channex will not remove it
 * because an OTA is mapped to it. A plan's tick starts as Channex has it;
 * changing one ticks its room type. Then it pushes their rates and
 * availability at once, so only what was sent appears on Channex's Inventory
 * page. Push sends what changed since the last push; Push everything resends
 * 500 days, which Channex asks for at most once a day. With Is Active ticked, changes go every minute and everything
 * once a night.
 *
 * Bookings come IN from Channex's booking revisions feed every minute (0144)
 * while Is Active is ticked. "Pull bookings now" takes what is waiting at
 * once; the next minute's run tells Channex they arrived.
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
  rooms,
  log,
  bookings,
  timezone,
  pending,
  run,
}: {
  connection: ChannexConnection | null;
  rooms: ChannexRoom[];
  log: ChannexSyncEntry[];
  bookings: ChannexBookingRevision[];
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
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // Plan ticks changed on screen, keyed "<room type id>|<rate plan id>". A plan
  // not changed is ticked exactly when it is open in Channex (0149).
  const [planTicks, setPlanTicks] = useState<Map<string, boolean>>(new Map());

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
      // A key typed but not saved would otherwise be ignored: the test uses
      // the saved key (0146).
      if (apiKey.trim()) {
        const saved = await saveChannexConnection({ environment, apiKey, channexPropertyId: propertyId, isActive });
        if (!saved.ok) {
          setTestError(saved.error ?? "");
          return;
        }
        setApiKey("");
      }
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

  const planKey = (roomTypeId: string, ratePlanId: string) => `${roomTypeId}|${ratePlanId}`;
  const planTicked = (room: ChannexRoom, plan: ChannexRoom["plans"][number]) =>
    planTicks.get(planKey(room.roomTypeId, plan.ratePlanId)) ?? plan.state === "open";

  /*
   * A room type is ticked to be sent. Its plans' ticks then say what Channex
   * should hold: a ticked plan goes on (or opens), an unticked plan in Channex
   * comes off. A room type with nothing in Channex yet ticks all its plans; an
   * unticked room type goes back to how Channex has it, so nothing on it changes.
   */
  function setRoom(room: ChannexRoom, on: boolean, plans: Map<string, boolean>) {
    const empty = room.plans.every((p) => p.state === null);
    for (const plan of room.plans) {
      const key = planKey(room.roomTypeId, plan.ratePlanId);
      if (on && empty) plans.set(key, true);
      if (!on) plans.delete(key);
    }
  }

  function toggle(room: ChannexRoom) {
    const on = !ticked.has(room.roomTypeId);
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(room.roomTypeId);
      else next.delete(room.roomTypeId);
      return next;
    });
    setPlanTicks((current) => {
      const next = new Map(current);
      setRoom(room, on, next);
      return next;
    });
  }

  // Changing a plan ticks its room type: that is what makes the change go.
  function togglePlan(room: ChannexRoom, plan: ChannexRoom["plans"][number]) {
    const key = planKey(room.roomTypeId, plan.ratePlanId);
    const on = !planTicked(room, plan);
    setPlanTicks((current) => new Map(current).set(key, on));
    setTicked((current) => new Set(current).add(room.roomTypeId));
  }

  function tickAll(on: boolean) {
    setTicked(on ? new Set(rooms.map((r) => r.roomTypeId)) : new Set());
    setPlanTicks((current) => {
      const next = new Map(current);
      for (const room of rooms) setRoom(room, on, next);
      return next;
    });
  }

  function send() {
    setOutcome(null);
    if (ticked.size === 0) {
      setOutcome({ ok: false, text: tr("Tick the room types to send to Channex.") });
      return;
    }
    startWork(async () => {
      const ratePlans = rooms
        .filter((room) => ticked.has(room.roomTypeId))
        .flatMap((room) =>
          room.plans
            .filter((plan) => planTicked(room, plan))
            .map((plan) => ({ roomTypeId: room.roomTypeId, ratePlanId: plan.ratePlanId })),
        );
      const result = await sendChannexRoomTypes([...ticked], ratePlans);
      if (!result.ok) {
        setOutcome({ ok: false, text: result.error });
        return;
      }
      const { sent, plans, removed, closed, kept, failed, pushError } = result.data;
      const lines = failed.map((f) => `${f.label}: ${f.detail}`);
      // Channex will not remove a plan an OTA is mapped to; it is closed instead.
      for (const label of closed) {
        lines.push(tr("{plan}: closed in Channex, because a channel is mapped to it.", { plan: label }));
      }
      // Channex cannot change a plan's occupancies; a mapped plan is not rebuilt (0151).
      for (const label of kept) {
        lines.push(tr("{plan}: kept as it is in Channex, because a channel is mapped to it.", { plan: label }));
      }
      if (pushError) lines.push(pushError);
      setOutcome({
        ok: failed.length === 0 && !pushError,
        text: [
          tr.plural(sent, "{n} room type sent to Channex.", "{n} room types sent to Channex."),
          plans > 0 ? tr.plural(plans, "{n} rate plan sent to Channex.", "{n} rate plans sent to Channex.") : null,
          removed > 0
            ? tr.plural(removed, "{n} rate plan removed from Channex.", "{n} rate plans removed from Channex.")
            : null,
        ]
          .filter(Boolean)
          .join(" "),
        lines,
      });
      if (failed.length === 0) {
        setTicked(new Set());
        setPlanTicks(new Map());
      }
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

  function pull() {
    setOutcome(null);
    startWork(async () => {
      const result = await pullChannexBookings();
      if (!result.ok) {
        setOutcome({ ok: false, text: result.error });
        return;
      }
      const { applied, failed } = result.data;
      setOutcome({
        ok: failed.length === 0,
        text:
          applied === 0 && failed.length === 0
            ? tr("No bookings waiting in Channex.")
            : failed.length === 0
              ? tr.plural(applied, "{n} booking taken from Channex.", "{n} bookings taken from Channex.")
              : tr("{applied} taken, {failed} could not be saved.", { applied, failed: failed.length }),
        lines: failed.map((f) => `${f.label}: ${tr.message(f.detail)}`),
      });
      router.refresh();
    });
  }

  const status =
    connection?.lastTestedAt == null
      ? null
      : connection.lastTestOk
        ? { ok: true, text: tr("Connected · {when}", { when: tr.stamp(connection.lastTestedAt, timezone) }) }
        : { ok: false, text: `${tr.message(connection.lastTestMessage ?? "")} · ${tr.stamp(connection.lastTestedAt, timezone)}` };

  const allTicked = rooms.length > 0 && rooms.every((r) => ticked.has(r.roomTypeId));

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
              name="channex-api-key"
              type="password"
              // "off" is ignored on a password field: the browser filled in the
              // signed-in user's own password, and that was saved as the key.
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              spellCheck={false}
              value={apiKey}
              placeholder={hasKey ? tr("Saved") : ""}
              className={field}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Row>
          <Row label={tr("Channex Property:")} htmlFor="cx-property">
            {/* A list, never a text box: Channex wants its property id, and a
                typed name was refused. Test connection fills it. */}
            <select id="cx-property" value={propertyId} className={field} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">{tr("Create a new one")}</option>
              {propertyId && !(found ?? []).some((p) => p.id === propertyId) && (
                <option value={propertyId}>{propertyId}</option>
              )}
              {(found ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {p.currency ? ` (${p.currency})` : ""}
                </option>
              ))}
            </select>
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
              <h4 className="text-[14px] font-semibold text-ink">{tr("Room types")}</h4>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primary} disabled={busy} onClick={send}>
                  {working ? tr("Working…") : tr("Send to Channex")}
                </button>
                {inChannex && (
                  <>
                    <button type="button" className={secondary} disabled={busy} onClick={() => push(false)}>
                      {tr("Push rates and availability")}
                    </button>
                    <button type="button" className={secondary} disabled={busy} onClick={() => push(true)}>
                      {tr("Push everything")}
                    </button>
                    <button type="button" className={secondary} disabled={busy} onClick={pull}>
                      {tr("Pull bookings now")}
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
              <table className="w-full min-w-[44rem] text-[13px]">
                <thead>
                  <tr className="bg-shell text-left text-xxs uppercase tracking-wide text-ink-faint">
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brass"
                        aria-label={tr("Tick all")}
                        checked={allTicked}
                        onChange={() => tickAll(!allTicked)}
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">{tr("Room Type")}</th>
                    <th className="px-3 py-2 font-medium">{tr("Room Name")}</th>
                    <th className="px-3 py-2 text-right font-medium">{tr("Availability")}</th>
                    <th className="px-3 py-2 text-right font-medium">{tr("Rate")}</th>
                    <th className="px-3 py-2 font-medium">Channex</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rooms.map((r) => (
                    <Fragment key={r.roomTypeId}>
                      <tr className={cn(ticked.has(r.roomTypeId) && "bg-shell")}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brass"
                            aria-label={r.roomName}
                            checked={ticked.has(r.roomTypeId)}
                            onChange={() => toggle(r)}
                          />
                        </td>
                        <td className="px-3 py-2 text-ink">
                          {r.roomType} <span className="text-[10.5px] text-ink-faint">({r.code})</span>
                        </td>
                        <td className="px-3 py-2 font-medium text-ink">{r.roomName}</td>
                        <td className="tnum px-3 py-2 text-right text-ink">
                          {r.available === null ? "—" : tr("{available} of {rooms}", { available: r.available, rooms: r.rooms })}
                        </td>
                        <td className="tnum px-3 py-2 text-right text-ink">
                          {r.rateCents === null || !r.rateCurrency ? "—" : formatMoney(r.rateCents, r.rateCurrency)}
                        </td>
                        <td className="px-3 py-2">
                          {r.channexId ? (
                            <span className="text-emerald-700" title={r.channexId}>
                              {tr("Sent · {sent} of {priced} rate plans", { sent: r.plansSent, priced: r.plansPriced })}
                            </span>
                          ) : (
                            <span className="text-ink-faint">{tr("Not in Channex")}</span>
                          )}
                        </td>
                      </tr>
                      {r.plans.map((plan) => {
                        const key = planKey(r.roomTypeId, plan.ratePlanId);
                        const id = `cx-plan-${key}`;
                        const on = planTicked(r, plan);
                        // Shaded while the tick says something Channex does not hold yet.
                        const changed = on !== (plan.state === "open");
                        return (
                          <tr key={key} className={cn("text-[12.5px]", changed && "bg-shell")}>
                            <td />
                            <td colSpan={2} className="px-3 py-1.5">
                              <div className="flex items-center gap-2 pl-5">
                                <input
                                  id={id}
                                  type="checkbox"
                                  className="h-4 w-4 accent-brass"
                                  checked={on}
                                  onChange={() => togglePlan(r, plan)}
                                />
                                <label htmlFor={id} className="text-ink-muted">
                                  {plan.name}
                                </label>
                              </div>
                              {plan.occupancies.length > 0 && (
                                <div className="tnum mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 pl-11 text-[11.5px]">
                                  {plan.occupancies.map((o) => (
                                    <span
                                      key={o.adults}
                                      title={tr.plural(o.adults, "{n} adult", "{n} adults")}
                                      className={o.isPrimary ? "font-semibold text-ink" : "text-ink-faint"}
                                    >
                                      {o.adults} · {o.rateCents === null ? "—" : formatMoney(o.rateCents, plan.rateCurrency)}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td />
                            <td className="tnum px-3 py-1.5 text-right text-ink-muted">
                              {plan.rateCents === null ? "—" : formatMoney(plan.rateCents, plan.rateCurrency)}
                            </td>
                            <td className="px-3 py-1.5">
                              {plan.state === "open" && !plan.current ? (
                                <span className="text-warn-deep" title={plan.channexId ?? undefined}>
                                  {tr("In Channex · occupancies out of date")}
                                </span>
                              ) : plan.state === "open" ? (
                                <span className="text-emerald-700" title={plan.channexId ?? undefined}>
                                  {tr("In Channex")}
                                </span>
                              ) : plan.state === "closed" ? (
                                <span className="text-warn-deep" title={plan.channexId ?? undefined}>
                                  {tr("Closed in Channex")}
                                </span>
                              ) : (
                                <span className="text-ink-faint">{tr("Not in Channex")}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {bookings.length > 0 && <BookingRows bookings={bookings} timezone={timezone} />}

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
                      {entry.taskIds.length > 0 && (
                        <span className="tnum w-full select-all break-all pl-[8.75rem] text-[11px] text-ink-faint">
                          {entry.taskIds.join(", ")}
                        </span>
                      )}
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

function BookingRows({ bookings, timezone }: { bookings: ChannexBookingRevision[]; timezone: string }) {
  const tr = useT();
  const statusLabel = (s: ChannexBookingRevision["status"]) =>
    s === "new" ? tr("New") : s === "modified" ? tr("Modified") : s === "cancelled" ? tr("Cancelled") : "—";
  return (
    <div className="mt-6">
      <h4 className="border-b border-line pb-2 text-[14px] font-semibold text-ink">{tr("Bookings from Channex")}</h4>
      <ul className="mt-2 divide-y divide-line text-[13px]">
        {bookings.map((b) => (
          <li key={b.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
            <span className="tnum w-28 shrink-0 text-ink-muted">{tr.stamp(b.receivedAt, timezone)}</span>
            <span className="w-40 shrink-0 truncate text-ink">
              {b.otaName ?? "Channex"}
              {b.otaReservationCode ? ` · ${b.otaReservationCode}` : ""}
            </span>
            <span className="w-20 shrink-0 text-ink-muted">{statusLabel(b.status)}</span>
            {b.bookingId && b.bookingReference ? (
              <Link href={`/bookings/${b.bookingId}`} className="tnum w-24 shrink-0 text-brass hover:underline">
                {b.bookingReference}
              </Link>
            ) : (
              <span className="w-24 shrink-0 text-ink-faint">—</span>
            )}
            <span
              className={cn(
                "shrink-0",
                b.outcome === "applied" ? "text-emerald-700" : b.outcome === "attention" ? "text-warn-deep" : "text-rose-700",
              )}
            >
              {b.outcome === "applied" ? tr("Saved") : b.outcome === "attention" ? tr("Needs attention") : tr("Not saved")}
            </span>
            {b.message && <span className="min-w-0 truncate text-ink-faint">{tr.message(b.message)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
