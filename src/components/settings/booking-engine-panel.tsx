"use client";

import { useT } from "@/components/i18n";
import { useRef, useState } from "react";
import { cn } from "@/components/ui";
import { Menu, MenuItem } from "@/components/menu";
import { EditIcon } from "@/components/settings/finance-panels";
import {
  DEFAULT_PRIVACY_POLICY,
  PLACEHOLDERS,
  roomTypeProfileSlug,
  type BookingEngineProfile,
  type BookingEngineTexts,
} from "@/lib/booking-engine";
import type { RoomTypeSetting } from "@/lib/types";
import {
  deleteBookingEngineProfile,
  saveBookingEngineProfile,
  saveBookingEngineTexts,
} from "@/lib/actions/settings";

/*
 * Settings -> Connectivity Settings -> Booking Engine Settings (0098), cloned
 * from the client's reference: Booking Engine Profiles (Title, Slug, Link),
 * then the Privacy Policy and the Terms & Conditions under one SAVE.
 *
 * LIVE on the guest booking page: a profile's link opens it on the profile's
 * room types, and the policy and terms are linked beside its agreement.
 *
 * Default and one profile per room type are not rows: Default is the page as
 * it is, and each room type's is `__room_type_<id>`, answered by
 * `public_booking_engine()`. Only the hotel's own profiles can be edited.
 *
 * The texts are plain text ("## " heading, "- " bullet), not the reference's
 * rich-text editor -- see src/lib/booking-engine.ts. DROP IN'S inserts the
 * {{hotel_*}} placeholders at the cursor.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

type ProfileDraft = {
  id: string | null;
  title: string;
  slug: string;
  slugTouched: boolean;
  roomTypeIds: string[];
};

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[12px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-5 py-2 text-[12px] font-semibold uppercase tracking-wide text-ink hover:bg-shell disabled:opacity-50";
const th = "px-1.5 py-2.5 text-left text-[12.5px] font-semibold text-ink";
const td = "px-1.5 py-1.5 text-[12.5px]";
const iconButton =
  "grid h-7 w-7 place-items-center rounded text-brass hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const field =
  "w-full rounded border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-brass";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function OpenLink({ href }: { href: string }) {
  const tr = useT();
  return (
    <a href={href} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-brass hover:underline">
      <EditIcon />
      {tr("Open")}
    </a>
  );
}

function DropIns({ onPick }: { onPick: (token: string) => void }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  return (
    <Menu
      label={tr("Drop in's")}
      open={open}
      onOpenChange={setOpen}
      align="end"
      triggerClassName="rounded border border-line bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink hover:bg-shell"
    >
      {PLACEHOLDERS.map((p) => (
        <MenuItem
          key={p.token}
          onSelect={() => {
            setOpen(false);
            onPick(p.token);
          }}
        >
          {p.label} <span className="text-ink-faint">{p.token}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}

function TextCard({
  title,
  value,
  onChange,
  rows,
  canEdit,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  canEdit: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function insert(token: string) {
    const el = ref.current;
    const at = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    onChange(value.slice(0, at) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }
  return (
    <div>
      <div className="flex items-end justify-between gap-3 border-b border-line pb-1.5">
        <h3 className="text-[15px] text-ink">{title}</h3>
        {canEdit && <DropIns onPick={insert} />}
      </div>
      <textarea
        ref={ref}
        aria-label={title}
        value={value}
        rows={rows}
        readOnly={!canEdit}
        onChange={(e) => onChange(e.target.value)}
        className={cn(field, "mt-2 font-sans leading-relaxed")}
      />
    </div>
  );
}

export function BookingEnginePanel({
  propertyId,
  profiles,
  texts,
  roomTypes,
  canEdit,
  pending,
  run,
}: {
  propertyId: string;
  profiles: BookingEngineProfile[];
  texts: BookingEngineTexts;
  roomTypes: RoomTypeSetting[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [privacy, setPrivacy] = useState(texts.privacyPolicy ?? DEFAULT_PRIVACY_POLICY);
  const [terms, setTerms] = useState(texts.terms ?? "");
  const base = `/book/${propertyId}`;
  const typeName = (t: RoomTypeSetting) => t.displayName ?? t.name;

  function saveProfile(d: ProfileDraft) {
    run(async () => {
      const result = await saveBookingEngineProfile({
        id: d.id,
        title: d.title,
        slug: d.slug,
        roomTypeIds: d.roomTypeIds,
      });
      if (result.ok) setDraft(null);
      return result;
    }, tr("{name} saved.", { name: d.title.trim() || tr("Profile") }));
  }

  function saveTexts() {
    run(
      () =>
        saveBookingEngineTexts({
          // The untouched default is stored as nothing, so it stays the default.
          privacyPolicy: privacy.trim() === DEFAULT_PRIVACY_POLICY.trim() ? "" : privacy,
          terms,
        }),
      tr("Booking engine saved."),
    );
  }

  return (
    <div className="max-w-6xl space-y-6">
      <section className={card}>
        <div className="px-4 pt-5 sm:px-6">
          <h2 className="border-b border-line pb-2 text-[16px] text-ink">{tr("Booking Engine Profiles")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem]">
              <thead>
                <tr className="border-b border-line">
                  <th className={cn(th, "w-[40%]")}>{tr("Title")}</th>
                  <th className={th}>{tr("Slug")}</th>
                  <th className={th}>{tr("Link")}</th>
                  <th className="w-16" aria-label={tr("Actions")} />
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line">
                  <td className={cn(td, "text-ink")}>{tr("Default")}</td>
                  <td className={td} />
                  <td className={td}><OpenLink href={base} /></td>
                  <td />
                </tr>
                {profiles.map((p) => (
                  <tr key={p.id} className={cn("border-b border-line", draft?.id === p.id && "bg-shell/70")}>
                    <td className={cn(td, "text-ink")}>
                      {p.title}
                      {p.roomTypeIds.length > 0 && (
                        <span className="ml-2 text-[11.5px] text-ink-muted">
                          {roomTypes.filter((t) => p.roomTypeIds.includes(t.id)).map(typeName).join(", ")}
                        </span>
                      )}
                    </td>
                    <td className={cn(td, "text-ink")}>{p.slug}</td>
                    <td className={td}><OpenLink href={`${base}?profile=${encodeURIComponent(p.slug)}`} /></td>
                    <td className="py-0.5">
                      {canEdit && (
                        <span className="flex justify-end">
                          <button type="button" aria-label={tr("Edit {name}", { name: p.title })} className={iconButton}
                            onClick={() => setDraft({ id: p.id, title: p.title, slug: p.slug, slugTouched: true, roomTypeIds: p.roomTypeIds })}>
                            <EditIcon />
                          </button>
                          <button
                            type="button"
                            aria-label={tr("Delete {name}", { name: p.title })}
                            className={iconButton}
                            onClick={() => {
                              if (!confirm(tr("Delete {name}? Its link stops narrowing the rooms.", { name: p.title }))) return;
                              run(async () => {
                                const result = await deleteBookingEngineProfile(p.id);
                                if (result.ok && draft?.id === p.id) setDraft(null);
                                return result;
                              }, tr("{name} deleted.", { name: p.title }));
                            }}
                          >
                            <CrossIcon />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {roomTypes.map((t) => {
                  const slug = roomTypeProfileSlug(t.id);
                  return (
                    <tr key={t.id} className="border-b border-line">
                      <td className={cn(td, "italic text-ink")}>{typeName(t)}</td>
                      <td className={cn(td, "text-ink")}>{slug}</td>
                      <td className={td}><OpenLink href={`${base}?profile=${slug}`} /></td>
                      <td />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {draft && (
            <form
              className="mt-4 space-y-3 rounded border border-line p-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveProfile(draft);
              }}
            >
              <h3 className="border-b border-line pb-1 text-[15px] text-ink">
                {draft.id ? tr("Edit Profile") : tr("Add New Profile")}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[12px] text-ink-muted">
                  {tr("Title")}
                  <input value={draft.title} maxLength={80} autoFocus
                    onChange={(e) => {
                      const title = e.target.value;
                      setDraft({ ...draft, title, slug: draft.slugTouched ? draft.slug : slugify(title) });
                    }}
                    className={cn(field, "mt-1")} />
                </label>
                <label className="block text-[12px] text-ink-muted">
                  {tr("Slug")}
                  <input value={draft.slug} maxLength={60}
                    onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase(), slugTouched: true })}
                    className={cn(field, "mt-1")} />
                </label>
              </div>
              <fieldset>
                <legend className="text-[12px] text-ink-muted">{tr("Room types")}</legend>
                <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1.5">
                  {roomTypes.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-[13px] text-ink">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brass"
                        checked={draft.roomTypeIds.includes(t.id)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            roomTypeIds: e.target.checked
                              ? [...draft.roomTypeIds, t.id]
                              : draft.roomTypeIds.filter((x) => x !== t.id),
                          })
                        }
                      />
                      {typeName(t)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex justify-end gap-3">
                <button type="button" className={secondary} onClick={() => setDraft(null)}>{tr("Cancel")}</button>
                <button type="submit" className={primary} disabled={pending}>{tr("Save")}</button>
              </div>
            </form>
          )}
        </div>
        {canEdit && !draft ? (
          <div className="mt-4 rounded-b-lg border-t border-line bg-shell px-4 py-3 sm:px-6">
            <button type="button" className={primary}
              onClick={() => setDraft({ id: null, title: "", slug: "", slugTouched: false, roomTypeIds: [] })}>
              {tr("Add new profile")}
            </button>
          </div>
        ) : (
          <div className="h-4" />
        )}
      </section>

      <section className={card}>
        <div className="space-y-8 px-4 py-5 sm:px-6">
          <TextCard title={tr("Booking Engine - Privacy Policy")} value={privacy} onChange={setPrivacy} rows={22} canEdit={canEdit} />
          <TextCard title={tr("Booking Engine - Terms & Conditions")} value={terms} onChange={setTerms} rows={6} canEdit={canEdit} />
        </div>
        {canEdit && (
          <div className="flex justify-end rounded-b-lg border-t border-line bg-shell px-4 py-3 sm:px-6">
            <button type="button" className={primary} disabled={pending} onClick={saveTexts}>
              {tr("Save")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
