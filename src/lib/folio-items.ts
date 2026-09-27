import { msg } from "@/lib/i18n/translate";
import type { FolioItemType } from "@/lib/types";

/** The folio item types a guest sees on a bill, in plain words. Render with `tr()`. */
export const FOLIO_ITEM_LABEL: Record<FolioItemType, string> = {
  room_charge: msg("Room"),
  tax: msg("Tax"),
  food_beverage: msg("Food and drink"),
  laundry: msg("Laundry"),
  minibar: msg("Minibar"),
  transport: msg("Transport"),
  miscellaneous: msg("Miscellaneous"),
  discount: msg("Discount"),
  adjustment: msg("Adjustment"),
  reversal: msg("Reversal"),
};
