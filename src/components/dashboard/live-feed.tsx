"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { Card, FeedDot, cn } from "@/components/ui";
import { markActivitySeen } from "@/lib/actions/activity";
import type { ActivityItem } from "@/lib/types";

function Emphasised({ text, terms }: { text: string; terms: string[] }) {
  const unique = [...new Set(terms.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!unique.length) return <>{text}</>;
  const escaped = unique.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "g"));
  return (
    <>
      {parts.map((p, i) =>
        unique.includes(p) ? (
          <strong key={i} className="font-semibold text-ink">
            {p}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function LiveFeed({ items }: { items: ActivityItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Marked optimistically so the highlight goes at once; the server decides
  // what is unread on the next read.
  const [read, setRead] = useState(false);
  const [error, setError] = useState("");

  const anyUnread = items.some((item) => item.unread);

  const markRead = () => {
    setError("");
    startTransition(async () => {
      const result = await markActivitySeen();
      if (!result.ok) return setError(result.error);
      setRead(true);
      router.refresh();
    });
  };

  return (
    <Card
      eyebrow="Activity"
      title="What just happened"
      className="h-[588px]"
      bodyClassName="overflow-y-auto"
      action={
        <button
          onClick={markRead}
          disabled={pending || read || !anyUnread}
          className="text-xs text-brass hover:underline disabled:text-ink-faint disabled:no-underline"
        >
          {/*
            "Marking…", not "Clearing…". This drops the unread highlight and
            leaves every row where it is: the feed is the activity log, not an
            inbox, and a room being created is a record that should not vanish
            because somebody glanced at it. The old word promised the list
            would empty, it did not, and the button got reported as broken.
          */}
          {pending ? "Marking…" : read || !anyUnread ? "All read" : "Mark all read"}
        </button>
      }
    >
      {error && (
        <p className="mx-5 mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}
      <ul className="px-5">
        {items.map((item, i) => (
          <li key={item.id} className="relative flex gap-3 pb-4">
            {i < items.length - 1 && (
              <span className="absolute left-[3px] top-3 h-full w-px bg-line" />
            )}
            <FeedDot kind={item.kind} />
            <div
              className={cn(
                "min-w-0 flex-1 rounded-md px-2 py-1 transition-colors",
                item.unread && !read && "bg-brass-wash",
              )}
            >
              <p className="text-[12.5px] leading-snug text-ink-muted">
                <Emphasised text={item.summary} terms={item.emphasis} />
              </p>
              <p className="mt-0.5 text-xxs text-ink-faint">
                {formatDistanceToNowStrict(new Date(item.createdAt))} ago
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
