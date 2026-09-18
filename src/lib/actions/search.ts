"use server";

import { createClient } from "@/lib/supabase/server";

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
  title: string;
  subtitle: string | null;
  meta: string | null;
}

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

  return (data ?? []) as SearchHit[];
}
