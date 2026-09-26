/**
 * Hotel Content -> Room Type Facilities (0070).
 *
 * The icons a facility can carry. The reference shows the icon's own name
 * beside the glyph ("check", "bed", "wifi", "desktop"), so the names are the
 * labels too. They are the values `facilities_icon_known` allows: adding one
 * is a line here, a glyph in `facility-icon.tsx`, and that constraint.
 */
export const FACILITY_ICONS = [
  "check",
  "bed",
  "wifi",
  "desktop",
  "bath",
  "car",
  "snowflake",
  "coffee",
  "utensils",
  "key",
] as const;

export type FacilityIcon = (typeof FACILITY_ICONS)[number];

export interface Facility {
  id: string;
  title: string;
  icon: FacilityIcon;
}
