"use client";

import { useT } from "@/components/i18n";

/** Prints the page it sits on. Hidden from the printout itself. */
export function PrintButton({ label }: { label?: string }) {
  const tr = useT();
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 print:hidden"
    >
      {label ?? tr("Print")}
    </button>
  );
}
