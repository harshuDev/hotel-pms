/*
 * Email Setup's texts as HTML (0150). The template editors write HTML now;
 * everything saved before them is plain text. These read either, so a footer
 * or a check-in note written before the editor arrived still shows as written.
 * Pure: the editor and the server both use it.
 */

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Text the editors wrote, as opposed to plain text from before them. */
export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][a-z0-9]*[\s>/]/i.test(text);
}

/** Either kind as HTML: plain text becomes paragraphs, its line breaks kept. */
export function asEmailHtml(text: string | null | undefined): string {
  const value = (text ?? "").trim();
  if (value === "") return "";
  if (looksLikeHtml(value)) return value;
  return value
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** One line of either kind, for the summary beside "Open template editor". */
export function emailPreview(text: string | null | undefined, max = 90): string {
  const plain = (text ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
