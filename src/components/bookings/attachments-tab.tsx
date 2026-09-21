"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import {
  attachmentUploadPath,
  bookingAttachmentUrl,
  deleteBookingAttachment,
  recordBookingAttachment,
} from "@/lib/actions/booking-files";
import { formatStampInProperty } from "@/lib/dates";
import type { BookingAttachment } from "@/lib/types";

/**
 * The Attachments tab, which the client's reference PMS carries and this one
 * did not until 0063. "Copy them too, I just want to clone the application."
 *
 * THE FILE GOES STRAIGHT FROM THIS BROWSER TO STORAGE, under the user's own
 * session, exactly as a room photograph does. Nothing on the server holds a
 * service key, so the upload is the one thing a Server Action does not do:
 * the action hands back where to put it, the browser puts it there, and a
 * second action records the row once the object exists.
 *
 * READING ONE IS A SIGNED URL, not a public link. The bucket is private
 * because an attachment here is a passport scan or a registration card, not
 * marketing material, and the link expires so one pasted into a chat stops
 * working.
 */
export function AttachmentsTab({
  bookingId,
  attachments,
  timezone,
  canEdit,
}: {
  bookingId: string;
  attachments: BookingAttachment[];
  /** The property's zone, so a stamp reads as the front desk's clock. */
  timezone: string;
  /** Front office and above. A reader still sees the list and can open a file. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    try {
      const where = await attachmentUploadPath(bookingId, file.name);
      if (!where.ok) {
        setError(where.error);
        return;
      }

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(where.data.bucket)
        .upload(where.data.path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const recorded = await recordBookingAttachment({
        bookingId,
        storagePath: where.data.path,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      if (!recorded.ok) {
        /*
         * The object is up and the row is not, so take the object back out.
         * Leaving it would be a file nothing points at, inside a bucket
         * whose whole point is that only the booking's people reach it.
         */
        await supabase.storage.from(where.data.bucket).remove([where.data.path]);
        setError(recorded.error);
        return;
      }

      router.refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function open(a: BookingAttachment) {
    setError(null);
    const link = await bookingAttachmentUrl(a.storagePath);
    if (!link.ok) {
      setError(link.error);
      return;
    }
    window.open(link.data.url, "_blank", "noopener,noreferrer");
  }

  function remove(a: BookingAttachment) {
    setError(null);
    startTransition(async () => {
      const result = await deleteBookingAttachment({
        bookingId,
        attachmentId: a.id,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-line bg-white shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
          Attachments
        </h2>
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="rounded-md bg-chrome-800 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-chrome-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-50"
            >
              {busy ? "Uploading…" : "Add file"}
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="border-b border-line bg-rose-50 px-4 py-2 text-[13px] text-rose-700">
          {error}
        </p>
      )}

      {attachments.length === 0 ? (
        <EmptyState
          title="No files yet"
          hint={canEdit ? "Add a passport scan, a registration card or a purchase order." : undefined}
        />
      ) : (
        <ul className="divide-y divide-line">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 px-4 py-2.5 text-[13px]"
            >
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => void open(a)}
                  className="truncate text-left font-medium text-brass underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                >
                  {a.fileName}
                </button>
                <div className="tnum mt-0.5 text-xxs text-ink-faint">
                  {formatSize(a.sizeBytes)} ·{" "}
                  {formatStampInProperty(a.createdAt, timezone)}
                  {a.uploadedByName ? ` · ${a.uploadedByName}` : ""}
                </div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(a)}
                  className={cn(
                    "shrink-0 rounded border border-line px-2 py-1 text-xxs text-ink-muted transition",
                    "hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500",
                    pending && "opacity-50",
                  )}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/*
 * Bytes in the units a person reads. Not money, so `money.ts` is not involved
 * and ordinary arithmetic is fine here -- the currency rule is about currency.
 */
function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
