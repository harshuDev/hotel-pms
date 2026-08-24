"use client";

import { useState } from "react";
import { Card, cn } from "@/components/ui";
import type { Room, RoomState } from "@/lib/types";

const STATES: {
  key: RoomState;
  label: string;
  tile: string;
  swatch: string;
}[] = [
  {
    key: "occupied",
    label: "Occupied",
    tile: "bg-chrome-700 text-white border-chrome-700",
    swatch: "bg-chrome-700",
  },
  {
    key: "due_out",
    label: "Due out",
    tile: "bg-brass text-white border-brass",
    swatch: "bg-brass",
  },
  {
    key: "arriving",
    label: "Arriving",
    tile: "bg-white text-ink border-brass border-dashed",
    swatch: "border-2 border-dashed border-brass bg-white",
  },
  {
    key: "vacant_clean",
    label: "Ready",
    tile: "bg-white text-ink-muted border-line",
    swatch: "bg-white border border-line",
  },
  {
    key: "vacant_dirty",
    label: "Needs service",
    tile: "bg-shell text-ink-muted border-line-strong",
    swatch: "bg-shell border border-line-strong",
  },
  {
    key: "ooo",
    label: "Out of order",
    tile: "hatch bg-white text-ink-faint border-line line-through",
    swatch: "hatch bg-white border border-line",
  },
];

const STYLE = Object.fromEntries(STATES.map((s) => [s.key, s.tile])) as Record<
  RoomState,
  string
>;

export function RoomRack({ rooms }: { rooms: Room[] }) {
  const [filter, setFilter] = useState<RoomState | null>(null);
  const [hovered, setHovered] = useState<Room | null>(null);

  const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => b - a);
  const counts = STATES.map((s) => ({
    ...s,
    n: rooms.filter((r) => r.state === s.key).length,
  }));

  return (
    <Card
      eyebrow="Right now"
      title="The house"
      className="min-h-[300px]"
      bodyClassName="px-5 pb-4"
      action={
        <p className="max-w-[22ch] text-right text-xs leading-snug text-ink-faint">
          {hovered
            ? `${hovered.guestName ?? "No guest"} · ${hovered.typeName}`
            : "Hover a room for detail"}
        </p>
      }
    >
      <div className="space-y-2.5">
        {floors.map((floor) => (
          <div key={floor} className="flex items-center gap-3">
            <span className="w-9 shrink-0 font-display text-xxs font-semibold uppercase tracking-[0.12em] text-ink-faint">
              F{floor}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {rooms
                .filter((r) => r.floor === floor)
                .map((r, i) => {
                  const dimmed = filter !== null && r.state !== filter;
                  return (
                    <button
                      key={r.id}
                      onMouseEnter={() => setHovered(r)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(r)}
                      onBlur={() => setHovered(null)}
                      style={{ animationDelay: `${i * 12}ms` }}
                      className={cn(
                        "tnum h-9 w-11 animate-rise rounded border text-[12.5px] font-medium transition-all",
                        STYLE[r.state],
                        dimmed && "opacity-20",
                        !dimmed && "hover:-translate-y-0.5 hover:shadow-lift",
                      )}
                      title={`${r.number} · ${r.typeName}${r.guestName ? ` · ${r.guestName}` : ""}`}
                    >
                      {r.number}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-3">
        {counts.map((s) => (
          <button
            key={s.key}
            onClick={() => setFilter(filter === s.key ? null : s.key)}
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
    </Card>
  );
}
