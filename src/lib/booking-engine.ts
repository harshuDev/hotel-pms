import { msg } from "@/lib/i18n/translate";

/**
 * Settings -> Connectivity Settings -> Booking Engine Settings (0098).
 *
 * The privacy policy and terms are PLAIN TEXT, never HTML: "## " starts a
 * heading, "- " a bullet, a blank line a paragraph, and `parseDocument()`
 * turns that into blocks the page draws as React elements. The reference's
 * rich-text editor would mean serving browser-typed HTML to guests with no
 * sanitiser in this codebase.
 *
 * A property that never saved a privacy policy uses DEFAULT_PRIVACY_POLICY,
 * filled from its own details through the {{hotel_*}} placeholders -- the
 * reference's "DROP IN'S".
 */

export interface BookingEngineProfile {
  id: string;
  title: string;
  slug: string;
  /** Empty is every room type. */
  roomTypeIds: string[];
}

export interface BookingEngineTexts {
  /** Null is the default policy. */
  privacyPolicy: string | null;
  /** Null is none. */
  terms: string | null;
}

/** The slug a room type's own profile goes by. Mirrors room_type_profile_slug(). */
export function roomTypeProfileSlug(roomTypeId: string): string {
  return `__room_type_${roomTypeId.replace(/-/g, "").slice(0, 8)}`;
}

export const PLACEHOLDERS = [
  { token: "{{hotel_name}}", label: msg("Hotel name") },
  { token: "{{hotel_address}}", label: msg("Address") },
  { token: "{{hotel_city}}", label: msg("City") },
  { token: "{{hotel_state}}", label: msg("State / region") },
  { token: "{{hotel_postal_code}}", label: msg("Postal code") },
  { token: "{{hotel_country}}", label: msg("Country") },
  { token: "{{hotel_email}}", label: msg("Email") },
  { token: "{{hotel_phone}}", label: msg("Phone") },
] as const;

export type PlaceholderValues = {
  hotel_name: string;
  hotel_address: string;
  hotel_city: string;
  hotel_state: string;
  hotel_postal_code: string;
  hotel_country: string;
  hotel_email: string;
  hotel_phone: string;
};

/**
 * Fills every known {{hotel_*}} token; an unknown token is left as typed. A
 * detail the hotel has not entered leaves no stray comma behind it.
 */
export function fillPlaceholders(text: string, values: PlaceholderValues): string {
  return text
    .replace(/\{\{\s*(hotel_[a-z_]+)\s*\}\}/g, (whole, key: string) =>
      key in values ? values[key as keyof PlaceholderValues] : whole,
    )
    .split("\n")
    .map((line) =>
      line.replace(/(,\s*){2,}/g, ", ").replace(/^\s*,\s*/, "").replace(/\s*,\s*$/, ""),
    )
    .join("\n");
}

export type DocBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/** Plain text to blocks. Never produces markup -- the caller draws text nodes. */
export function parseDocument(text: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "list", items: list });
    list = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else if (/^#{1,3}\s+/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", text: line.replace(/^#{1,3}\s+/, "") });
    } else if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      list.push(line.replace(/^\s*[-*]\s+/, ""));
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

export const DEFAULT_PRIVACY_POLICY = `## Welcome to the Privacy Policy of {{hotel_name}}.

We are committed to preserving the privacy, integrity and security of the personal information we hold about our customers and those who make contact with us. This Privacy Policy explains how we manage and use this personal information and how we comply with our legal obligations under applicable data protection laws.

It is important that you read this privacy policy carefully so that you are fully aware of how we collect and process personal information.

## {{hotel_name}} - WHO WE ARE

This Privacy Policy covers the personal information collected and held by {{hotel_name}}.

## THE CONTROLLER OF YOUR PERSONAL INFORMATION

Under applicable data protection laws, we are required to advise you who is the controller of your personal information. The controller of, and the person responsible for, the personal information covered by this Policy is {{hotel_name}}. Contact details for the controller are set out below under "HOW TO CONTACT US".

## TERMINOLOGY USED IN THIS POLICY

A "customer" is someone who makes a booking, stays, or uses any of the services of {{hotel_name}}.

A "contact" is someone who makes an enquiry or contacts us, on our website or in person, by letter, phone or email, but is not a customer of ours.

"we", "us" and "our" refer to {{hotel_name}}.

"you" and "your" refer to our customers and contacts.

## PERSONAL INFORMATION WE COLLECT AND HOLD AND THE PURPOSE FOR WHICH WE USE IT

When you make a booking we collect your name, email address, telephone number, the dates of your stay, the number of guests, and any requests you tell us about. We use this information to take and manage your booking, to contact you about your stay, and to provide the services you have asked for.

When you arrive we may be required by law to record identity details, such as your nationality and the number of your passport or identity document.

We keep records of the charges and payments on your stay so that we can bill you correctly and meet our accounting and tax obligations.

## LEGAL BASIS FOR PROCESSING

We process your personal information because it is necessary to perform our contract with you, because we are required to by law, or because we have a legitimate interest in running our business, which does not override your rights.

## WHO WE SHARE YOUR INFORMATION WITH

We do not sell your personal information. We share it only with those who help us provide our services, such as our booking and payment providers, and with public authorities where the law requires us to. They may use it only for the purpose we gave it to them for.

## HOW LONG WE KEEP YOUR INFORMATION

We keep your personal information only for as long as we need it for the purposes set out in this Policy, including to meet our legal, accounting and reporting obligations.

## HOW WE PROTECT YOUR INFORMATION

We take appropriate technical and organisational measures to protect your personal information against loss, misuse and unauthorised access, and only those who need it to do their work can see it.

## YOUR RIGHTS

Under certain circumstances, you have rights under data protection laws in relation to your personal information. You have the right:

- to request access to your personal information and to check that we are lawfully processing it;
- to request correction of the personal information we hold about you;
- to request erasure of your personal information where there is no good reason for us to continue processing it;
- to object to processing of your personal information where we are relying on a legitimate interest;
- to request that we restrict the processing of your personal information;
- to request the transfer of your personal information to you or to a third party;
- to withdraw consent at any time where we are relying on consent to process your personal information.

If you wish to exercise any of the rights set out above, please contact us using the details below. You will not have to pay a fee to access your personal information or to exercise any of the other rights, although we may charge a reasonable fee if a request is clearly unfounded, repetitive or excessive.

We may need to request specific information from you to help us confirm your identity. We try to respond to all legitimate requests within one month.

## MANAGING YOUR PERSONAL INFORMATION

If at any time you believe that any personal information we are holding about you is inaccurate, out of date or incomplete, please tell us and we will correct it.

## CHANGES TO THIS POLICY

We may change this Privacy Policy from time to time to take account of changes in law or the needs of our business. Please refer back to this page regularly to see any changes or updates.

## THIRD-PARTY LINKS

This website may include links to third-party websites, plug-ins and applications. We do not control these third-party websites and are not responsible for their privacy statements. When you leave our website, we encourage you to read the privacy notice of every website you visit.

## HOW TO CONTACT US

If you have any questions about this Privacy Policy, including any requests to exercise your legal rights, please contact us using the details below:

By Post
{{hotel_name}}, {{hotel_address}}, {{hotel_city}}, {{hotel_state}}, {{hotel_postal_code}}, {{hotel_country}}

By Email
{{hotel_email}}`;
