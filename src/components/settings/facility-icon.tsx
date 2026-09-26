import type { FacilityIcon as FacilityIconName } from "@/lib/facilities";

/*
 * The glyph for each facility icon (0070). Drawn here rather than fetched
 * from an icon font: the app carries no icon library, and ten strokes in one
 * file are cheaper than a dependency for them.
 */
const PATHS: Record<FacilityIconName, React.ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  bed: (
    <>
      <path d="M3 18V6" />
      <path d="M3 14h18v4" />
      <path d="M21 14v-2.5A2.5 2.5 0 0 0 18.5 9H11v5" />
      <circle cx="7" cy="11" r="1.6" />
    </>
  ),
  wifi: (
    <>
      <path d="M2.5 9a14 14 0 0 1 19 0" />
      <path d="M5.5 12.5a9.5 9.5 0 0 1 13 0" />
      <path d="M8.8 16a5 5 0 0 1 6.4 0" />
      <path d="M12 19.5h.01" />
    </>
  ),
  desktop: (
    <>
      <rect x="2.5" y="4" width="19" height="12.5" rx="1.5" />
      <path d="M8 21h8M12 16.5V21" />
    </>
  ),
  bath: (
    <>
      <path d="M3.5 12h17v2.5a4.5 4.5 0 0 1-4.5 4.5H8a4.5 4.5 0 0 1-4.5-4.5z" />
      <path d="M6 12V5.5a2 2 0 0 1 4 0" />
      <path d="M7 19l-1 2M17 19l1 2" />
    </>
  ),
  car: (
    <>
      <path d="M4.5 16v-4.5L7 6h10l2.5 5.5V16z" />
      <path d="M4.5 11.5h15" />
      <path d="M7 16v2.5M17 16v2.5" />
    </>
  ),
  snowflake: <path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2L3.8 16.8" />,
  coffee: (
    <>
      <path d="M4 8.5h12V14a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
      <path d="M16 10.5h1.5a2.25 2.25 0 0 1 0 4.5H16" />
      <path d="M8 3v2.5M12 3v2.5" />
    </>
  ),
  utensils: (
    <>
      <path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" />
      <path d="M16 21V3c-2 1.5-3 4-3 7v3h3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16.5 6.5l3 3M18.5 4.5l2 2" />
    </>
  ),
};

export function FacilityIcon({
  name,
  className = "h-4 w-4",
}: {
  name: FacilityIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
