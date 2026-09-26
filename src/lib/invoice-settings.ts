/**
 * Settings -> Finances -> Invoice Settings (0080), as the settings screen and
 * the printable invoice both read it. No row reads as everything off and no
 * company override -- the invoice then uses the hotel's own name and address.
 */
export interface InvoiceSettings {
  showRoomNumberForExtras: boolean;
  showNightsBreakdown: boolean;
  vatRegistered: boolean;
  companyName: string | null;
  /** ISO 3166-1 alpha-2, like the property's own country. */
  country: string | null;
  region: string | null;
  city: string | null;
  address: string | null;
  postcode: string | null;
  logoPath: string | null;
  /** Public URL of the logo, worked out on the server from the path. */
  logoUrl: string | null;
  useTextInsteadOfLogo: boolean;
  logoText: string | null;
  /** "Default Notes", printed at the foot of the invoice. */
  notes: string | null;
  /** Rounding Options (0082) -- stored, not yet live. */
  roundLogic: RoundLogic;
  roundTo: RoundTo;
  /** Invoice Number Settings (0082) -- stored, not yet live. */
  customInvoiceNumbers: boolean;
  /** Statement Settings (0082) -- stored, not yet live. */
  statementReminderText: string | null;
  statementTermsText: string | null;
}

/*
 * The reference shows "None" and "2 Points after dot" selected; the other
 * choices are the ordinary ones a rounding setting offers. Stored only: every
 * amount here is integer cents worked out in Postgres, and rounding "across
 * whole system" is a change to every money function, not a setting.
 */
export const ROUND_LOGIC = [
  { id: "none", label: "None" },
  { id: "nearest", label: "Round to nearest" },
  { id: "up", label: "Round up" },
  { id: "down", label: "Round down" },
] as const;
export const ROUND_TO = [
  { id: "two_decimals", label: "2 Points after dot" },
  { id: "one_decimal", label: "1 Point after dot" },
  { id: "whole", label: "Whole number" },
] as const;
export type RoundLogic = (typeof ROUND_LOGIC)[number]["id"];
export type RoundTo = (typeof ROUND_TO)[number]["id"];

/** Default Notes' limit, as the reference counts it. */
export const NOTES_MAX = 255;

/** The bucket the invoice logo lives in. Created by migration 0080. */
export const HOTEL_ASSETS_BUCKET = "hotel-assets";

/** Matches the bucket's own limit and types (0080, 0081). */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** The reference's character limit on the text printed instead of a logo. */
export const LOGO_TEXT_MAX = 255;
