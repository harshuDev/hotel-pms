"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { setRoomPhoto } from "@/lib/actions/settings";

/** Matches the bucket's own limit, so the refusal is ours rather than a 413. */
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/**
 * A photograph of one room.
 *
 * THE FILE GOES STRAIGHT FROM THE BROWSER TO SUPABASE STORAGE, under the
 * signed-in user's own session, so the storage policy decides whether it is
 * allowed. Sending it through a Server Action would mean carrying the bytes
 * twice and buying nothing: the policy is the same policy either way, and
 * nothing here holds a key the browser should not have.
 *
 * The path is `<property>/<room>/<name>`, which is the shape both the storage
 * policy and `set_room_photo()` check. The database does not take the
 * browser's word for it — a path naming another room is refused there, not
 * here, because a check that only runs in a form is not a check.
 */
export function RoomPhoto({
  propertyId,
  roomId,
  roomNumber,
  photoUrl,
  photoPath,
}: {
  propertyId: string;
  roomId: string;
  roomNumber: string;
  photoUrl: string | null;
  photoPath: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function upload(file: File) {
    setError(null);

    if (!TYPES.includes(file.type)) {
      setError("That file is not a picture. Use a JPEG, PNG, WebP or AVIF.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That picture is over 5MB. Save it smaller and try again.");
      return;
    }

    setBusy(true);
    const supabase = createClient();

    /*
     * A fresh name every time rather than one fixed per room.
     *
     * Overwriting the same object would leave the browser and every CDN in
     * front of it showing the old picture at the same URL, which reads as the
     * upload having silently failed. The previous file is removed by the
     * action once the new path is recorded.
     */
    const ext = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()
      : "jpg";
    const path = `${propertyId}/${roomId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("room-photos")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      setBusy(false);
      setError(uploadError.message);
      return;
    }

    startTransition(async () => {
      const result = await setRoomPhoto({
        roomId,
        path,
        previousPath: photoPath,
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await setRoomPhoto({
        roomId,
        path: null,
        previousPath: photoPath,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const working = busy || pending;

  return (
    <div className="flex items-start gap-4">
      <div className="h-[84px] w-[112px] shrink-0 overflow-hidden rounded-md border border-line bg-shell">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- the bucket
          // is a runtime host, so next/image would need it in remotePatterns
          // and a rebuild every time a property is added.
          <img
            src={photoUrl}
            alt={`Room ${roomNumber}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-xxs text-ink-faint">
            No picture
          </span>
        )}
      </div>

      <div className="min-w-0">
        <input
          ref={inputRef}
          type="file"
          accept={TYPES.join(",")}
          disabled={working}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          className="block w-full text-[12.5px] text-ink-muted file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium file:text-ink hover:file:bg-shell"
        />

        <div className="mt-2 flex items-center gap-3 text-[12.5px]">
          {working && <span className="text-ink-faint">Uploading&hellip;</span>}
          {photoUrl && !working && (
            <button
              type="button"
              onClick={remove}
              className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Remove the picture
            </button>
          )}
        </div>

        {error && (
          <p className={cn("mt-2 text-[12.5px] leading-snug text-rose-600")}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
