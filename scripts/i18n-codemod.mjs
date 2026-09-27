// One-off codemod for the staff-language work (0106): wraps JSX text and
// user-facing string attributes in tr("..."), declares `tr` in the enclosing
// top-level component, and reports what it could not do safely.
//
//   node scripts/i18n-codemod.mjs <file...>
//
// Kept in the repository as the record of how the app was converted; it is
// not part of the build.
import fs from "node:fs";
import ts from "typescript";

const ATTRS = new Set([
  "label", "aria-label", "title", "placeholder", "detail", "emptyTitle", "emptyHint",
  "hint", "subtitle", "eyebrow", "empty", "closeLabel", "backLabel", "alt",
]);

// Object properties whose string value is shown to the reader.
const PROPS = new Set([
  "header", "label", "title", "heading", "emptyTitle", "emptyHint", "detail", "hint",
  "description", "placeholder", "subtitle", "empty", "confirmLabel", "caption",
]);

// Calls whose string argument is shown to the reader.
const CALLS = new Set(["confirm", "alert", "setError", "setMessage", "setNotice", "setInfo", "setFlash", "setDone"]);

const ENTITIES = {
  "&apos;": "'", "&quot;": '"', "&amp;": "&", "&nbsp;": " ", "&mdash;": "—",
  "&ndash;": "–", "&hellip;": "…", "&rsquo;": "’", "&lsquo;": "‘",
  "&ldquo;": "“", "&rdquo;": "”", "&times;": "×", "&larr;": "←",
  "&rarr;": "→", "&middot;": "·", "&lt;": "<", "&gt;": ">",
};

function jsxString(raw) {
  // JSX whitespace: lines trimmed except the outer edges of the first and last,
  // blank lines dropped, joined with one space.
  const lines = raw.split(/\r\n|\n|\r/);
  const parts = [];
  lines.forEach((line, i) => {
    let s = line;
    if (i > 0) s = s.replace(/^[ \t]+/, "");
    if (i < lines.length - 1) s = s.replace(/[ \t]+$/, "");
    if (s !== "") parts.push(s);
  });
  return parts.join(" ");
}

function decode(s) {
  let unknown = false;
  const out = s.replace(/&[a-zA-Z#0-9]+;/g, (e) => {
    if (e in ENTITIES) return ENTITIES[e];
    unknown = true;
    return e;
  });
  return unknown ? null : out;
}

const worthy = (s) => /[A-Za-z]{2}/.test(s);

// A string that is itself what a JSX expression renders: {x ? "A" : "B"},
// {a || "B"}, {cond && "C"}.
function renderedBranch(node) {
  let n = node;
  while (n.parent) {
    const p = n.parent;
    if (ts.isParenthesizedExpression(p)) { n = p; continue; }
    if (ts.isConditionalExpression(p) && (p.whenTrue === n || p.whenFalse === n)) { n = p; continue; }
    if (ts.isBinaryExpression(p) && p.right === n &&
      [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(p.operatorToken.kind)) { n = p; continue; }
    if (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken &&
      [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) { n = p; continue; }
    return ts.isJsxExpression(p) && !ts.isJsxAttribute(p.parent) ? true
      : ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) && ATTRS.has(p.parent.name.getText());
  }
  return false;
}

function topLevelOwner(node) {
  let n = node;
  let owner = null;
  while (n.parent) {
    if (ts.isFunctionDeclaration(n) && ts.isSourceFile(n.parent)) owner = n;
    if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      ts.isVariableDeclaration(n.parent) &&
      ts.isVariableDeclarationList(n.parent.parent) &&
      ts.isVariableStatement(n.parent.parent.parent) &&
      ts.isSourceFile(n.parent.parent.parent.parent)
    )
      owner = n;
    n = n.parent;
  }
  return owner;
}

function ownerName(fn) {
  if (ts.isFunctionDeclaration(fn)) return fn.name ? fn.name.text : "default";
  return fn.parent.name.getText();
}

for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const isClient = /^\s*["']use client["']/.test(text);
  const edits = [];
  const owners = new Set();
  const notes = [];

  const need = (node) => {
    const o = topLevelOwner(node);
    if (!o) notes.push(`line ${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: no top-level owner`);
    else owners.add(o);
  };

  function visit(node) {
    if (ts.isJsxText(node)) {
      const raw = node.getText();
      const str = jsxString(raw);
      const core = str.trim();
      if (worthy(core)) {
        const decoded = decode(core);
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        if (decoded === null) {
          notes.push(`line ${line}: unknown entity in "${core}"`);
        } else {
          // Whitespace that spans a line break means nothing to JSX, so it is
          // kept exactly as written; a space on the same line is real text.
          const rawLead = /^\s*/.exec(raw)[0];
          const rawTrail = /\s*$/.exec(raw)[0];
          const lead = /\n/.test(rawLead) ? rawLead : str.startsWith(" ") ? '{" "}' : "";
          const trail = /\n/.test(rawTrail) ? rawTrail : str.endsWith(" ") ? '{" "}' : "";
          edits.push([node.getStart(), node.getEnd(), `${lead}{tr(${JSON.stringify(decoded)})}${trail}`]);
          need(node);
          const siblings = node.parent.children ?? [];
          if (siblings.some((c) => ts.isJsxExpression(c) && c.expression)) {
            notes.push(`line ${line}: text beside an expression -- "${decoded}"`);
          }
        }
      }
    } else if (ts.isStringLiteral(node) && worthy(node.text) && renderedBranch(node)) {
      edits.push([node.getStart(), node.getEnd(), `tr(${JSON.stringify(node.text)})`]);
      need(node);
    } else if (
      ts.isStringLiteral(node) &&
      worthy(node.text) &&
      ts.isPropertyAssignment(node.parent) &&
      node.parent.initializer === node &&
      PROPS.has(node.parent.name.getText().replace(/["']/g, "")) &&
      topLevelOwner(node)
    ) {
      edits.push([node.getStart(), node.getEnd(), `tr(${JSON.stringify(node.text)})`]);
      need(node);
    } else if (
      ts.isStringLiteral(node) &&
      worthy(node.text) &&
      ts.isCallExpression(node.parent) &&
      node.parent.arguments.includes(node) &&
      (CALLS.has(node.parent.expression.getText().replace(/^window\./, "")) ||
        (node.parent.expression.getText() === "run" && node.parent.arguments.indexOf(node) === 1)) &&
      topLevelOwner(node)
    ) {
      edits.push([node.getStart(), node.getEnd(), `tr(${JSON.stringify(node.text)})`]);
      need(node);
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText();
      const value = node.initializer.text;
      if (ATTRS.has(name) && worthy(value)) {
        edits.push([node.initializer.getStart(), node.initializer.getEnd(), `{tr(${JSON.stringify(value)})}`]);
        need(node);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (edits.length === 0) {
    if (notes.length) console.log(`${file}\n  ${notes.join("\n  ")}`);
    continue;
  }

  // Declarations: one per top-level function that now uses tr.
  for (const fn of owners) {
    const name = ownerName(fn);
    const body = fn.body;
    if (!body || !ts.isBlock(body)) {
      notes.push(`${name}: expression body -- declare tr by hand`);
      continue;
    }
    const already = body.statements.some((s) => /\bconst tr\b/.test(s.getText()));
    if (already) continue;
    if (isClient) {
      if (!/^[A-Z]/.test(name)) notes.push(`${name}: lower-case function in a client file -- a hook cannot go here`);
      edits.push([body.getStart() + 1, body.getStart() + 1, "\n  const tr = useT();"]);
    } else {
      if (!/^[A-Z]/.test(name) && name !== "default") notes.push(`${name}: lower-case server function made to await -- check its callers`);
      edits.push([body.getStart() + 1, body.getStart() + 1, "\n  const tr = await getT();"]);
      const isAsync = fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (!isAsync) {
        if (ts.isFunctionDeclaration(fn)) {
          const at = fn.getStart() + fn.getText().indexOf("function");
          edits.push([at, at, "async "]);
        } else {
          edits.push([fn.getStart(), fn.getStart(), "async "]);
        }
        notes.push(`${name}: made async`);
      }
    }
  }

  let out = text;
  for (const [start, end, rep] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
    out = out.slice(0, start) + rep + out.slice(end);
  }

  const importLine = isClient
    ? 'import { useT } from "@/components/i18n";\n'
    : 'import { getT } from "@/lib/i18n/server";\n';
  if (!out.includes(importLine.trim())) {
    // After the directive and before the first import.
    const m = /^(\s*["']use client["'];?\s*\n)/.exec(out);
    out = m ? m[1] + importLine + out.slice(m[1].length) : importLine + out;
  }

  fs.writeFileSync(file, out);
  console.log(`${file}  (${edits.length} edits${isClient ? ", client" : ", server"})${notes.length ? "\n  " + notes.join("\n  ") : ""}`);
}
