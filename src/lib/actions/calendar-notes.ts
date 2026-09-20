"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Day notes on the calendar.
 *
 * Thin wrappers, like every other write here: the role gate and the property
 * isolation are the RLS policy on `calendar_notes`, so they apply however the
 * row is written rather than only when it is written through this file.
 */

type Result = { ok: true } | { ok: false; error: string };

export async function saveCalendarNote(input: {
  /** The day on the board this note is about. */
  noteDate: string;
  body: string;
  /** Null writes a new note; an id corrects one. */
  id: string | null;
}): Promise<Result> {
  if (input.body.trim() === "") {
    return { ok: false, error: "Write something in the note first." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_calendar_note", {
    p_note_date: input.noteDate,
    p_body: input.body,
    p_id: input.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteCalendarNote(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_calendar_note", { p_id: id });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/calendar");
  return { ok: true };
}
