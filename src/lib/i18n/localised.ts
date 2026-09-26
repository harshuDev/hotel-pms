import { getT } from "@/lib/i18n/server";

/**
 * An error a staff Server Action is about to return, in the reader's language
 * (0106). Most are the database's own refusals ("Only managers and
 * administrators can change reactions"), matched exactly or -- where the
 * message carries a value, "Sweeply is already added" -- by pattern; one the
 * dictionaries do not know stays as written. Translated here, on the server,
 * so no screen has to remember to.
 */
export async function localised(text: string): Promise<string> {
  return (await getT()).message(text);
}

/**
 * "The day did not close: <the database's reason>" -- the prefix is ours and
 * translated as written; the reason is translated like any refusal.
 */
export async function localisedAs(prefix: string, message: string): Promise<string> {
  const tr = await getT();
  return `${tr(prefix)}: ${tr.message(message)}`;
}
