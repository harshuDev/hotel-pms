import type { MealType } from "@/lib/types";
import { msg } from "@/lib/i18n/translate";

/*
 * The rate plan form's Meal Type (0115), the reference's eight in its order.
 * The ids are the values `rate_plans_meal_plan_known` allows, and
 * `set_rate_plan_meal_plan()` turns each into the meals it means -- the two
 * change together.
 */
export const MEAL_PLANS = [
  "room_only",
  "bed_and_breakfast",
  "bed_only",
  "half_board",
  "full_board",
  "all_inclusive",
  "custom",
  "self_catering",
] as const;

export type MealPlan = (typeof MEAL_PLANS)[number];

/** The English label, which is also the translation key. */
export const MEAL_PLAN_LABEL: Record<MealPlan, string> = {
  room_only: msg("Room only"),
  bed_and_breakfast: msg("Bed and breakfast"),
  bed_only: msg("Bed only"),
  half_board: msg("Half board"),
  full_board: msg("Full board"),
  all_inclusive: msg("All inclusive"),
  custom: msg("Custom Meal Plan"),
  self_catering: msg("Self Catering"),
};

/** The meals a plan's Meal Type means; Custom is whatever was ticked. */
export const MEAL_PLAN_MEALS: Record<Exclude<MealPlan, "custom">, MealType[]> = {
  room_only: [],
  bed_and_breakfast: ["breakfast"],
  bed_only: [],
  half_board: ["breakfast", "dinner"],
  full_board: ["breakfast", "lunch", "dinner"],
  all_inclusive: ["breakfast", "lunch", "dinner"],
  self_catering: [],
};

export function isMealPlan(v: string): v is MealPlan {
  return (MEAL_PLANS as readonly string[]).includes(v);
}
