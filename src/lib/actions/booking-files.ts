"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Attachments and correspondence on a booking (0063).
 *
 * THE FILE ITSELF NEVER PASSES THROUGH HERE. It goes straight from the
 * browser to Supabase Storage under the uploader's own session, the same way
 * a room photograph does, so the storage policies apply and nothing on this
 * server holds a service key. These actions record the row, mint a signed URL
 * to read one back, and remove both halves.
 *
 * The bucket is PRIVATE, unlike `room-photos`. A room photograph is marketing
 * material; an attachment on a reservation is a passport scan or a signed
 * registration card, and a public bucket would put those one guessed URL away
 * from anybody.
 */

type Result<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function failure(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

function revalidateBooking(bookingId: string) {
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/calendar");
}

/** The bucket, named once so the browser and the server cannot disagree. */
export async function attachmentsBucket(): Promise<string> {
  return "booking-attachments";
}

/**
 * The object path a new upload should take.
 *
 * `<property_id>/<booking_id>/<something unique>-<name>`, because the storage
 * policy and `add_booking_attachment()` both test that prefix. Worked out on
 * the server so the browser is not the only thing deciding where a file
 * lands, and given a fresh name each time: overwriting a path would leave a
 * CDN serving the old file, which reads as the upload having failed.
 */
export async function attachmentUploadPath(
  bookingId: string,
  fileName: string,
): Promise<Result<{ bucket: string; path: string }>> {
  const supabase = await createClient();

  const { data: staff, error: staffError } = await supabase
    .from("staff_users")
    .select("property_id")
    .maybeSingle();
  if (staffError) return failure(staffError.message);
  if (!staff?.property_id) return failure("You are not on a property.");

  /*
   * The name is sanitised rather than trusted. A path separator in a file
   * name would move the object out of the booking's folder, which the policy
   * would then refuse -- better to strip it here than to fail the upload.
   */
  const safe =
    fileName
      .replace(/[^\w.\- ]+/g, "")
      .replace(/\s+/g, "-")
      .slice(-80) || "attachment";

  return {
    ok: true,
    data: {
      bucket: "booking-attachments",
      path: `${staff.property_id}/${bookingId}/${crypto.randomUUID()}-${safe}`,
    },
  };
}

/**
 * Records a file that is already in the bucket.
 *
 * Postgres re-checks the `<property>/<booking>/` prefix the storage policy
 * checked, because the path is a string the browser chose. Two checks on one
 * rule, for the same reason `set_room_photo()` has them.
 */
export async function recordBookingAttachment(input: {
  bookingId: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<Result> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("add_booking_attachment", {
    p_booking_id: input.bookingId,
    p_storage_path: input.storagePath,
    p_file_name: input.fileName,
    p_content_type: input.contentType,
    p_size_bytes: input.sizeBytes,
  });
  if (error) return failure(error.message);

  revalidateBooking(input.bookingId);
  return { ok: true, data: undefined };
}

/**
 * A short-lived link to read one attachment.
 *
 * SIGNED RATHER THAN PUBLIC, which is the whole reason the bucket is private.
 * The URL is minted under the caller's own session, so the storage policy
 * decides whether they may have it, and it expires — a link pasted into a
 * chat window stops working rather than handing a passport scan to whoever
 * finds it later.
 */
export async function bookingAttachmentUrl(
  storagePath: string,
): Promise<Result<{ url: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from("booking-attachments")
    .createSignedUrl(storagePath, 60 * 5);

  if (error || !data?.signedUrl) {
    return failure(error?.message ?? "That file could not be opened.");
  }
  return { ok: true, data: { url: data.signedUrl } };
}

/**
 * Removes the row and the object.
 *
 * The row goes first and hands back the path, so the object is only removed
 * once Postgres has agreed the caller may. The reverse order would delete a
 * file the database then refused to forget.
 *
 * A failure to remove the object is NOT reported as a failure: the row is
 * gone, the attachment is off the booking as far as anybody can see, and a
 * stranded object in a private bucket is tidying rather than a problem to put
 * in front of a receptionist.
 */
export async function deleteBookingAttachment(input: {
  bookingId: string;
  attachmentId: string;
}): Promise<Result> {
  const supabase = await createClient();

  const { data: path, error } = await supabase.rpc(
    "delete_booking_attachment",
    { p_attachment_id: input.attachmentId },
  );
  if (error) return failure(error.message);

  if (path) {
    await supabase.storage.from("booking-attachments").remove([path]);
  }

  revalidateBooking(input.bookingId);
  return { ok: true, data: undefined };
}

/**
 * Records an email that was sent to a guest about this booking.
 *
 * IT DOES NOT SEND, and the interface must not imply otherwise. There is no
 * mail provider in this deployment and no API key in any environment, and a
 * Send button that cannot send is the dead control this application keeps
 * refusing to ship. What the reference's Email tab is actually read for is
 * "what have we already told them", which is what this records.
 *
 * Wiring a provider later is this action plus a key — `booking_emails`
 * already carries `sent_at` and a `status` with `sent` and `failed` in it.
 */
export async function logBookingEmail(input: {
  bookingId: string;
  toAddress: string;
  subject: string;
  body: string;
}): Promise<Result> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("log_booking_email", {
    p_booking_id: input.bookingId,
    p_to_address: input.toAddress,
    p_subject: input.subject,
    p_body: input.body,
  });
  if (error) return failure(error.message);

  revalidateBooking(input.bookingId);
  return { ok: true, data: undefined };
}
