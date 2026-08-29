"use client";

import { useMemo, useState } from "react";
import { Card, cn } from "@/components/ui";
import type { Room, RoomState } from "@/lib/types";

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

export function HouseBoard({ rooms }: { rooms: Room[] }) {
  const [filter, setFilter] = useState<RoomState | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const total = rooms.length || 1;

  const counts = useMemo(
    () =>
      STATES.map((s) => ({
        ...s,
        n: rooms.filter((r) => r.state === s.key).length,
      })),
    [rooms],
  );

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rooms
      .filter(
        (r) =>
          (!filter || r.state === filter) &&
          (!needle ||
            String(r.number).toLowerCase().includes(needle) ||
            (r.guestName ?? "").toLowerCase().includes(needle) ||
            r.typeName.toLowerCase().includes(needle)),
      )
      .sort((a, b) =>
        String(a.number).localeCompare(String(b.number), undefined, {
          numeric: true,
        }),
      );
  }, [rooms, filter, q]);

  const pick = (key: RoomState) => {
    setFilter((f) => (f === key ? null : key));
    setLimit(PAGE);
    setOpen(true);
  };

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
          {open ? "Hide rooms" : `View rooms (${rooms.length})`}
        </button>
      }
    >
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
        {counts
          .filter((s) => s.n > 0)
          .map((s) => (
            <button
              key={s.key}
              onClick={() => pick(s.key)}
              title={`${s.label} · ${s.n}`}
              style={{ width: `${(s.n / total) * 100}%` }}
              className={cn(
                "h-full transition-opacity",
                s.bar,
                filter !== null && filter !== s.key && "opacity-25",
              )}
            />
          ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {counts.map((s) => (
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
              onChange={(e) => {
                setQ(e.target.value);
                setLimit(PAGE);
              }}
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
              {matches.length} of {rooms.length}
            </p>
          </div>

          {matches.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">
              No rooms match. Clear the search box or pick a different state.
            </p>
          ) : (
            <>
              <div className="flex max-h-[320px] flex-wrap gap-1.5 overflow-y-auto">
                {matches.slice(0, limit).map((r) => (
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
              {matches.length > limit && (
                <button
                  onClick={() => setLimit((l) => l + PAGE)}
                  className="mt-3 w-full rounded-md border border-line py-2 text-xs text-ink-muted hover:bg-shell"
                >
                  Show {Math.min(PAGE, matches.length - limit)} more
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
