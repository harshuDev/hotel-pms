// Second pass of the staff-language conversion (0106): template strings in
// places a person reads them become tr("... {name} ...", { name: expr }).
//
//   node scripts/i18n-templates.mjs <file...>
//
// Kept as the record of how the app was converted; not part of the build.
import fs from "node:fs";
import ts from "typescript";

const ATTRS = new Set(["label", "aria-label", "title", "placeholder", "detail", "emptyTitle", "emptyHint", "hint", "subtitle", "eyebrow", "empty", "closeLabel", "backLabel", "alt", "name"]);
const PROPS = new Set(["header", "label", "title", "heading", "emptyTitle", "emptyHint", "detail", "hint", "description", "placeholder", "subtitle", "empty", "text", "caption", "footLabel"]);
const CALLS = new Set(["confirm", "alert", "setError", "setMessage", "setNotice", "setInfo", "setFlash", "setDone", "onError", "setStatus"]);

function nameFor(expr, used) {
  let base = "value";
  const e = expr.getText();
  if (/^formatMoney(Short)?\(|^money\(|Cents\b/.test(e)) base = "amount";
  else if (/^tr\.date\(|^day\(|^fmt\(/.test(e)) base = "date";
  else {
    const m = /([A-Za-z_][A-Za-z0-9_]*)\s*(\([^)]*\))?\s*$/.exec(e.replace(/\?\?.*$/, "").trim());
    if (m) base = m[1];
  }
  base = base.replace(/^(get|format|to)(?=[A-Z])/, "").replace(/^./, (c) => c.toLowerCase());
  let name = base;
  let i = 2;
  while (used.has(name)) name = `${base}${i++}`;
  used.add(name);
  return name;
}

function convertible(tpl) {
  // No string literal inside a placeholder: `${n === 1 ? "" : "s"}` is an
  // English plural and wants rewriting by hand.
  let ok = true;
  for (const span of tpl.templateSpans) {
    const walk = (n) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) ok = false;
      ts.forEachChild(n, walk);
    };
    walk(span.expression);
  }
  const words = tpl.head.text + tpl.templateSpans.map((s) => s.literal.text).join(" ");
  return ok && /[A-Za-z]{3,}/.test(words);
}

function build(tpl) {
  const used = new Set();
  let key = tpl.head.text;
  const vars = [];
  for (const span of tpl.templateSpans) {
    const name = nameFor(span.expression, used);
    key += `{${name}}` + span.literal.text;
    vars.push(`${name}: ${span.expression.getText()}`);
  }
  return `tr(${JSON.stringify(key)}, { ${vars.join(", ")} })`;
}

function inReaderPlace(node) {
  const p = node.parent;
  if (ts.isCallExpression(p) && p.arguments.includes(node)) {
    const callee = p.expression.getText().replace(/^window\./, "");
    if (CALLS.has(callee)) return true;
    if (callee === "run" && p.arguments.indexOf(node) === 1) return true;
  }
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) && ATTRS.has(p.parent.name.getText())) return true;
  if (ts.isJsxExpression(p) && !ts.isJsxAttribute(p.parent)) return true;
  if (ts.isPropertyAssignment(p) && p.initializer === node && PROPS.has(p.name.getText())) return true;
  if (ts.isConditionalExpression(p) && (p.whenTrue === node || p.whenFalse === node)) return inReaderPlace(p);
  if (ts.isParenthesizedExpression(p)) return inReaderPlace(p);
  if (ts.isBinaryExpression(p) && p.right === node && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(p.operatorToken.kind)) return inReaderPlace(p);
  return false;
}

for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const skipped = [];
  (function visit(node) {
    if (ts.isTemplateExpression(node) && inReaderPlace(node)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (convertible(node)) edits.push([node.getStart(), node.getEnd(), build(node)]);
      else if (/[A-Za-z]{3,}/.test(node.getText())) skipped.push(`line ${line}: ${node.getText().replace(/\s+/g, " ").slice(0, 120)}`);
      return;
    }
    ts.forEachChild(node, visit);
  })(sf);
  if (!edits.length && !skipped.length) continue;
  let out = text;
  for (const [a, b, r] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + r + out.slice(b);
  fs.writeFileSync(file, out);
  console.log(`${file} (${edits.length})${skipped.length ? "\n  BY HAND " + skipped.join("\n  BY HAND ") : ""}`);
}
