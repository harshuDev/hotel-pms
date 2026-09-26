"use client";

/** Prints the page it sits on. Hidden from the printout itself. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 print:hidden"
    >
      {label}
    </button>
  );
}
