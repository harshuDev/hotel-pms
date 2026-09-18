"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { globalSearch, type SearchHit } from "@/lib/actions/search";

/**
 * The search the magnifier in the top bar opens.
 *
 * That button shipped with the nav and was `disabled` the whole time: its
 * `onSearchClick` prop came from a Server Component, which cannot hand a
 * function to a client component, so nothing was ever passed and the button
 * could not be clicked. It was the last control in the application that did
 * nothing.
 *
 * Bookings, customers and rooms — a reference, a name, or a room number, which
 * is what somebody at a front desk has in their hand. Everything else is a
 * report.
 */

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  booking: "Bookings",
  customer: "Customers",
  room: "Rooms",
};

/** Where a hit goes. Rooms have no page of their own; the list is filtered. */
function hrefFor(hit: SearchHit) {
  switch (hit.kind) {
    case "booking":
      return `/bookings/${hit.id}`;
    case "customer":
      return `/customers?q=${encodeURIComponent(hit.title)}`;
    case "room":
      return `/reports/housekeeping?q=${encodeURIComponent(
        hit.title.replace(/^Room\s+/i, ""),
      )}`;
  }
}

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /*
   * Debounced, and every reply checks it is still the newest.
   *
   * Without the sequence check a slow early request can land after a fast late
   * one and put stale results under a newer term — the classic way a search box
   * shows you what you typed three letters ago.
   */
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }

    let live = true;
    setBusy(true);
    const timer = setTimeout(async () => {
      const results = await globalSearch(q);
      if (!live) return;
      setHits(results);
      setActive(0);
      setBusy(false);
    }, 180);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  function go(hit: SearchHit) {
    onClose();
    router.push(hrefFor(hit));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (hits.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[active];
      if (hit) go(hit);
    }
  }

  // Group for the headings, keeping the order Postgres returned: bookings
  // first, because a reference is the commonest reason to open this.
  const groups: { kind: SearchHit["kind"]; hits: SearchHit[] }[] = [];
  for (const hit of hits) {
    const last = groups[groups.length - 1];
    if (last && last.kind === hit.kind) last.hits.push(hit);
    else groups.push({ kind: hit.kind, hits: [hit] });
  }

  let index = -1;
  const showEmpty = term.trim().length >= 2 && !busy && hits.length === 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-chrome-900/50 p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-line bg-white shadow-lift"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <svg
            viewBox="0 0 20 20"
            aria-hidden
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            className="h-[17px] w-[17px] shrink-0 text-ink-faint"
          >
            <circle cx="9" cy="9" r="5.5" />
            <path d="m13.2 13.2 3.4 3.4" />
          </svg>
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Booking reference, guest name or room number"
            aria-label="Search bookings, guests and rooms"
            className="w-full bg-transparent py-3.5 text-[14px] text-ink outline-none placeholder:text-ink-faint"
          />
          {busy && <span className="shrink-0 text-xxs text-ink-faint">Searching…</span>}
        </div>

        {groups.length > 0 && (
          <ul className="max-h-[52vh] overflow-y-auto py-1">
            {groups.map((group) => (
              <li key={group.kind}>
                <p className="px-4 pb-1 pt-2 text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                  {KIND_LABEL[group.kind]}
                </p>
                <ul>
                  {group.hits.map((hit) => {
                    index += 1;
                    const isActive = index === active;
                    const at = index;
                    return (
                      <li key={`${hit.kind}-${hit.id}`}>
                        <button
                          type="button"
                          onMouseEnter={() => setActive(at)}
                          onClick={() => go(hit)}
                          className={cn(
                            "flex w-full items-baseline gap-2 px-4 py-2 text-left",
                            isActive ? "bg-brass/10" : "hover:bg-shell",
                          )}
                        >
                          <span className="truncate text-[13px] font-medium text-ink">
                            {hit.title}
                          </span>
                          {hit.subtitle && (
                            <span className="truncate text-[13px] text-ink-muted">
                              {hit.subtitle}
                            </span>
                          )}
                          {hit.meta && (
                            <span className="tnum ml-auto shrink-0 text-xxs text-ink-faint">
                              {hit.meta}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}

        {showEmpty && (
          <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
            Nothing matches “{term.trim()}”. Search covers booking references,
            guest names and room numbers.
          </p>
        )}

        {term.trim().length < 2 && (
          <p className="px-4 py-6 text-center text-[13px] text-ink-faint">
            Type at least two characters.
          </p>
        )}

        <div className="flex items-center gap-3 border-t border-line bg-shell/60 px-4 py-2 text-xxs text-ink-faint">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
