"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/i18n";
import { cn } from "@/components/ui";
import { DROP_INS, dropInToken } from "@/lib/email-drop-ins";

/*
 * The Email tab's editor (0131), laid out as the reference's: style, bold,
 * italic, underline, clear formatting, font, size, colour, lists, paragraph,
 * line height, table, link, picture, rule, full screen, code view, help, and
 * DROP IN'S on the right.
 *
 * A contentEditable region driven by the browser's own editing commands --
 * there is no editor library in this app. What it produces is untrusted
 * HTML, and it is treated as such: the server sanitises it before it is
 * sent or stored (`sendBookingEmail()`), and a sent message is shown again
 * only inside a sandboxed frame.
 */

const FONTS = ["Segoe UI", "Arial", "Georgia", "Helvetica", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana", "Courier New"];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
const LINE_HEIGHTS = ["1.0", "1.2", "1.4", "1.5", "1.6", "1.8", "2.0", "3.0"];
const COLORS = [
  "#000000", "#424242", "#636363", "#9C9C94", "#CEC6CE", "#EFEFEF", "#F7F7F7", "#FFFFFF",
  "#FF0000", "#FF9C00", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#9C00FF", "#FF00FF",
  "#F7C6CE", "#FFE7CE", "#FFEFC6", "#D6EFD6", "#CEDEE7", "#CEE7F7", "#D6D6E7", "#E7D6DE",
  "#E79C9C", "#FFC69C", "#FFE79C", "#B5D6A5", "#A5C6CE", "#9CC6EF", "#B5A5D6", "#D6A5BD",
  "#E76363", "#F7AD6B", "#FFD663", "#94BD7B", "#73A5AD", "#6BADDE", "#8C7BC6", "#C67BA5",
  "#CE0000", "#E79439", "#EFC631", "#6BA54A", "#4A7B8C", "#3984C6", "#634AA5", "#A54A7B",
  "#9C0000", "#B56308", "#BD9400", "#397B21", "#104A5A", "#085294", "#311873", "#731842",
];

type Popup = null | "style" | "font" | "size" | "color" | "para" | "height" | "table" | "link" | "image" | "help" | "dropins";

const btn =
  "inline-flex h-7 min-w-7 items-center justify-center gap-0.5 rounded border border-line bg-white px-1.5 text-[12px] text-ink hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const menu = "absolute left-0 top-full z-30 mt-1 rounded-md border border-line bg-white p-1 shadow-card";

export function RichEditor({
  value,
  onChange,
  minHeight = 200,
}: {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
}) {
  const tr = useT();
  const box = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const emitted = useRef<string>("");
  const [popup, setPopup] = useState<Popup>(null);
  const [full, setFull] = useState(false);
  const [code, setCode] = useState(false);
  const [link, setLink] = useState("");
  const [image, setImage] = useState("");
  const [grid, setGrid] = useState<[number, number]>([0, 0]);
  const [colorMode, setColorMode] = useState<"fore" | "back">("fore");

  // A value from outside (a template chosen) replaces what is on screen; what
  // this editor emitted itself is already there and is left alone, or the
  // cursor would jump to the start on every keystroke.
  useEffect(() => {
    if (box.current && (value !== emitted.current || box.current.innerHTML !== value)) {
      box.current.innerHTML = value;
      emitted.current = value;
    }
  }, [value, code]);

  useEffect(() => {
    if (!popup) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-editor-menu]")) setPopup(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [popup]);

  function emit() {
    const html = box.current?.innerHTML ?? "";
    emitted.current = html;
    onChange(html);
  }

  function save() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && box.current?.contains(sel.anchorNode)) {
      range.current = sel.getRangeAt(0).cloneRange();
    }
  }

  function restore() {
    box.current?.focus();
    const sel = window.getSelection();
    if (sel && range.current) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
  }

  function exec(command: string, arg?: string) {
    restore();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, arg);
    save();
    emit();
    setPopup(null);
  }

  function fontSize(px: number) {
    restore();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("fontSize", false, "7");
    box.current?.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement("span");
      span.style.fontSize = `${px}px`;
      span.innerHTML = (f as HTMLElement).innerHTML;
      f.replaceWith(span);
    });
    save();
    emit();
    setPopup(null);
  }

  function lineHeight(h: string) {
    restore();
    const sel = window.getSelection();
    let node: Node | null = sel?.anchorNode ?? null;
    while (node && node !== box.current && !(node instanceof HTMLElement && /^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(node.tagName))) {
      node = node.parentNode;
    }
    if (node && node !== box.current && node instanceof HTMLElement) node.style.lineHeight = h;
    else exec("formatBlock", "p");
    emit();
    setPopup(null);
  }

  function insertHtml(html: string) {
    exec("insertHTML", html);
  }

  function table(rows: number, cols: number) {
    const cell = '<td style="border:1px solid #d9e1ec;padding:4px 6px">&nbsp;</td>';
    const row = `<tr>${cell.repeat(cols)}</tr>`;
    insertHtml(`<table style="border-collapse:collapse;width:100%">${row.repeat(rows)}</table><p><br></p>`);
  }

  const toggle = (p: Popup) => setPopup((cur) => (cur === p ? null : p));
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the selection in the text

  const Tool = ({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) => (
    <button type="button" title={label} aria-label={label} onMouseDown={keep} onClick={onClick}
      className={cn(btn, active && "border-brass bg-brass/10")}>
      {children}
    </button>
  );

  return (
    <div className={cn("rounded border border-line bg-white", full && "fixed inset-4 z-50 flex flex-col shadow-2xl")}>
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-shell/60 p-1.5">
        <span className="relative" data-editor-menu>
          <Tool label={tr("Style")} onClick={() => toggle("style")}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 13l7-7M9 3l.6 1.6L11 5l-1.4.6L9 7l-.6-1.4L7 5l1.4-.4zM12.5 8l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z" /></svg>▾
          </Tool>
          {popup === "style" && (
            <span className={cn(menu, "w-40")}>
              {[["p", tr("Normal")], ["blockquote", tr("Quote")], ["pre", tr("Code")], ["h1", tr("Header 1")], ["h2", tr("Header 2")], ["h3", tr("Header 3")]].map(([tag, label]) => (
                <button key={tag} type="button" onMouseDown={keep} onClick={() => exec("formatBlock", tag)}
                  className="block w-full rounded px-2 py-1 text-left text-[12.5px] hover:bg-shell">{label}</button>
              ))}
            </span>
          )}
        </span>
        <Tool label={tr("Bold")} onClick={() => exec("bold")}><b>B</b></Tool>
        <Tool label={tr("Italic")} onClick={() => exec("italic")}><i>I</i></Tool>
        <Tool label={tr("Underline")} onClick={() => exec("underline")}><u>U</u></Tool>
        <Tool label={tr("Remove font style")} onClick={() => exec("removeFormat")}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 13h6M3 9l5-6 5 5-4 5H6z" /></svg>
        </Tool>
        <span className="relative" data-editor-menu>
          <Tool label={tr("Font family")} onClick={() => toggle("font")}>Segoe UI ▾</Tool>
          {popup === "font" && (
            <span className={cn(menu, "w-44")}>
              {FONTS.map((f) => (
                <button key={f} type="button" onMouseDown={keep} onClick={() => exec("fontName", f)} style={{ fontFamily: f }}
                  className="block w-full rounded px-2 py-1 text-left text-[12.5px] hover:bg-shell">{f}</button>
              ))}
            </span>
          )}
        </span>
        <span className="relative" data-editor-menu>
          <Tool label={tr("Font size")} onClick={() => toggle("size")}>14 ▾</Tool>
          {popup === "size" && (
            <span className={cn(menu, "w-16")}>
              {SIZES.map((s) => (
                <button key={s} type="button" onMouseDown={keep} onClick={() => fontSize(s)}
                  className="block w-full rounded px-2 py-0.5 text-left text-[12.5px] hover:bg-shell">{s}</button>
              ))}
            </span>
          )}
        </span>
        <span className="relative" data-editor-menu>
          <Tool label={tr("Colour")} onClick={() => toggle("color")}>
            <span className="rounded-sm bg-yellow-300 px-1 font-semibold">A</span>▾
          </Tool>
          {popup === "color" && (
            <span className={cn(menu, "w-56 p-2")}>
              <span className="mb-1.5 flex gap-1 text-[11.5px]">
                {(["fore", "back"] as const).map((m) => (
                  <button key={m} type="button" onMouseDown={keep} onClick={() => setColorMode(m)}
                    className={cn("rounded px-2 py-0.5", colorMode === m ? "bg-chrome-800 text-white" : "bg-shell")}>
                    {m === "fore" ? tr("Text colour") : tr("Background colour")}
                  </button>
                ))}
              </span>
              <span className="grid grid-cols-8 gap-0.5">
                {COLORS.map((c) => (
                  <button key={c} type="button" title={c} aria-label={c} onMouseDown={keep}
                    onClick={() => exec(colorMode === "fore" ? "foreColor" : "hiliteColor", c)}
                    className="h-5 w-5 rounded-sm border border-line" style={{ background: c }} />
                ))}
              </span>
            </span>
          )}
        </span>
        <Tool label={tr("Unordered list")} onClick={() => exec("insertUnorderedList")}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><circle cx="3" cy="4" r="1.2" /><circle cx="3" cy="8" r="1.2" /><circle cx="3" cy="12" r="1.2" /><path d="M6 3.4h8v1.2H6zM6 7.4h8v1.2H6zM6 11.4h8v1.2H6z" /></svg>
        </Tool>
        <Tool label={tr("Ordered list")} onClick={() => exec("insertOrderedList")}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M2 3h1.5v3H2.6V4H2zM6 3.4h8v1.2H6zM6 7.4h8v1.2H6zM6 11.4h8v1.2H6zM1.8 9h2v.8H2.8l1 1V13h-2v-.8h1.1v-.9z" /></svg>
        </Tool>
        <span className="relative" data-editor-menu>
          <Tool label={tr("Paragraph")} onClick={() => toggle("para")}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M2 3h12v1.2H2zM2 7h8v1.2H2zM2 11h12v1.2H2z" /></svg>▾
          </Tool>
          {popup === "para" && (
            <span className={cn(menu, "flex gap-1")}>
              {[
                ["justifyLeft", tr("Align left")], ["justifyCenter", tr("Align centre")], ["justifyRight", tr("Align right")],
                ["justifyFull", tr("Justify")], ["outdent", tr("Outdent")], ["indent", tr("Indent")],
              ].map(([cmd, label]) => (
                <button key={cmd} type="button" title={label} aria-label={label} onMouseDown={keep} onClick={() => exec(cmd)}
                  className="rounded border border-line px-1.5 py-1 text-[11px] hover:bg-shell">{label}</button>
              ))}
            </span>
          )}
        </span>
        <span className="relative" data-editor-menu>
          <Tool label={tr("Line height")} onClick={() => toggle("height")}>T<span className="text-[9px]">↕</span>▾</Tool>
          {popup === "height" && (
            <span className={cn(menu, "w-16")}>
              {LINE_HEIGHTS.map((h) => (
                <button key={h} type="button" onMouseDown={keep} onClick={() => lineHeight(h)}
                  className="block w-full rounded px-2 py-0.5 text-left text-[12.5px] hover:bg-shell">{h}</button>
              ))}
            </span>
          )}
        </span>
        <span className="relative" data-editor-menu>
          <Tool label={tr("Table")} onClick={() => { setGrid([0, 0]); toggle("table"); }}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 3h12v10H2zM2 6.5h12M2 10h12M6 3v10M10 3v10" /></svg>▾
          </Tool>
          {popup === "table" && (
            <span className={cn(menu, "p-2")}>
              <span className="grid grid-cols-8 gap-0.5" onMouseLeave={() => setGrid([0, 0])}>
                {Array.from({ length: 64 }, (_, i) => {
                  const r = Math.floor(i / 8) + 1;
                  const c = (i % 8) + 1;
                  return (
                    <button key={i} type="button" aria-label={`${r} × ${c}`} onMouseDown={keep}
                      onMouseEnter={() => setGrid([r, c])} onClick={() => table(r, c)}
                      className={cn("h-4 w-4 border border-line", r <= grid[0] && c <= grid[1] && "bg-brass/30")} />
                  );
                })}
              </span>
              <span className="mt-1 block text-center text-[11px] text-ink-muted">{grid[0]} × {grid[1]}</span>
            </span>
          )}
        </span>
        <span className="relative" data-editor-menu>
          <Tool label={tr("Link")} onClick={() => { save(); setLink(""); toggle("link"); }}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 9a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.8.8M9 7a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.8-.8" /></svg>
          </Tool>
          {popup === "link" && (
            <span className={cn(menu, "flex w-72 gap-1 p-2")}>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://"
                className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-[12.5px]" autoFocus />
              <button type="button" onClick={() => {
                const url = /^(https?:|mailto:|tel:)/i.test(link.trim()) ? link.trim() : `https://${link.trim()}`;
                if (link.trim()) exec("createLink", url);
              }} className="rounded bg-chrome-800 px-2 text-[12px] text-white">{tr("Insert")}</button>
            </span>
          )}
        </span>
        <span className="relative" data-editor-menu>
          <Tool label={tr("Picture")} onClick={() => { save(); setImage(""); toggle("image"); }}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 3h12v10H2zM2 11l3.5-3.5L9 11l2-2 3 3" /><circle cx="10.5" cy="6" r="1" /></svg>
          </Tool>
          {popup === "image" && (
            <span className={cn(menu, "flex w-72 gap-1 p-2")}>
              <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…/picture.jpg"
                className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-[12.5px]" autoFocus />
              <button type="button" onClick={() => {
                if (/^https:\/\//i.test(image.trim())) exec("insertImage", image.trim());
              }} className="rounded bg-chrome-800 px-2 text-[12px] text-white">{tr("Insert")}</button>
            </span>
          )}
        </span>
        <Tool label={tr("Horizontal rule")} onClick={() => exec("insertHorizontalRule")}>—</Tool>
        <Tool label={tr("Full screen")} onClick={() => setFull((f) => !f)} active={full}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
        </Tool>
        <Tool label={tr("Code view")} onClick={() => { if (!code) emit(); setCode((c) => !c); }} active={code}>&lt;/&gt;</Tool>
        <span className="relative" data-editor-menu>
          <Tool label={tr("Help")} onClick={() => toggle("help")}>?</Tool>
          {popup === "help" && (
            <span className={cn(menu, "w-60 p-3 text-[12px] text-ink")}>
              {[["Ctrl+B", tr("Bold")], ["Ctrl+I", tr("Italic")], ["Ctrl+U", tr("Underline")], ["Ctrl+Z", tr("Undo")], ["Ctrl+Y", tr("Redo")]].map(([k, v]) => (
                <span key={k} className="flex justify-between py-0.5"><kbd className="text-ink-muted">{k}</kbd>{v}</span>
              ))}
            </span>
          )}
        </span>
        <span className="relative ml-auto" data-editor-menu>
          <button type="button" onMouseDown={keep} onClick={() => { save(); toggle("dropins"); }}
            className="h-7 rounded border border-line bg-white px-3 text-[11.5px] font-medium uppercase tracking-wide text-ink hover:bg-shell">
            {tr("Drop in's")}
          </button>
          {popup === "dropins" && (
            <span className={cn(menu, "left-auto right-0 max-h-72 w-56 overflow-y-auto")}>
              {DROP_INS.map((d) => (
                <button key={d.key} type="button" onMouseDown={keep} onClick={() => exec("insertText", dropInToken(d.key))}
                  className="block w-full rounded px-2 py-1 text-left text-[12.5px] hover:bg-shell">
                  {tr(d.label)}
                  <span className="ml-1 text-[11px] text-ink-faint">{dropInToken(d.key)}</span>
                </button>
              ))}
            </span>
          )}
        </span>
      </div>

      {code ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className={cn("block w-full resize-y p-3 font-mono text-[12px] text-ink outline-none", full && "flex-1")}
          style={{ minHeight }}
        />
      ) : (
        <div
          ref={box}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={emit}
          onKeyUp={save}
          onMouseUp={save}
          onBlur={save}
          className={cn("prose-email overflow-y-auto p-3 text-[14px] text-ink outline-none", full && "flex-1")}
          style={{ minHeight, fontFamily: "Segoe UI, Arial, sans-serif" }}
        />
      )}
    </div>
  );
}
