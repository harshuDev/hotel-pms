"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, cn } from "@/components/ui";
import { loadRooms } from "@/lib/actions/rooms";
import type { HouseStateCounts, Room, RoomState } from "@/lib/types";

const STATES: {
  key: RoomState;
  label: string;
  bar: string;
  swatch: string;
  pill: string;
}[] = [
  {
    key: "occupied",
    label: "Occupied",
    bar: "bg-chrome-700",
    swatch: "bg-chrome-700",
    pill: "bg-chrome-700 text-white border-chrome-700",
  },
  {
    key: "due_out",
    label: "Due out",
    bar: "bg-warn",
    swatch: "bg-warn",
    pill: "bg-warn text-white border-warn",
  },
  {
    key: "arriving",
    label: "Arriving",
    bar: "bg-brass",
    swatch: "border-2 border-dashed border-brass bg-white",
    pill: "bg-white text-ink border-brass border-dashed",
  },
  {
    key: "vacant_clean",
    label: "Ready",
    bar: "bg-emerald-500",
    swatch: "bg-emerald-500",
    pill: "bg-white text-ink-muted border-line",
  },
  {
    key: "vacant_dirty",
    label: "Needs service",
    bar: "bg-line-strong",
    swatch: "bg-shell border border-line-strong",
    pill: "bg-shell text-ink-muted border-line-strong",
  },
  {
    key: "ooo",
    label: "Out of order",
    bar: "bg-ink-faint",
    swatch: "hatch bg-white border border-line",
    pill: "hatch bg-white text-ink-faint border-line line-through",
  },
];

const PILL: Record<RoomState, string> = STATES.reduce(
  (acc, s) => ({ ...acc, [s.key]: s.pill }),
  {} as Record<RoomState, string>,
);

const PAGE = 240;

/**
 * The bar and legend render from counts alone, so a collapsed board costs no
 * room rows at any property size. The room list is fetched a page at a time,
 * filtered and searched in Postgres, only while it is expanded.
 */
export function HouseBoard({
  counts,
  total,
}: {
  counts: HouseStateCounts;
  total: number;
}) {
  const [filter, setFilter] = useState<RoomState | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");

  const [rooms, setRooms] = useState<Room[]>([]);
  const [matches, setMatches] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const segments = STATES.map((s) => ({ ...s, n: counts[s.key] ?? 0 }));
  const denominator = total || 1;

  useEffect(() => {
    const timer = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  // Only the newest request may write to state; typing races otherwise.
  const request = useRef(0);

  const fetchPage = useCallback(
    async (target: number, append: boolean) => {
      const id = ++request.current;
      setLoading(true);
      setError(null);

      try {
        const result = await loadRooms({
          q: needle,
          state: filter,
          page: target,
          perPage: PAGE,
        });

        if (id !== request.current) return;

        setRooms((prev) => (append ? [...prev, ...result.rows] : result.rows));
        setMatches(result.total);
        setPage(result.page);
      } catch {
        if (id !== request.current) return;
        setError(
          "The room list did not load. Check your connection, then try again.",
        );
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [needle, filter],
  );

  useEffect(() => {
    if (!open) return;
    void fetchPage(1, false);
  }, [open, fetchPage]);

  const pick = (key: RoomState) => {
    setFilter((f) => (f === key ? null : key));
    setOpen(true);
  };

  const remaining = matches - rooms.length;

  return (
    <Card
      eyebrow="Right now"
      title="The house"
      bodyClassName="px-5 pb-4"
      action={
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-shell hover:text-ink"
        >
          {open ? "Hide rooms" : `View rooms (${total})`}
        </button>
      }
    >
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
        {segments
          .filter((s) => s.n > 0)
          .map((s) => (
            <button
              key={s.key}
              onClick={() => pick(s.key)}
              title={`${s.label} · ${s.n}`}
              style={{ width: `${(s.n / denominator) * 100}%` }}
              className={cn(
                "h-full transition-opacity",
                s.bar,
                filter !== null && filter !== s.key && "opacity-25",
              )}
            />
          ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {segments.map((s) => (
          <button
            key={s.key}
            onClick={() => pick(s.key)}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-opacity",
              filter !== null && filter !== s.key && "opacity-40",
            )}
          >
            <span className={cn("h-2.5 w-2.5 rounded-sm", s.swatch)} />
            <span className="text-ink-muted">{s.label}</span>
            <span className="tnum font-semibold text-ink">{s.n}</span>
          </button>
        ))}
      </div>

      {open && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Room number, guest or room type"
              className="min-w-[220px] flex-1 rounded-md border border-line px-3 py-1.5 text-[13px] placeholder:text-ink-faint"
            />
            {filter && (
              <button
                onClick={() => setFilter(null)}
                className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-muted hover:bg-shell"
              >
                Clear filter
              </button>
            )}
            <p className="tnum text-xs text-ink-faint">
              {matches} of {total}
            </p>
          </div>

          {error ? (
            <div className="py-6 text-center">
              <p className="text-[13px] text-ink-muted">{error}</p>
              <button
                onClick={() => void fetchPage(1, false)}
                className="mt-2 rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-muted hover:bg-shell"
              >
                Try again
              </button>
            </div>
          ) : loading && rooms.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">
              Loading rooms…
            </p>
          ) : rooms.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">
              No rooms match. Clear the search box or pick a different state.
            </p>
          ) : (
            <>
              <div className="flex max-h-[320px] flex-wrap gap-1.5 overflow-y-auto">
                {rooms.map((r) => (
                  <span
                    key={r.id}
                    title={`${r.number} · ${r.typeName}${r.guestName ? ` · ${r.guestName}` : ""}`}
                    className={cn(
                      "tnum flex h-8 w-14 items-center justify-center rounded border text-[12.5px] font-medium",
                      PILL[r.state],
                    )}
                  >
                    {r.number}
                  </span>
                ))}
              </div>
              {remaining > 0 && (
                <button
                  onClick={() => void fetchPage(page + 1, true)}
                  disabled={loading}
                  className="mt-3 w-full rounded-md border border-line py-2 text-xs text-ink-muted hover:bg-shell disabled:opacity-60"
                >
                  {loading
                    ? "Loading…"
                    : `Show ${Math.min(PAGE, remaining)} more`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
