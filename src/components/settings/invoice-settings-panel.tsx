"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { COUNTRIES } from "@/lib/countries";
import { createClient } from "@/lib/supabase/client";
import {
  HOTEL_ASSETS_BUCKET,
  LOGO_MAX_BYTES,
  LOGO_TEXT_MAX,
  LOGO_TYPES,
  NOTES_MAX,
  ROUND_LOGIC,
  ROUND_TO,
  type InvoiceSettings,
  type RoundLogic,
  type RoundTo,
} from "@/lib/invoice-settings";
import {
  saveInvoiceGeneral,
  saveInvoiceLogoAndNotes,
  saveInvoiceNumberSettings,
  saveRoundingOptions,
  saveStatementSettings,
  setInvoiceLogo,
} from "@/lib/actions/settings";

/*
 * Settings -> Finances -> Invoice Settings (0080, 0082), cloned from the
 * client's reference: five cards -- General Invoice Settings, Invoice Logo and
 * Notes, Rounding Options, Invoice Number Settings, Statement Settings --
 * each with its own Save, because each saves only what it shows.
 *
 * Rounding, the custom invoice number switch and the statement texts are
 * STORED, NOT YET LIVE; see 0082 and CLAUDE.md for why each.
 *
 * Read by the printable invoice, `/bookings/[id]/invoice` -- see 0080 for what
 * each setting changes there.
 *
 * The reference's LOCALE button is not copied, as elsewhere: nothing here is
 * stored per language.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "overflow-hidden rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-8 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
// Underlined fields whose placeholder is the label, as the reference's are;
// a small label appears above once there is a value, so it is never lost.
const line =
  "peer w-full border-0 border-b border-line bg-transparent px-0.5 pb-2 pt-5 text-[14px] text-ink outline-none placeholder:text-ink-muted focus:border-brass disabled:text-ink-muted";

function Field({
  id,
  label,
  value,
  onChange,
  disabled,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  maxLength?: number;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        value={value}
        placeholder={label}
        aria-label={label}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={line}
      />
      {value !== "" && (
        <label htmlFor={id} className="absolute left-0.5 top-0 text-[11px] text-ink-muted">
          {label}
        </label>
      )}
    </div>
  );
}

export function InvoiceSettingsPanel({
  settings,
  propertyId,
  canEdit,
  pending,
  run,
}: {
  settings: InvoiceSettings;
  propertyId: string;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const router = useRouter();
  const [general, setGeneral] = useState({
    showRoomNumberForExtras: settings.showRoomNumberForExtras,
    showNightsBreakdown: settings.showNightsBreakdown,
    vatRegistered: settings.vatRegistered,
    companyName: settings.companyName ?? "",
    country: settings.country ?? "",
    region: settings.region ?? "",
    city: settings.city ?? "",
    address: settings.address ?? "",
    postcode: settings.postcode ?? "",
  });
  const [useText, setUseText] = useState(settings.useTextInsteadOfLogo);
  const [logoText, setLogoText] = useState(settings.logoText ?? "");
  const [notes, setNotes] = useState(settings.notes ?? "");
  const [roundLogic, setRoundLogic] = useState<RoundLogic>(settings.roundLogic);
  const [roundTo, setRoundTo] = useState<RoundTo>(settings.roundTo);
  const [customNumbers, setCustomNumbers] = useState(settings.customInvoiceNumbers);
  const [reminder, setReminder] = useState(settings.statementReminderText ?? "");
  const [terms, setTerms] = useState(settings.statementTermsText ?? "");

  const fileRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [logoPending, startLogo] = useTransition();
  const [dragOver, setDragOver] = useState(false);

  /*
   * The logo goes straight from the browser to storage under the user's own
   * session, as a room photograph does: the storage policy decides, and
   * `set_invoice_logo()` checks the path again. A fresh name each time, so
   * no browser or CDN keeps showing the old picture at the same URL.
   */
  async function upload(file: File) {
    setLogoError(null);
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoError("That file is not a picture. Use a JPEG, PNG or WebP.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError("That picture is over 2MB. Save it smaller and try again.");
      return;
    }
    setUploading(true);
    const ext = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()
      : "png";
    const path = `${propertyId}/invoice-logo/${crypto.randomUUID()}.${ext}`;
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(HOTEL_ASSETS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      setUploading(false);
      setLogoError(error.message);
      return;
    }
    startLogo(async () => {
      const result = await setInvoiceLogo(path);
      setUploading(false);
      if (!result.ok) {
        // Nothing points at the file, so it does not stay in the bucket.
        await supabase.storage.from(HOTEL_ASSETS_BUCKET).remove([path]);
        setLogoError(result.error);
        return;
      }
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  function removeLogo() {
    setLogoError(null);
    startLogo(async () => {
      const result = await setInvoiceLogo(null);
      if (!result.ok) {
        setLogoError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const set = (patch: Partial<typeof general>) => setGeneral({ ...general, ...patch });
  const busy = uploading || logoPending;

  return (
    <div className="max-w-5xl space-y-8">
      {/* General Invoice Settings ----------------------------------------- */}
      <section className={card}>
        <h2 className="border-b border-line px-4 py-4 text-[19px] text-ink">General Invoice Settings</h2>
        <div className="px-4 pb-6 pt-4">
          <div className="space-y-3">
            {(
              [
                ["showRoomNumberForExtras", "Show room number for extras"],
                ["showNightsBreakdown", "Show nights breakdown"],
                ["vatRegistered", "Are you VAT Registered"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2.5 text-[14px] text-ink">
                <input
                  type="checkbox"
                  checked={general[key]}
                  disabled={!canEdit}
                  onChange={(e) => set({ [key]: e.target.checked })}
                  className="h-[18px] w-[18px] accent-brass"
                />
                {label}
              </label>
            ))}
          </div>

          <h3 className="mt-10 text-[16px] text-ink">Company Information for Invoice</h3>
          <p className="border-b border-line pb-1.5 text-[11.5px] text-ink">
            By default we use Hotel Name and Hotel Address, but you can override that values here.
          </p>
          <div className="mt-2 space-y-4">
            <Field
              id="inv-company"
              label="Company Name"
              value={general.companyName}
              onChange={(v) => set({ companyName: v })}
              disabled={!canEdit}
            />
            <div className="relative">
              <select
                id="inv-country"
                aria-label="Country"
                value={general.country}
                disabled={!canEdit}
                onChange={(e) => set({ country: e.target.value })}
                className={cn(line, "cursor-pointer", general.country === "" && "text-ink-muted")}
              >
                <option value="">Country</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code} className="text-ink">
                    {c.name}
                  </option>
                ))}
              </select>
              {general.country !== "" && (
                <label htmlFor="inv-country" className="absolute left-0.5 top-0 text-[11px] text-ink-muted">
                  Country
                </label>
              )}
            </div>
            <Field
              id="inv-region"
              label="County / State / Province"
              value={general.region}
              onChange={(v) => set({ region: v })}
              disabled={!canEdit}
            />
            <Field
              id="inv-city"
              label="City / Town / Village"
              value={general.city}
              onChange={(v) => set({ city: v })}
              disabled={!canEdit}
            />
            <Field
              id="inv-address"
              label="Address"
              value={general.address}
              onChange={(v) => set({ address: v })}
              disabled={!canEdit}
            />
            <Field
              id="inv-postcode"
              label="Postcode"
              value={general.postcode}
              onChange={(v) => set({ postcode: v })}
              disabled={!canEdit}
            />
          </div>
        </div>
        {canEdit && (
          <div className="flex justify-end border-t border-line bg-shell/60 px-4 py-4">
            <button
              type="button"
              disabled={pending}
              className={primary}
              onClick={() => run(() => saveInvoiceGeneral(general), "Invoice settings saved.")}
            >
              Save
            </button>
          </div>
        )}
      </section>

      {/* Invoice Logo and Notes ------------------------------------------- */}
      <section className={card}>
        <h2 className="border-b border-line px-4 py-4 text-[19px] text-ink">Invoice Logo and Notes</h2>
        <div className="px-4 pb-6 pt-8">
          {/*
            The drop zone IS the upload control, as the reference's is: click
            it or drop a picture on it. It uploads at once, like a room
            photograph -- the Save below is for the text and the notes.
          */}
          <div
            onDragOver={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void upload(file);
            }}
            className={cn(
              "relative grid min-h-[200px] place-items-center rounded border border-dashed border-line",
              dragOver && "border-brass bg-brass-wash",
            )}
          >
            {canEdit ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="absolute inset-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                aria-label={settings.logoUrl ? "Replace the invoice logo" : "Upload the invoice logo"}
              />
            ) : null}
            {settings.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- the bucket
              // is a runtime host; next/image would need it in remotePatterns.
              <img
                src={settings.logoUrl}
                alt="Invoice logo"
                className="pointer-events-none max-h-[160px] max-w-[80%] object-contain"
              />
            ) : (
              <span className="pointer-events-none text-[13px] text-ink-muted">
                {busy ? "Uploading…" : "Drop the logo here, or click to choose it"}
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={LOGO_TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </div>
          {canEdit && settings.logoUrl && (
            <button
              type="button"
              onClick={removeLogo}
              disabled={busy}
              className="mt-2 text-[12.5px] text-rose-700 underline-offset-2 hover:underline disabled:opacity-50"
            >
              Remove logo
            </button>
          )}
          {logoError && (
            <p role="alert" className="mt-2 text-[12.5px] text-rose-700">
              {logoError}
            </p>
          )}

          <label className="mt-3 flex items-center gap-2.5 text-[14px] text-ink">
            <input
              type="checkbox"
              checked={useText}
              disabled={!canEdit}
              onChange={(e) => setUseText(e.target.checked)}
              className="h-[18px] w-[18px] accent-brass"
            />
            Use Text Instead of Logo
          </label>

          <div className="mt-4">
            <label htmlFor="inv-logo-text" className="block text-[11px] text-ink-muted">
              Text
            </label>
            <input
              id="inv-logo-text"
              value={logoText}
              maxLength={LOGO_TEXT_MAX}
              disabled={!canEdit}
              onChange={(e) => setLogoText(e.target.value)}
              className="w-full border-0 border-b border-line bg-transparent px-0.5 py-1.5 text-[14px] text-ink outline-none focus:border-brass disabled:text-ink-muted"
            />
            <p className="tnum mt-0.5 text-right text-[11px] text-ink-muted">
              {logoText.length}/{LOGO_TEXT_MAX}
            </p>
          </div>

          <div className="mt-2">
            <Field
              id="inv-notes"
              label="Default Notes"
              value={notes}
              maxLength={NOTES_MAX}
              onChange={setNotes}
              disabled={!canEdit}
            />
            <p className="tnum mt-0.5 text-right text-[11px] text-ink-muted">
              {notes.length}/{NOTES_MAX}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex justify-end border-t border-line bg-shell/60 px-4 py-4">
            <button
              type="button"
              disabled={pending}
              className={primary}
              onClick={() =>
                run(
                  () => saveInvoiceLogoAndNotes({ useTextInsteadOfLogo: useText, logoText, notes }),
                  "Invoice logo and notes saved.",
                )
              }
            >
              Save
            </button>
          </div>
        )}
      </section>

      {/* Rounding Options ------------------------------------------------- */}
      <section className={card}>
        <div className="border-b border-line px-4 py-4">
          <h2 className="text-[19px] text-ink">Rounding Options</h2>
          <p className="text-[13px] text-ink">This rounding options would be used across whole system</p>
        </div>
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(10rem,16rem)_1fr] sm:items-center">
          <label htmlFor="inv-round-logic" className="text-[14px] text-ink-muted">
            Round Logic:
          </label>
          <select
            id="inv-round-logic"
            value={roundLogic}
            disabled={!canEdit}
            onChange={(e) => setRoundLogic(e.target.value as RoundLogic)}
            className="rounded border border-line bg-white px-3 py-1.5 text-[14px] text-ink focus:border-brass focus:outline-none"
          >
            {ROUND_LOGIC.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <label htmlFor="inv-round-to" className="text-[14px] text-ink-muted">
            Round To:
          </label>
          <select
            id="inv-round-to"
            value={roundTo}
            disabled={!canEdit}
            onChange={(e) => setRoundTo(e.target.value as RoundTo)}
            className="rounded border border-line bg-white px-3 py-1.5 text-[14px] text-ink focus:border-brass focus:outline-none"
          >
            {ROUND_TO.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {canEdit && (
          <div className="flex justify-end border-t border-line bg-shell/60 px-4 py-4">
            <button
              type="button"
              disabled={pending}
              className={primary}
              onClick={() => run(() => saveRoundingOptions({ roundLogic, roundTo }), "Rounding options saved.")}
            >
              Save
            </button>
          </div>
        )}
      </section>

      {/* Invoice Number Settings ------------------------------------------ */}
      <section className={card}>
        <h2 className="border-b border-line px-4 py-4 text-[19px] text-ink">Invoice Number Settings</h2>
        <div className="px-4 py-5">
          <label className="flex items-center gap-2.5 text-[14px] text-ink">
            <input
              type="checkbox"
              checked={customNumbers}
              disabled={!canEdit}
              onChange={(e) => setCustomNumbers(e.target.checked)}
              className="h-[18px] w-[18px] accent-brass"
            />
            Enable Custom Invoice Number Settings
          </label>
          <p className="mt-8 text-center text-[12px] text-ink">
            By default we use simple increment number for your invoices.
          </p>
        </div>
        {canEdit && (
          <div className="flex justify-end border-t border-line bg-shell/60 px-4 py-4">
            <button
              type="button"
              disabled={pending}
              className={primary}
              onClick={() => run(() => saveInvoiceNumberSettings(customNumbers), "Invoice number settings saved.")}
            >
              Save
            </button>
          </div>
        )}
      </section>

      {/* Statement Settings ----------------------------------------------- */}
      <section className={card}>
        <h2 className="border-b border-line px-4 py-4 text-[19px] text-ink">Statement Settings</h2>
        <div className="space-y-4 px-4 pb-6 pt-3">
          <Field
            id="inv-reminder"
            label="Reminder Text"
            value={reminder}
            maxLength={2000}
            onChange={setReminder}
            disabled={!canEdit}
          />
          <Field
            id="inv-terms"
            label="Terms Text"
            value={terms}
            maxLength={2000}
            onChange={setTerms}
            disabled={!canEdit}
          />
        </div>
        {canEdit && (
          <div className="flex justify-end border-t border-line bg-shell/60 px-4 py-4">
            <button
              type="button"
              disabled={pending}
              className={primary}
              onClick={() =>
                run(
                  () => saveStatementSettings({ reminderText: reminder, termsText: terms }),
                  "Statement settings saved.",
                )
              }
            >
              Save
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
