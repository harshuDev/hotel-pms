"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCustomers } from "@/lib/queries";
import type { CustomerKind } from "@/lib/types";

/**
 * Writes behind the Customers screen.
 *
 * The three buttons on that screen shipped `disabled` with "Available in Phase
 * 2" on them and stayed that way; these are what makes them do something.
 * Everything goes through an RPC, so the role checks and the property scoping
 * live in Postgres rather than here — the browser is not where you decide who
 * may merge a customer.
 */

export interface SaveCustomerInput {
  id: string | null;
  kind: CustomerKind;
  firstName: string;
  lastName: string;
  companyName: string;
  nationalIdNumber: string;
  email: string;
  phone: string;
  excludeFromEmail: boolean;
  /*
    Identity, for the Immigration and Country reports. All optional: a
    reservation is taken over the phone with a name, and a passport is seen
    when the guest walks in. Requiring any of it here would make the form
    refuse the commonest thing it is used for.
  */
  nationality: string;
  country: string;
  passportNumber: string;
  passportExpiry: string;
  dateOfBirth: string;
}

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/** Postgres raises these with a message meant to be read; pass it through. */
function failure(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export async function saveCustomer(
  input: SaveCustomerInput,
): Promise<Result<{ id: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_customer", {
    p_kind: input.kind,
    p_first_name: input.firstName.trim() || null,
    p_last_name: input.lastName.trim() || null,
    p_company_name: input.companyName.trim() || null,
    p_national_id_number: input.nationalIdNumber.trim() || null,
    p_email: input.email.trim() || null,
    p_phone: input.phone.trim() || null,
    p_exclude_from_email: input.excludeFromEmail,
    p_id: input.id,
    p_nationality: input.nationality.trim() || null,
    p_country: input.country.trim() || null,
    p_passport_number: input.passportNumber.trim() || null,
    // An empty date input posts "", which is not a date. Null means "not
    // recorded"; "" would be a parse error at the other end.
    p_passport_expiry: input.passportExpiry.trim() || null,
    p_date_of_birth: input.dateOfBirth.trim() || null,
  });

  if (error) return failure(error.message);

  revalidatePath("/customers");
  return { ok: true, data: { id: data as string } };
}

/** The tickbox in the table. One field, one call. */
export async function setExcludeFromEmail(
  id: string,
  value: boolean,
): Promise<Result> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_customer_exclude_from_email", {
    p_id: id,
    p_value: value,
  });

  if (error) return failure(error.message);

  revalidatePath("/customers");
  return { ok: true };
}

export async function mergeCustomers(
  keepId: string,
  mergeIds: string[],
): Promise<
  Result<{
    bookingsMoved: number;
    foliosMoved: number;
    meetingRoomsMoved: number;
    customersMerged: number;
  }>
> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("merge_customers", {
    p_keep_id: keepId,
    p_merge_ids: mergeIds,
  });

  if (error) return failure(error.message);

  const row = (data ?? [])[0] as
    | {
        bookings_moved: number;
        folios_moved: number;
        meeting_rooms_moved: number;
        customers_merged: number;
      }
    | undefined;

  revalidatePath("/customers");
  return {
    ok: true,
    data: {
      bookingsMoved: row?.bookings_moved ?? 0,
      foliosMoved: row?.folios_moved ?? 0,
      meetingRoomsMoved: row?.meeting_rooms_moved ?? 0,
      customersMerged: row?.customers_merged ?? 0,
    },
  };
}

/** The editable fields, for the dialog. The list only carries a display name. */
export async function getCustomerForEdit(id: string): Promise<
  Result<{
    id: string;
    kind: CustomerKind;
    firstName: string;
    lastName: string;
    companyName: string;
    nationalIdNumber: string;
    email: string;
    phone: string;
    excludeFromEmail: boolean;
    nationality: string;
    country: string;
    passportNumber: string;
    passportExpiry: string;
    dateOfBirth: string;
  }>
> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("customer_for_edit", { p_id: id });
  if (error) return failure(error.message);

  const row = (data ?? [])[0] as
    | {
        id: string;
        kind: CustomerKind;
        first_name: string | null;
        last_name: string | null;
        company_name: string | null;
        national_id_number: string | null;
        email: string | null;
        phone: string | null;
        exclude_from_email: boolean;
        nationality: string | null;
        country: string | null;
        passport_number: string | null;
        passport_expiry: string | null;
        date_of_birth: string | null;
      }
    | undefined;

  if (!row) return failure("That customer could not be found.");

  return {
    ok: true,
    data: {
      id: row.id,
      kind: row.kind,
      firstName: row.first_name ?? "",
      lastName: row.last_name ?? "",
      companyName: row.company_name ?? "",
      nationalIdNumber: row.national_id_number ?? "",
      email: row.email ?? "",
      phone: row.phone ?? "",
      excludeFromEmail: row.exclude_from_email,
      // "" rather than null throughout, because these feed controlled inputs
      // and React logs a warning the moment one flips between the two.
      nationality: row.nationality ?? "",
      country: row.country ?? "",
      passportNumber: row.passport_number ?? "",
      passportExpiry: row.passport_expiry ?? "",
      dateOfBirth: row.date_of_birth ?? "",
    },
  };
}

/**
 * How many rows an export will fetch.
 *
 * A hotel's customer list has no ceiling the way its room list does, and
 * building a file out of an unbounded read is how a page falls over quietly.
 * The export says when it hit this, rather than handing over a truncated file
 * that looks complete.
 */
const EXPORT_LIMIT = 10_000;

/**
 * The whole filtered list as CSV — not just the page on screen.
 *
 * Exporting 25 of 4,000 rows because that is what the table happened to be
 * showing is the kind of thing nobody notices until they have built a mailing
 * list from it. So this re-reads with the same search and kind the screen is
 * using, and ignores its pagination.
 *
 * CSV rather than a real `.xlsx`: Excel opens it natively, and the alternative
 * is a zip-of-XML writer or a dependency, for a file that is one table of
 * plain values. The button keeps the reference system's wording; the file says
 * `.csv` so nobody is surprised by what lands.
 */
export async function exportCustomersCsv(filters: {
  q?: string;
  kind?: string;
}): Promise<Result<{ filename: string; csv: string; rows: number; capped: boolean }>> {
  try {
    const { rows, total } = await getCustomers({
      q: filters.q,
      kind: filters.kind,
      page: 1,
      perPage: EXPORT_LIMIT,
    });

    const header = [
      "Id",
      "Name",
      "Kind",
      "National Id Number",
      "Email",
      "Phone",
      "Exclude from email",
      "No of bookings",
      "Total revenue",
      "Last booking date",
      "Balance",
    ];

    const body = rows.map((c) => [
      c.ref,
      c.name,
      c.kind,
      c.nationalIdNumber ?? "",
      c.email ?? "",
      c.phone ?? "",
      c.excludeFromEmail ? "yes" : "no",
      String(c.bookingCount),
      // Plain decimal, not a formatted currency string: a spreadsheet should
      // get a number it can total, not "£1,284.00". Integer pence divided at
      // the very last step, for display only — money.ts still owns every
      // figure a person reads on screen.
      (c.totalRevenueCents / 100).toFixed(2),
      c.lastBookingDate ?? "",
      (c.balanceCents / 100).toFixed(2),
    ]);

    const csv = [header, ...body].map((r) => r.map(escapeCsv).join(",")).join("\r\n");

    const stamp = new Date().toISOString().slice(0, 10);
    return {
      ok: true,
      data: {
        filename: `customers-${stamp}.csv`,
        csv,
        rows: rows.length,
        capped: total > rows.length,
      },
    };
  } catch (e) {
    return failure(
      e instanceof Error ? e.message : "The export could not be built.",
    );
  }
}

/**
 * Quote a CSV field.
 *
 * A leading `=`, `+`, `-` or `@` makes Excel treat the value as a formula, so
 * a customer called `=cmd|...` becomes an instruction when the file is opened.
 * Prefixing with a single quote is the usual defence and keeps the text
 * readable in the cell.
 */
function escapeCsv(value: string): string {
  const risky = /^[=+\-@\t\r]/.test(value);
  const text = risky ? `'${value}` : value;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
