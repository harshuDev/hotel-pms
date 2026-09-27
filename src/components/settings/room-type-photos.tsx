"use client";

import { useT } from "@/components/i18n";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addRoomTypePhoto, deleteRoomTypePhoto } from "@/lib/actions/settings";
import type { RoomTypePhoto } from "@/lib/types";

/** Matches the bucket's own limit, so the refusal is ours rather than a 413. */
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
/** The same cap `add_room_type_photo()` holds. */
const MAX_PHOTOS = 12;

/**
 * A room type's own pictures (0108), several and in order.
 *
 * The same shape as a room's photograph (`room-photo.tsx`): the file goes
 * straight from the browser to the public `room-photos` bucket under the
 * signed-in user's session, at `<property>/room-types/<type>/<uuid>.<ext>`,
 * and a second call records the row -- where Postgres checks the path names
 * this property and this type. A refused row takes its file back out.
 *
 * The guest booking page shows these first, then the type's rooms' own.
 */
export function RoomTypePhotos({
  propertyId,
  roomTypeId,
  roomTypeName,
  photos,
}: {
  propertyId: string;
  roomTypeId: string;
  roomTypeName: string;
  photos: RoomTypePhoto[];
}) {
  const tr = useT();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function upload(files: File[]) {
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) {
      setError(tr("A room type holds at most 12 pictures. Remove one first."));
      return;
    }
    for (const file of files) {
      if (!TYPES.includes(file.type)) {
        setError(tr("That file is not a picture. Use a JPEG, PNG, WebP or AVIF."));
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(tr("That picture is over 5MB. Save it smaller and try again."));
        return;
      }
    }

    setBusy(true);
    const supabase = createClient();
    for (const file of files) {
      const ext = file.name.includes(".")
        ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()
        : "jpg";
      const path = `${propertyId}/room-types/${roomTypeId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("room-photos")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        setBusy(false);
        setError(uploadError.message);
        router.refresh();
        return;
      }
      const result = await addRoomTypePhoto({ roomTypeId, path });
      if (!result.ok) {
        setBusy(false);
        setError(result.error);
        router.refresh();
        return;
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    startTransition(() => router.refresh());
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteRoomTypePhoto(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const working = busy || pending;

  return (
    <div>
      {photos.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <li key={p.id} className="group relative h-[72px] w-[96px] overflow-hidden rounded-md border border-line bg-shell">
              {/* eslint-disable-next-line @next/next/no-img-element -- runtime bucket host, as room-photo.tsx */}
              <img
                src={p.url}
                alt={tr("{name}, picture {n}", { name: roomTypeName, n: i + 1 })}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                disabled={working}
                onClick={() => remove(p.id)}
                aria-label={tr("Remove picture {n}", { n: i + 1 })}
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-[13px] leading-none text-ink shadow hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {photos.length < MAX_PHOTOS && (
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={TYPES.join(",")}
          disabled={working}
          aria-label={tr("Add pictures of {name}", { name: roomTypeName })}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) void upload(files);
          }}
          className="block w-full text-[12.5px] text-ink-muted file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium file:text-ink hover:file:bg-shell"
        />
      )}
      {working && <p className="mt-1 text-[12px] text-ink-muted">{tr("Uploading…")}</p>}
      {error && <p role="alert" className="mt-1 text-[12px] text-rose-700">{error}</p>}
    </div>
  );
}
