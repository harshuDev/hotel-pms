import type { InventoryField } from "@/lib/types";

/**
 * Settings -> Inventory -> Settings (0088). All three cards are live:
 * the two cut-offs govern the guest booking page (`public_room_types()` and so
 * `create_public_booking()`), and the visibility ticks take a restriction's
 * screen out of the Inventory menu, refuse the screen, and drop its row from
 * the All screen.
 */
export interface InventorySettings {
  onlineCutoffEnabled: boolean;
  /** ISO date; no online stay may include a night after it. */
  onlineCutoffDate: string | null;
  sameDayCutoffEnabled: boolean;
  /** "HH:MM" in the hotel's own clock. */
  sameDayCutoffTime: string | null;
  visibility: InventoryVisibility;
}

/**
 * The six ticks, in the reference's order and wording. `field` is the Inventory
 * grid's own name for the column; `href` is its screen.
 */
export const INVENTORY_VISIBILITY = [
  { field: "min_stay_through", label: "Show Min Stay Through", href: "/inventory/min-stay-through" },
  { field: "min_stay_arrival", label: "Show Min Stay Arrival", href: "/inventory/min-stay-arrival" },
  { field: "closed_to_arrival", label: "Show Closed To Arrival", href: "/inventory/cta" },
  { field: "closed_to_departure", label: "Show Closed To Departure", href: "/inventory/ctd" },
  { field: "max_stay", label: "Show Max Stay", href: "/inventory/max-stay" },
  { field: "stop_sell", label: "Show Stop Sell", href: "/inventory/stop-sell" },
] as const satisfies readonly { field: InventoryField; label: string; href: string }[];

export type VisibilityField = (typeof INVENTORY_VISIBILITY)[number]["field"];
export type InventoryVisibility = Record<VisibilityField, boolean>;

export const DEFAULT_INVENTORY_SETTINGS: InventorySettings = {
  onlineCutoffEnabled: false,
  onlineCutoffDate: null,
  sameDayCutoffEnabled: false,
  sameDayCutoffTime: null,
  visibility: {
    min_stay_through: true,
    min_stay_arrival: true,
    closed_to_arrival: true,
    closed_to_departure: true,
    max_stay: true,
    stop_sell: true,
  },
};

/** Whether an Inventory field's screen is switched off. Rates and the rest never are. */
export function isInventoryFieldHidden(settings: InventorySettings, field: InventoryField): boolean {
  const entry = INVENTORY_VISIBILITY.find((v) => v.field === field);
  return entry ? !settings.visibility[entry.field] : false;
}

/** Inventory menu entries the visibility ticks take out of the nav. */
export function hiddenInventoryHrefs(settings: InventorySettings): string[] {
  return INVENTORY_VISIBILITY.filter((v) => !settings.visibility[v.field]).map((v) => v.href);
}
