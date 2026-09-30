"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/components/i18n";
import { cn } from "@/components/ui";

export type FilterOption = {
  id: string;
  name: string;
  /** A swatch before the name: a season's or an event's own colour. */
  color?: string;
  /** A faint word after the name, such as "Event". */
  tag?: string;
};

/*
 * The reference's filter dropdown (Room Rate Combinations): a field that
 * opens a list of EVERY option, the chosen ones ticked. With `multi` the
 * field holds a chip per choice, each with its own ×, and a click in the
 * list toggles without closing; without it the field holds the one choice
 * and a click picks and closes.
 *
 * The chips are outside the toggle button, because a button inside a button
 * is invalid HTML and browsers rearrange it -- the calendar's assign control
 * hit that. Clicking the field's empty space opens it too.
 *
 * Escape is stopped here: this is drawn inside a BookingDialog panel, which
 * closes the whole panel on Escape at document level.
 */
export function FilterSelect({
  label,
  options,
  value,
  onChange,
  multi = false,
  maxChips = 3,
}: {
  label: string;
  options: FilterOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  multi?: boolean;
  /** Chips drawn before the rest collapse into "+n". */
  maxChips?: number;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const chosen = options.filter((o) => value.includes(o.id));

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openList() {
    const first = options.findIndex((o) => value.includes(o.id));
    setActive(first < 0 ? 0 : first);
    setOpen(true);
  }

  function pick(id: string) {
    if (multi) {
      onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
    } else {
      onChange([id]);
      setOpen(false);
      toggleRef.current?.focus();
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      if (open) {
        event.stopPropagation();
        setOpen(false);
        toggleRef.current?.focus();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return openList();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + options.length) % options.length);
      return;
    }
    if (open && (event.key === "Enter" || event.key === " ") && options[active]) {
      event.preventDefault();
      pick(options[active].id);
      return;
    }
    if (event.key === "Tab") setOpen(false);
  }

  const shownChips = chosen.slice(0, maxChips);
  const more = chosen.length - shownChips.length;

  return (
    <div ref={wrapRef} className="relative mt-1" onKeyDown={onKeyDown}>
      <div
        className={cn(
          "flex min-h-[38px] cursor-pointer items-center gap-1 rounded border bg-white py-1 pl-1.5 pr-1",
          open ? "border-brass ring-1 ring-brass" : "border-line hover:border-ink-faint",
        )}
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          if (open) setOpen(false);
          else openList();
          toggleRef.current?.focus();
        }}
      >
        {multi ? (
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {shownChips.map((o) => (
              <span key={o.id} className="flex min-w-0 max-w-[11rem] items-center gap-1 rounded bg-shell px-2 py-0.5 text-[13px] text-ink">
                <span className="truncate">{o.name}</span>
                <button
                  type="button"
                  aria-label={tr("Remove {name}", { name: o.name })}
                  className="shrink-0 text-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  onClick={() => onChange(value.filter((v) => v !== o.id))}
                >
                  ×
                </button>
              </span>
            ))}
            {more > 0 && (
              <span className="shrink-0 whitespace-nowrap rounded bg-shell px-2 py-0.5 text-[13px] text-ink-muted">+{more} …</span>
            )}
          </span>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 px-1.5 text-[14px] text-ink" onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else openList(); toggleRef.current?.focus(); }}>
            {chosen[0]?.color && <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: chosen[0].color }} />}
            <span className="truncate">{chosen[0]?.name ?? ""}</span>
          </span>
        )}
        <button
          ref={toggleRef}
          type="button"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => (open ? setOpen(false) : openList())}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-shell focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          <svg viewBox="0 0 16 16" aria-hidden className={cn("h-3.5 w-3.5 fill-current transition-transform", open && "rotate-180")}>
            <path d="M3.2 5.6 8 10.4l4.8-4.8-1-1L8 8.4 4.2 4.6z" />
          </svg>
        </button>
      </div>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multi || undefined}
          className="absolute left-0 top-full z-40 mt-1 max-h-72 w-max min-w-full max-w-[min(28rem,90vw)] overflow-y-auto rounded border border-line bg-white py-1 shadow-lift"
        >
          {options.map((o, i) => {
            const selected = value.includes(o.id);
            return (
              <li
                key={o.id}
                role="option"
                aria-selected={selected}
                data-index={i}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-3 py-2 text-[13.5px]",
                  selected ? "bg-brass/10 font-semibold text-ink" : "text-ink",
                  i === active && (selected ? "bg-brass/20" : "bg-shell"),
                )}
              >
                {o.color && <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: o.color }} />}
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.tag && <span className="shrink-0 text-[11px] font-normal text-ink-faint">{o.tag}</span>}
                <svg viewBox="0 0 16 16" aria-hidden className={cn("h-3.5 w-3.5 shrink-0 fill-brass", !selected && "invisible")}>
                  <path d="M6.4 11.2 3.2 8l-1 1 4.2 4.2 7.4-7.4-1-1z" />
                </svg>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
