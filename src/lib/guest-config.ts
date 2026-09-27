import type { Translator } from "@/lib/i18n/translate";
import { msg } from "@/lib/i18n/translate";
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
  { id: "text", label: msg("Text") },
  { id: "number", label: msg("Number") },
  { id: "date", label: msg("Date") },
  { id: "yes_no", label: msg("Yes / No") },
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
export function guestFieldDisplay(tr: Translator, kind: GuestFieldKind, value: string | undefined): string {
  if (!value) return "";
  if (kind === "yes_no") return value === "yes" ? tr("Yes") : value === "no" ? tr("No") : value;
  return value;
}
