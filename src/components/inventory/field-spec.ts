import type { InventoryCell, InventoryField } from "@/lib/types";

/**
 * What each of the nine Inventory screens shows and sets.
 *
 * They are one grid with a different column brought forward, so they are one
 * component reading this table rather than nine near-identical screens that
 * drift apart.
 */
export interface ScreenSpec {
  title: string;
  subtitle: string;
  /** How the value is entered: a price, a night count, a cap, or a switch. */
  kind: "money" | "nights" | "count" | "flag";
  /** Rate plan fields are per plan; the other two apply whatever is sold. */
  needsPlan: boolean;
  /** The cell's value out of the grid row. */
  read: (cell: InventoryCell) => number | boolean | null;
  /** What the bulk-edit value box is called. */
  valueLabel: string;
  /** One line under the grid saying what the number means. */
  note: string;
}

export const SCREENS: Record<InventoryField, ScreenSpec> = {
  rate: {
    title: "Rates",
    subtitle: "The price of one room, per night",
    kind: "money",
    needsPlan: true,
    read: (c) => c.rateCents,
    valueLabel: "Rate a night",
    note: "A night with no rate loaded is not free — it cannot be sold on this plan at all, and taking a booking against it will say so. Leave the box empty and apply to clear a rate back to nothing.",
  },
  min_stay_through: {
    title: "Min stay through",
    subtitle: "Shortest stay that may cover a night",
    kind: "nights",
    needsPlan: true,
    read: (c) => c.minStayThrough,
    valueLabel: "Nights",
    note: "Applies to any stay covering the night, whenever it arrived. Use this to stop one-night bookings eating into a busy weekend. Leave the box empty to clear the rule.",
  },
  min_stay_arrival: {
    title: "Min stay arrival",
    subtitle: "Shortest stay that may start on a night",
    kind: "nights",
    needsPlan: true,
    read: (c) => c.minStayArrival,
    valueLabel: "Nights",
    note: "Applies only to stays arriving that day, so a guest already in house is unaffected. Leave the box empty to clear the rule.",
  },
  max_stay: {
    title: "Max stay",
    subtitle: "Longest stay that may cover a night",
    kind: "nights",
    needsPlan: true,
    read: (c) => c.maxStay,
    valueLabel: "Nights",
    note: "Keeps a long low-rate stay from blocking a period you expect to sell at a higher rate. Leave the box empty to clear the rule.",
  },
  closed_to_arrival: {
    title: "Closed to arrival",
    subtitle: "Nights nobody may check in",
    kind: "flag",
    needsPlan: true,
    read: (c) => c.closedToArrival,
    valueLabel: "Closed",
    note: "A guest already staying can stay through a closed date; only arrivals are refused.",
  },
  closed_to_departure: {
    title: "Closed to departure",
    subtitle: "Nights nobody may check out",
    kind: "flag",
    needsPlan: true,
    read: (c) => c.closedToDeparture,
    valueLabel: "Closed",
    note: "Checked against the departure date, which is not a night stayed. Use it to hold a stay across a peak night rather than losing the room mid-period.",
  },
  stop_sell: {
    title: "Stop sell",
    subtitle: "Nights this rate plan is not sold",
    kind: "flag",
    needsPlan: true,
    read: (c) => c.stopSell,
    valueLabel: "Stopped",
    note: "Stops this rate plan only. Other plans keep selling the same rooms — to close the room type outright, use Close out.",
  },
  allotment: {
    title: "Availability",
    subtitle: "How many of each type may be sold a night",
    kind: "count",
    needsPlan: false,
    read: (c) => c.allotment,
    valueLabel: "Rooms",
    note: "A ceiling, never a promise: rooms out of order still come off the top, so the sellable figure can be lower than the allotment but never higher. Leave the box empty to go back to selling every room that exists.",
  },
  close_out: {
    title: "Close out",
    subtitle: "Nights a room type is not sold at all",
    kind: "flag",
    needsPlan: false,
    read: (c) => c.closeOut,
    valueLabel: "Closed",
    note: "Closes the room type on every rate plan at once, which is what makes it different from Stop sell.",
  },
};

export const FIELD_BY_ROUTE: Record<string, InventoryField> = {
  "rates-all": "rate",
  availability: "allotment",
  "min-stay-through": "min_stay_through",
  "min-stay-arrival": "min_stay_arrival",
  "max-stay": "max_stay",
  cta: "closed_to_arrival",
  ctd: "closed_to_departure",
  "stop-sell": "stop_sell",
  "close-out": "close_out",
};
