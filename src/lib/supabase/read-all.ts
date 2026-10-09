/*
 * EVERY ROW, NOT THE FIRST THOUSAND. The API answers at most 1,000 rows a
 * request (Supabase's "Max rows"), and says nothing when it stops there. Adjana
 * Resort -- 46 villas, each its own room type -- went past it on day one: 1,295
 * saved weekly prices, 28 nights x 46 types on the Rates grid, 35 x 46 on the
 * calendar, 366 x 46 on the public API. The rows past 1,000 simply did not
 * arrive, so Villa 14's week read as blank, a price typed into it saved and
 * then came back blank ("cannot be saved"), and the grids lost their last room
 * types or their last nights.
 *
 * `readAll()` asks for 1,000 rows at a time until a page comes back short. The
 * request MUST be in a total order or a page boundary can skip or repeat a
 * row: an RPC keeps its own ORDER BY (the screens build their room-type order
 * from it), with a unique tiebreaker added by the caller wherever the output
 * carries every sort key. If the project's Max rows is ever set BELOW 1,000,
 * the first short page ends the read and this is the old bug again.
 */
const PAGE_ROWS = 1000;

export async function readAll<T, E>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: E | null }>,
): Promise<{ data: T[]; error: E | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) return { data: all, error };
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_ROWS) return { data: all, error: null };
  }
}
