"use server";

import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

/**
 * The lookup behind the magnifier in the top bar.
 *
 * A Server Action rather than a query in `queries.ts`, because this one is
 * called from the browser as somebody types rather than while a page renders.
 * The read still happens on the server with the caller's session, so RLS
 * decides what comes back exactly as it does for every Server Component read.
 */

export type SearchKind = "booking" | "customer" | "room";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  /** What the row is called, in the staff language: "Room 101", a name, a reference. */
  title: string;
  subtitle: string | null;
  meta: string | null;
  /** What the overlay searches the target screen for: the reference, name or room number as stored. */
  term: string;
}

/*
 * Postgres returns the parts and this writes the line (0107), because the
 * staff application is not only in English and SQL cannot know the reader's
 * language. The words are the ones the status badge and the calendar use.
 */
const BOOKING_STATUS: Record<string, string> = {
  pending: msg("Pending"),
  confirmed: msg("Confirmed"),
  checked_in: msg("Checked In"),
  checked_out: msg("Checked Out"),
  canceled: msg("Canceled"),
  no_show: msg("No Show"),
};
const ROOM_STATUS: Record<string, string> = {
  vacant_clean: msg("Ready for a guest"),
  vacant_dirty: msg("Waiting to be cleaned"),
  occupied: msg("Occupied"),
  ooo: msg("Out of order"),
};

export async function globalSearch(term: string): Promise<SearchHit[]> {
  const q = term.trim();
  // Two characters is where the results stop being everything. One letter
  // matches most of the guest list and tells nobody anything.
  if (q.length < 2) return [];

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("global_search", {
    p_q: q,
    p_limit: 6,
  });

  // Search failing should not throw a dialog at somebody mid-keystroke. An
  // empty result reads as "nothing found", which is the same shape as the
  // honest answer and is what the overlay already handles.
  if (error) return [];

  const tr = await getT();
  const word = (map: Record<string, string>, v: string | null) => (v && map[v] ? tr(map[v]) : v ?? "");

  return (data ?? []).map((r): SearchHit => {
    const kind = r.kind as SearchKind;
    if (kind === "booking") {
      const dates =
        r.check_in && r.check_out
          ? `${tr.date(r.check_in, "dd MMM")} – ${tr.date(r.check_out, "dd MMM")}`
          : "";
      return {
        kind,
        id: r.id,
        title: r.title,
        subtitle: r.subtitle,
        meta: [dates, word(BOOKING_STATUS, r.status)].filter(Boolean).join(" · "),
        term: r.title,
      };
    }
    if (kind === "customer") {
      return {
        kind,
        id: r.id,
        title: r.title,
        subtitle: r.subtitle ?? tr("No contact details"),
        meta: tr.plural(Number(r.booking_count ?? 0), "{n} booking", "{n} bookings"),
        term: r.title,
      };
    }
    return {
      kind,
      id: r.id,
      title: tr("Room {number}", { number: r.title }),
      subtitle: r.subtitle,
      meta: [word(ROOM_STATUS, r.status), r.floor ? tr("floor {floor}", { floor: r.floor }) : ""]
        .filter(Boolean)
        .join(" · "),
      term: r.title,
    };
  });
}
