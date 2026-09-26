/**
 * Hotel Content -> Extras (0069).
 *
 * "Accounting category" in the client's reference is our `folio_item_type`:
 * the revenue bucket the Extras, Financial and Accounting reports split by.
 * Only the five a person may post by hand are here -- `post_charge()` refuses
 * room_charge, reversal and discount, and tax and adjustment are not things a
 * hotel sells. The ids are what `extras_item_type_postable` allows.
 *
 * The labels are the ones the booking screen's Extras tab already prints, so
 * the same charge reads the same in both places.
 */

export const EXTRA_ACCOUNTING_CATEGORIES = [
  { id: "food_beverage", label: "Food & beverage" },
  { id: "laundry", label: "Laundry" },
  { id: "minibar", label: "Minibar" },
  { id: "transport", label: "Transport" },
  { id: "miscellaneous", label: "Miscellaneous" },
] as const;

export type ExtraItemType = (typeof EXTRA_ACCOUNTING_CATEGORIES)[number]["id"];

export function accountingCategoryLabel(id: string): string {
  return EXTRA_ACCOUNTING_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/**
 * The reference's "Is Meal" column. Not a stored flag: an extra is a meal
 * when its accounting category is food and beverage, so the two can never
 * disagree.
 */
export function isMealExtra(itemType: string): boolean {
  return itemType === "food_beverage";
}

export interface ExtraCategory {
  id: string;
  title: string;
  /** The rate its extras are taxed at when they name none themselves. */
  taxRateId: string | null;
}

export interface ExtraItem {
  id: string;
  categoryId: string;
  title: string;
  priceCents: number;
  /** Null means the category's rate applies, and if that is null, none. */
  taxRateId: string | null;
  itemType: ExtraItemType;
}

export interface ExtrasCatalog {
  categories: ExtraCategory[];
  extras: ExtraItem[];
}
