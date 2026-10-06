"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n";
import { switchProperty } from "@/lib/actions/platform";

/**
 * The platform team's hotel switcher (0135), in place of the hotel's name in
 * the top bar. Drawn only for the team: a hotel's own staff see the name.
 *
 * A native select on purpose. The top bar is a sticky z-30 stacking context,
 * so a drawn dropdown inside it would sit under anything on the page at z-40
 * -- the calendar's paging chevrons, for one. The browser's own list is drawn
 * above the page and needs no portal.
 */
export function PropertySwitcher({
  properties,
  currentId,
}: {
  properties: { id: string; name: string }[];
  currentId: string;
}) {
  const tr = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex min-w-0 items-center gap-2">
      <select
        value={currentId}
        disabled={pending}
        aria-label={tr("Hotel")}
        onChange={(e) => {
          const id = e.target.value;
          setError(null);
          startTransition(async () => {
            const result = await switchProperty(id);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            // Every figure on the screen belonged to the other hotel.
            router.push("/dashboard");
            router.refresh();
          });
        }}
        className="max-w-[60vw] truncate rounded border border-transparent bg-transparent py-0.5 pl-1 pr-6 font-display text-[13.5px] font-medium tracking-tightest text-ink hover:border-line focus:border-brass focus:outline-none disabled:opacity-60 sm:max-w-[22rem]"
      >
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {pending && <span className="text-xxs text-ink-faint">{tr("Switching…")}</span>}
      {error && <span role="alert" className="truncate text-xxs text-rose-600">{error}</span>}
    </span>
  );
}
