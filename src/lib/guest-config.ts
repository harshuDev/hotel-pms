/**
 * Settings -> Guest Configuration (0073): identification types, additional
 * guest fields, and the guest registration form.
 */

export interface IdentificationType {
  id: string;
  title: string;
}

/**
 * The kinds an additional guest field can be. The ids are what
 * `guest_fields_kind_known` allows, so adding one is a line here and a
 * constraint change in a migration.
 */
export const GUEST_FIELD_KINDS = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "yes_no", label: "Yes / No" },
] as const;

export type GuestFieldKind = (typeof GUEST_FIELD_KINDS)[number]["id"];

export interface GuestField {
  id: string;
  label: string;
  kind: GuestFieldKind;
}

/** What prints on the Guest Registration Card. Null is "not set". */
export interface RegistrationForm {
  question1: string | null;
  question2: string | null;
  terms: string | null;
}

/** A yes/no value as stored and as read on the card. */
export function guestFieldDisplay(kind: GuestFieldKind, value: string | undefined): string {
  if (!value) return "";
  if (kind === "yes_no") return value === "yes" ? "Yes" : value === "no" ? "No" : value;
  return value;
}
