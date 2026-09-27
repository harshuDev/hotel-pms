import { msg } from "@/lib/i18n/translate";
/**
 * Settings -> Other -> Reactions (0104). STORED, NOT YET RUN: nothing fires a
 * reaction. See the migration for why the reference's two prepayment tasks
 * have nothing to act on in this schema.
 *
 * THE LISTS BEYOND WHAT THE SCREENSHOT SHOWED ARE PROVISIONAL -- the
 * reference's dropdowns were not seen open. Every id here is also checked in
 * 0104 (`reactions` constraints, `save_reaction()`,
 * `reaction_conditions_check()`); they change together.
 */

export const REACTION_TASKS = [
  {
    id: "convert_prepayments_to_charges",
    label: msg("Convert prepayments to charges"),
    description: msg("Convert prepayments to regular charges on booking checkin"),
  },
  {
    id: "redeem_prepayments",
    label: msg("Redeem prepayments"),
    description: msg("Redeem all prepayments that linked to booking on booking cancellation"),
  },
] as const;

export type ReactionTask = (typeof REACTION_TASKS)[number]["id"];

export const REACTION_EVENTS = [
  { id: "after_booking_created", label: msg("After booking creation") },
  { id: "after_booking_modified", label: msg("After booking modification") },
  { id: "after_booking_cancellation", label: msg("After booking cancellation") },
  { id: "after_check_in", label: msg("After check in") },
  { id: "after_check_out", label: msg("After check out") },
] as const;

export type ReactionEvent = (typeof REACTION_EVENTS)[number]["id"];

export function reactionEventLabel(id: string): string {
  return REACTION_EVENTS.find((e) => e.id === id)?.label ?? id;
}

export const CONDITION_FIELDS = [
  { id: "channel", label: msg("Sales channel"), kind: "channel" },
  { id: "booking_status", label: msg("Booking status"), kind: "status" },
  { id: "settlement", label: msg("Settlement"), kind: "settlement" },
  { id: "room_type", label: msg("Room type"), kind: "room_type" },
  { id: "rate_plan", label: msg("Rate plan"), kind: "rate_plan" },
  { id: "nights", label: msg("Nights"), kind: "number" },
  { id: "adults", label: msg("Adults"), kind: "number" },
  { id: "guest_country", label: msg("Guest country"), kind: "country" },
] as const;

export type ConditionField = (typeof CONDITION_FIELDS)[number]["id"];

export const CONDITION_OPS = [
  { id: "eq", label: "is", numeric: false },
  { id: "neq", label: msg("is not"), numeric: false },
  { id: "gt", label: msg("greater than"), numeric: true },
  { id: "lt", label: msg("less than"), numeric: true },
] as const;

export type ConditionOp = (typeof CONDITION_OPS)[number]["id"];

export const BOOKING_STATUS_CHOICES = [
  { id: "pending", label: msg("Pending") },
  { id: "confirmed", label: msg("Confirmed") },
  { id: "checked_in", label: msg("In house") },
  { id: "checked_out", label: msg("Departed") },
  { id: "canceled", label: msg("Cancelled") },
  { id: "no_show", label: msg("No show") },
] as const;

export const SETTLEMENT_CHOICES = [
  { id: "at_property", label: msg("At property") },
  { id: "prepaid_to_channel", label: msg("Prepaid to channel") },
  { id: "virtual_card", label: msg("Virtual card") },
] as const;

export interface ReactionCondition {
  field: string;
  op: string;
  value: string;
}

export interface ReactionGroup {
  match: "all" | "any";
  items: (ReactionCondition | ReactionGroup)[];
}

export function isGroup(item: ReactionCondition | ReactionGroup): item is ReactionGroup {
  return "match" in item;
}

export const EMPTY_GROUP: ReactionGroup = { match: "all", items: [] };

export interface Reaction {
  id: string;
  task: string;
  title: string;
  description: string | null;
  conditions: ReactionGroup;
  events: string[];
  isEnabled: boolean;
}

/** Reads a stored tree back defensively: anything not in the written shape is dropped. */
export function parseConditions(raw: unknown): ReactionGroup {
  if (!raw || typeof raw !== "object") return EMPTY_GROUP;
  const r = raw as { match?: unknown; items?: unknown };
  const items = Array.isArray(r.items) ? r.items : [];
  return {
    match: r.match === "any" ? "any" : "all",
    items: items.flatMap((it): (ReactionCondition | ReactionGroup)[] => {
      if (!it || typeof it !== "object") return [];
      if ("match" in it) return [parseConditions(it)];
      const c = it as { field?: unknown; op?: unknown; value?: unknown };
      return [{ field: String(c.field ?? ""), op: String(c.op ?? ""), value: String(c.value ?? "") }];
    }),
  };
}
