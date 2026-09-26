import Link from "next/link";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { PrintButton } from "@/components/bookings/print-button";
import { getCustomerForEdit } from "@/lib/actions/customers";
import { COUNTRIES } from "@/lib/countries";
import { guestFieldDisplay } from "@/lib/guest-config";
import {
  getBookingDetail,
  getBookingRoomLines,
  getGuestFields,
  getIdentificationTypes,
  getPropertySettings,
  getRegistrationForm,
} from "@/lib/queries";

export const metadata = { title: "Registration card" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * THE GUEST REGISTRATION CARD (0073) -- what Settings -> Guest Configuration
 * -> Guest Registration Form prints on. One page per booking: the hotel, the
 * stay, the guest's details as the Customers form holds them (including the
 * identification type and the property's additional guest fields), the two
 * custom questions with room to answer, the terms, and a line to sign.
 *
 * Blank where the record is blank, rather than hidden: the card is handed to
 * the guest at the desk to complete, so an empty line is where they write.
 * The terms are plain text with the hotel's line breaks kept.
 */
export default async function RegistrationCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const detail = await getBookingDetail(id);
  if (!detail) notFound();

  const [rooms, guest, property, form, types, fields] = await Promise.all([
    getBookingRoomLines(id),
    getCustomerForEdit(detail.customerId),
    getPropertySettings(),
    getRegistrationForm(),
    getIdentificationTypes(),
    getGuestFields(),
  ]);
  const g = guest.ok ? guest.data : null;

  const country = (code: string | undefined) =>
    code ? COUNTRIES.find((c) => c.code === code)?.name ?? code : "";
  const date = (d: string | undefined | null) => (d ? format(parseISO(d), "d MMM yyyy") : "");
  const address = [
    property.addressLine1,
    property.addressLine2,
    property.city,
    property.region,
    property.postcode,
    country(property.country ?? undefined),
  ]
    .filter((x) => x && String(x).trim() !== "")
    .join(", ");
  const liveRooms = rooms.filter((r) => r.status !== "canceled");
  const idType = types.find((t) => t.id === g?.identificationTypeId)?.title ?? "";

  const Line = ({ label, value }: { label: string; value?: string | number | null }) => (
    <div className="flex items-end gap-3 border-b border-line pb-1 pt-3">
      <span className="w-40 shrink-0 text-[12px] uppercase tracking-[0.08em] text-ink-faint">{label}</span>
      <span className="min-h-[1.25rem] flex-1 text-[14px] text-ink">{value ?? ""}</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/bookings/${detail.bookingId}`}
          className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          ← {detail.reference}
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-lg border border-line bg-white p-8 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
          <div>
            <h1 className="font-display text-[22px] font-semibold tracking-tightest text-ink">
              {property.name}
            </h1>
            {address && <p className="mt-1 text-[12.5px] text-ink-muted">{address}</p>}
            {(property.phone || property.email) && (
              <p className="text-[12.5px] text-ink-muted">
                {[property.phone, property.email].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="font-display text-[16px] font-semibold tracking-tightest text-ink">
              Guest Registration Card
            </p>
            <p className="tnum mt-1 text-[13px] text-ink-muted">{detail.reference}</p>
          </div>
        </header>

        <section className="mt-5">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Stay</h2>
          <div className="grid gap-x-8 sm:grid-cols-2">
            <Line label="Arrival" value={date(detail.checkIn)} />
            <Line label="Departure" value={date(detail.checkOut)} />
            <Line label="Nights" value={detail.nights} />
            <Line
              label="Guests"
              value={`${detail.adults} adult${detail.adults === 1 ? "" : "s"}${
                detail.children > 0 ? `, ${detail.children} child${detail.children === 1 ? "" : "ren"}` : ""
              }`}
            />
            <Line
              label={liveRooms.length === 1 ? "Room" : "Rooms"}
              value={liveRooms
                .map((r) => (r.roomNumber ? `${r.roomNumber} · ${r.roomTypeName}` : r.roomTypeName))
                .join(", ")}
            />
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Guest</h2>
          <div className="grid gap-x-8 sm:grid-cols-2">
            <Line label="Name" value={detail.customerName} />
            <Line label="Date of birth" value={date(g?.dateOfBirth)} />
            <Line label="Nationality" value={country(g?.nationality)} />
            <Line label="Country of residence" value={country(g?.country)} />
            <Line label="Identification type" value={idType} />
            <Line label="Document number" value={g?.passportNumber} />
            <Line label="Document expiry" value={date(g?.passportExpiry)} />
            <Line label="Email" value={g?.email || detail.customerEmail} />
            <Line label="Phone" value={g?.phone || detail.customerPhone} />
            {fields.map((f) => (
              <Line key={f.id} label={f.label} value={guestFieldDisplay(f.kind, g?.customFields[f.id])} />
            ))}
          </div>
        </section>

        {(form.question1 || form.question2) && (
          <section className="mt-6 space-y-4">
            {[form.question1, form.question2]
              .filter((q): q is string => Boolean(q))
              .map((q) => (
                <div key={q}>
                  <p className="whitespace-pre-line text-[13.5px] text-ink">{q}</p>
                  <div className="mt-6 border-b border-line" />
                  <div className="mt-6 border-b border-line" />
                </div>
              ))}
          </section>
        )}

        {form.terms && (
          <section className="mt-6">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">
              Terms and conditions
            </h2>
            <p className="mt-2 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-muted">
              {form.terms}
            </p>
          </section>
        )}

        <section className="mt-10 grid gap-8 sm:grid-cols-2">
          <div>
            <div className="h-10 border-b border-ink" />
            <p className="mt-1 text-[12px] uppercase tracking-[0.08em] text-ink-faint">Guest signature</p>
          </div>
          <div>
            <div className="h-10 border-b border-ink" />
            <p className="mt-1 text-[12px] uppercase tracking-[0.08em] text-ink-faint">Date</p>
          </div>
        </section>
      </article>
    </div>
  );
}
