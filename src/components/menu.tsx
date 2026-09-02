"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/components/ui";
import { isHrefActive } from "@/lib/nav";

const HOVER_OPEN_MS = 90;
const HOVER_CLOSE_MS = 180;

const ITEM_SELECTOR = "[data-menu-item]:not([aria-disabled='true'])";

export function Chevron({ open = false }: { open?: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "h-2.5 w-2.5 shrink-0 opacity-55 transition-transform duration-150",
        open && "rotate-180",
      )}
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}

interface MenuProps {
  /** Accessible name, and the default visible trigger text. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active?: boolean;
  columns?: 1 | 2;
  align?: "start" | "end";
  triggerClassName?: string;
  /** Replaces the default label-plus-chevron trigger content. */
  triggerContent?: ReactNode;
  children: ReactNode;
}

export function Menu({
  label,
  open,
  onOpenChange,
  active = false,
  columns = 1,
  align = "start",
  triggerClassName,
  triggerContent,
  children,
}: MenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const openLater = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => onOpenChange(true), HOVER_OPEN_MS);
  }, [cancel, onOpenChange]);

  const closeLater = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => onOpenChange(false), HOVER_CLOSE_MS);
  }, [cancel, onOpenChange]);

  useEffect(() => cancel, [cancel]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const items = useCallback(
    () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [],
      ),
    [],
  );

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    cancel();
    onOpenChange(true);
    requestAnimationFrame(() => items()[0]?.focus());
  };

  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLElement);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1].focus();
    } else if (e.key === "Tab") {
      onOpenChange(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") openLater();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") closeLater();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onKeyDown={onTriggerKeyDown}
        onClick={() => {
          cancel();
          onOpenChange(!open);
        }}
        className={cn(
          "relative flex items-center gap-1.5 outline-none",
          "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40",
          triggerClassName,
        )}
      >
        {triggerContent ?? (
          <>
            <span>{label}</span>
            <Chevron open={open} />
          </>
        )}
        {active && (
          <span className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-brass" />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          onKeyDown={onPanelKeyDown}
          className={cn(
            "absolute top-full z-50 animate-rise rounded-md border border-line bg-white p-1.5 shadow-lift",
            align === "end" ? "right-0" : "left-0",
            columns === 2
              ? "grid w-[392px] grid-cols-2 gap-x-1"
              : "block min-w-[196px]",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  children: ReactNode;
}

export function MenuItem({
  href,
  onSelect,
  disabled = false,
  children,
}: MenuItemProps) {
  const pathname = usePathname();
  const isActive = href ? isHrefActive(href, pathname) : false;

  const className = cn(
    "block rounded px-2.5 py-[7px] text-left text-[12.5px] outline-none transition-colors",
    "focus-visible:bg-brass-wash focus-visible:text-brass",
    disabled
      ? "cursor-not-allowed text-ink-faint"
      : isActive
        ? "bg-brass-wash font-medium text-brass"
        : "text-ink-muted hover:bg-shell hover:text-ink",
  );

  if (disabled) {
    return (
      <span
        data-menu-item
        role="menuitem"
        aria-disabled="true"
        className={className}
      >
        {children}
      </span>
    );
  }

  if (href) {
    return (
      <Link
        data-menu-item
        role="menuitem"
        href={href}
        onClick={onSelect}
        className={className}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      data-menu-item
      role="menuitem"
      type="button"
      onClick={onSelect}
      className={cn(className, "w-full")}
    >
      {children}
    </button>
  );
}
