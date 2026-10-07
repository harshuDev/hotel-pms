import { msg } from "@/lib/i18n/translate";
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
  /** How the value is entered: a price, a night count, a cap, or a switch. */
  kind: "money" | "nights" | "count" | "flag";
  /** Rate plan fields are per plan; the other two apply whatever is sold. */
  needsPlan: boolean;
  /** The cell's value out of the grid row. */
  read: (cell: InventoryCell) => number | boolean | null;
  /** What the bulk-edit value box is called. */
  valueLabel: string;
  /**
   * The bulk editor's heading, whole (0106). It was "Set " + the title in
   * lower case, which lower-cases a German noun and fixes English word order.
   */
  setHeading: string;
}

export const SCREENS: Record<InventoryField, ScreenSpec> = {
  rate: {
    setHeading: msg("Set rates"),
    title: msg("Rates"),
    kind: "money",
    needsPlan: true,
    read: (c) => c.rateCents,
    valueLabel: msg("Rate a night"),
  },
  min_stay_through: {
    setHeading: msg("Set min stay through"),
    title: msg("Min stay through"),
    kind: "nights",
    needsPlan: true,
    read: (c) => c.minStayThrough,
    valueLabel: msg("Nights"),
  },
  min_stay_arrival: {
    setHeading: msg("Set min stay arrival"),
    title: msg("Min stay arrival"),
    kind: "nights",
    needsPlan: true,
    read: (c) => c.minStayArrival,
    valueLabel: msg("Nights"),
  },
  max_stay: {
    setHeading: msg("Set max stay"),
    title: msg("Max stay"),
    kind: "nights",
    needsPlan: true,
    read: (c) => c.maxStay,
    valueLabel: msg("Nights"),
  },
  closed_to_arrival: {
    setHeading: msg("Set closed to arrival"),
    title: msg("Closed to arrival"),
    kind: "flag",
    needsPlan: true,
    read: (c) => c.closedToArrival,
    valueLabel: msg("Closed"),
  },
  closed_to_departure: {
    setHeading: msg("Set closed to departure"),
    title: msg("Closed to departure"),
    kind: "flag",
    needsPlan: true,
    read: (c) => c.closedToDeparture,
    valueLabel: msg("Closed"),
  },
  stop_sell: {
    setHeading: msg("Set stop sell"),
    title: msg("Stop sell"),
    kind: "flag",
    needsPlan: true,
    read: (c) => c.stopSell,
    valueLabel: msg("Stopped"),
  },
  allotment: {
    setHeading: msg("Set availability"),
    title: msg("Availability"),
    kind: "count",
    needsPlan: false,
    read: (c) => c.allotment,
    valueLabel: msg("Rooms"),
  },
  close_out: {
    setHeading: msg("Set close out"),
    title: msg("Close out"),
    kind: "flag",
    needsPlan: false,
    read: (c) => c.closeOut,
    valueLabel: msg("Closed"),
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
