import { Liquid } from "liquidjs";
import sanitizeHtml from "sanitize-html";
import type { InvoiceLiquidData } from "@/lib/invoice-data";

/*
 * THE FOLIO/INVOICE TEMPLATE (0105) IS RENDERED HERE AND NOWHERE ELSE, on the
 * server, and nothing a template produces reaches a browser without passing
 * through `sanitize-html` first.
 *
 * That is the whole reason this screen is acceptable. A template is HTML a
 * manager typed into a browser, printed back out in every other staff
 * member's session -- an administrator's included. Unsanitised, it is stored
 * script injection from the manager role into the admin one. What is allowed
 * is layout: text, headings, tables, lists, divs, spans, images and links,
 * with class and style. What is not: script, event handlers, javascript:
 * URLs, iframes, objects, embeds, forms, and ids (an id can shadow a global
 * the page's own scripts read).
 *
 * THE LIQUID ENGINE IS CLOSED DOWN TOO. Liquid itself evaluates no code, but
 * its `include`, `render` and `layout` tags read files, and by default from
 * the server's working directory -- so the file system is one that has
 * nothing in it. Parse, render and memory limits stop `{% for i in
 * (1..100000000) %}` from holding a server worker, and only an object's own
 * properties can be read. Output is escaped by default, so what a guest typed
 * is text before the sanitiser ever sees it.
 */

const NO_FILES = {
  exists: async () => false,
  existsSync: () => false,
  readFile: async () => {
    throw new Error("Templates cannot include files");
  },
  readFileSync: () => {
    throw new Error("Templates cannot include files");
  },
  resolve: (_root: string, file: string) => file,
};

const engine = new Liquid({
  fs: NO_FILES,
  root: [],
  relativeReference: false,
  dynamicPartials: false,
  ownPropertyOnly: true,
  strictFilters: true,
  // Every {{ output }} is HTML-escaped unless the template says `| raw`. A
  // guest's name comes from the public booking page; it prints as text.
  outputEscape: "escape",
  parseLimit: 250_000,
  renderLimit: 1_000,
  memoryLimit: 10_000_000,
});

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
  allowedAttributes: {
    "*": ["class", "style", "colspan", "rowspan", "align", "width", "height", "title"],
    a: ["href"],
    img: ["src", "alt"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
};

/**
 * A stylesheet cannot run script, but it sits inside a <style> element, and
 * "</style>" in it would close that element and let what follows be read as
 * HTML. No legitimate CSS needs a raw "<", so every one is written as the CSS
 * escape for it.
 */
export function safeCss(css: string): string {
  return css.replace(/</g, "\\3c ");
}

export type RenderedTemplate = { ok: true; html: string; css: string } | { ok: false; error: string };

export async function renderInvoiceTemplate(
  liquid: string,
  css: string,
  data: InvoiceLiquidData,
): Promise<RenderedTemplate> {
  try {
    const raw = await engine.parseAndRender(liquid, data);
    return { ok: true, html: sanitizeHtml(raw, SANITIZE), css: safeCss(css) };
  } catch (e) {
    const message = e instanceof Error ? e.message.split("\n")[0] : "The template could not be rendered";
    return { ok: false, error: message };
  }
}
