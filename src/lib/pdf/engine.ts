import pdfmake from "pdfmake";
import vfs from "pdfmake/build/vfs_fonts";
import type { TDocumentDefinitions } from "pdfmake/interfaces";

/*
 * PDFs made on the server (0131), for the Email tab's attachments.
 *
 * pdfmake with its own Roboto, loaded from the font module rather than from
 * disk so the deployment bundle carries it: Latin, Greek and Cyrillic. Thai
 * text has no glyphs in Roboto and prints as gaps -- a font to add if a Thai
 * hotel needs these.
 *
 * It fetches nothing and reads no file: both access policies refuse, so a
 * URL or path that reached a document definition could not be used to read
 * the server.
 */

let ready = false;

function engine(): typeof pdfmake {
  if (!ready) {
    // The Node build keeps fonts in its own virtual file system, which the
    // type definitions do not describe.
    const fs = (pdfmake as unknown as { virtualfs: { writeFileSync(name: string, content: Buffer): void } }).virtualfs;
    for (const [name, data] of Object.entries(vfs as unknown as Record<string, string>)) {
      if (name.endsWith(".ttf")) fs.writeFileSync(name, Buffer.from(data, "base64"));
    }
    pdfmake.setFonts({
      Roboto: {
        normal: "Roboto-Regular.ttf",
        bold: "Roboto-Medium.ttf",
        italics: "Roboto-Italic.ttf",
        bolditalics: "Roboto-MediumItalic.ttf",
      },
    });
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy(() => false);
    ready = true;
  }
  return pdfmake;
}

export async function renderPdf(doc: TDocumentDefinitions): Promise<Buffer> {
  const out = await engine().createPdf({ ...doc, defaultStyle: { font: "Roboto", fontSize: 9.5, ...doc.defaultStyle } }).getBuffer();
  return Buffer.from(out);
}
