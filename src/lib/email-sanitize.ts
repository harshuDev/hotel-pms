import sanitizeHtml from "sanitize-html";
import { asEmailHtml } from "@/lib/email-html";

/*
 * The one allow-list for HTML that goes out in an email (0131, shared since
 * 0150): formatting, links, pictures and tables survive; script, event
 * handlers, forms and frames do not. The booking's Email tab runs its message
 * through it before sending, and Email Setup runs every template through it
 * before saving, so nothing stored there was ever unsanitised. Server only.
 */

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img", "span", "font", "u", "s", "strike", "h1", "h2", "h3", "h4", "h5", "h6",
  ],
  allowedAttributes: {
    "*": ["style", "align", "width", "height", "colspan", "rowspan", "title", "color", "face", "size"],
    a: ["href", "target"],
    img: ["src", "alt"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
};

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE);
}

/** An Email Setup text as safe HTML, whether it was saved as plain text or HTML. */
export function emailSetupHtml(text: string | null | undefined): string {
  return sanitizeEmailHtml(asEmailHtml(text));
}

/** The plain-text version of HTML: a mail's text part, a PDF's paragraph. */
export function emailHtmlToText(html: string): string {
  return sanitizeHtml(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n"),
    { allowedTags: [], allowedAttributes: {} },
  )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
