"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { setRoomStatus } from "@/lib/actions/settings";
import type { RoomStatus } from "@/lib/types";

/**
 * Marking a room clean, dirty or out of order.
 *
 * Until this existed, rooms.status was only ever set by check-in and
 * check-out, so a room went dirty on departure and stayed dirty for ever.
 * Housekeeping can use this — they are the people holding the vacuum.
 *
 * Occupied is not offered: a room is occupied because a guest is in it, and
 * saying otherwise here would put the room and the booking out of step.
 * Postgres refuses it too.
 */
const CHOICES: { value: RoomStatus; label: string; tone: string }[] = [
  { value: "vacant_clean", label: "Clean", tone: "hover:bg-emerald-50 hover:text-emerald-800" },
  { value: "vacant_dirty", label: "Dirty", tone: "hover:bg-rose-50 hover:text-rose-700" },
  { value: "ooo", label: "Out of order", tone: "hover:bg-slate-100 hover:text-slate-700" },
];

export function RoomStatusAction({
  roomId,
  status,
}: {
  roomId: string;
  status: RoomStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status === "occupied") {
    return (
      <span className="text-xxs text-ink-faint">
        Occupied — check the guest out
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {CHOICES.filter((c) => c.value !== status).map((c) => (
        <button
          key={c.value}
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await setRoomStatus({ roomId, status: c.value });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              router.refresh();
            });
          }}
          className={cn(
            "rounded border border-line px-2 py-1 text-xxs text-ink-muted transition-colors disabled:opacity-50",
            c.tone,
          )}
        >
          {c.label}
        </button>
      ))}
      {error && <span className="text-xxs text-rose-700">{error}</span>}
    </div>
  );
}
