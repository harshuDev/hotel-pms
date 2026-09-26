import { parseDocument } from "@/lib/booking-engine";

/**
 * A booking engine text (0098) drawn from plain text: headings, paragraphs
 * and bullets as React elements. Never HTML -- what a hotel typed is only
 * ever a text node, so nothing it contains can run in a guest's browser.
 */
export function PlainDocument({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-[13.5px] leading-relaxed text-ink">
      {parseDocument(text).map((b, i) =>
        b.kind === "heading" ? (
          <h2 key={i} className="pt-3 font-display text-[19px] font-semibold tracking-tightest text-ink">
            {b.text}
          </h2>
        ) : b.kind === "list" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-line">
            {b.text}
          </p>
        ),
      )}
    </div>
  );
}
