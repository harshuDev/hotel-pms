"use client";

import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Card, FeedDot, cn } from "@/components/ui";
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
  const [read, setRead] = useState(false);

  return (
    <Card
      eyebrow="Activity"
      title="What just happened"
      className="h-[588px]"
      bodyClassName="overflow-y-auto"
      action={
        <button
          onClick={() => setRead(true)}
          disabled={read}
          className="text-xs text-brass hover:underline disabled:text-ink-faint disabled:no-underline"
        >
          {read ? "All read" : "Mark all read"}
        </button>
      }
    >
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
