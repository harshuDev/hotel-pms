// Lists string literals in the staff app that look like text a person reads
// and are not yet passed through the translator (0106).
//
//   node scripts/i18n-leftovers.mjs <file...>
//
// A heuristic, not a proof: it looks for capitalised words and sentences, and
// skips the places text never is -- imports, types, class names, ids, data
// keys, database column names, comparisons.
import fs from "node:fs";
import ts from "typescript";

const SKIP_ATTRS = new Set([
  "className", "href", "key", "id", "type", "name", "role", "htmlFor", "value", "method",
  "action", "target", "rel", "src", "d", "viewBox", "fill", "stroke", "strokeWidth", "form",
  "autoComplete", "inputMode", "pattern", "lang", "dir", "accept", "tone", "variant", "size",
  "align", "width", "height", "data-testid", "encType", "sandbox",
]);
const SKIP_PROPS = new Set([
  "id", "kind", "code", "key", "href", "value", "type", "status", "icon", "provider",
  "className", "tone", "variant", "color", "width", "align", "minWidth", "field", "op",
  "path", "name", "table", "column", "sort", "tab", "match",
]);
const SKIP_CALLS = /^(tr|localised|localisedAs|failed|failure|tr\.plural|tr\.message|tr\.date|tr\.stamp|msg|cn|console\.\w+|require|import|.*\.(from|select|eq|neq|order|rpc|in|is|not|or|filter|match|ilike|like|gte|lte|gt|lt|range|limit|single|maybeSingle|upload|remove|createSignedUrl|getPublicUrl|getItem|setItem|get|set|has|append|startsWith|endsWith|includes|split|replace|join|padStart|toLocaleString|localeCompare|querySelector|getElementById|addEventListener|removeEventListener|redirect|revalidatePath|push|replaceAll)|revalidatePath|redirect|notFound|parseISO|format|formatInTimeZone|addDays|Intl\.\w+|new Intl\.\w+|encodeURIComponent|useState|fetch)$/;

function looksLikeText(s) {
  if (!/[A-Za-z]{2}/.test(s)) return false;
  if (/^[a-z0-9_.:/#?=&%[\]()-]+$/.test(s)) return false; // ids, paths, keys
  if (/^[a-z0-9:[\]/.#%!() -]+$/.test(s) && /[-:[]/.test(s)) return false; // tailwind
  if (/^(https?:|mailto:|\/)/.test(s)) return false;
  return /\b[A-Z][a-z]/.test(s) || /[a-z][.?!…]$/.test(s) || /[a-z]{2,} [a-z]{2,}/.test(s);
}

function inTypeContext(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isTypeNode(n) || ts.isLiteralTypeNode?.(n)) return true;
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return true;
  }
  return false;
}

let total = 0;
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = [];

  function report(node, s) {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    hits.push(`${line}: ${s.replace(/\s+/g, " ").slice(0, 140)}`);
  }

  function visit(node) {
    const isStr = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
    const isTpl = ts.isTemplateExpression(node);
    if ((isStr || isTpl) && !inTypeContext(node)) {
      const s = isStr ? node.text : node.getText().slice(1, -1);
      const p = node.parent;
      let skip = !looksLikeText(isTpl ? s.replace(/\$\{[^}]*\}/g, "X") : s);
      if (!skip && ts.isExpressionStatement(p)) skip = true; // "use client"
      if (!skip && ts.isJsxAttribute(p) && SKIP_ATTRS.has(p.name.getText())) skip = true;
      if (!skip && ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) && SKIP_ATTRS.has(p.parent.name.getText())) skip = true;
      if (!skip && ts.isPropertyAssignment(p) && p.name === node) skip = true;
      if (!skip && ts.isPropertyAssignment(p) && SKIP_PROPS.has(p.name.getText().replace(/["']/g, ""))) skip = true;
      if (!skip && (ts.isCallExpression(p) || ts.isNewExpression(p)) && SKIP_CALLS.test(p.expression.getText())) skip = true;
      if (!skip && ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind)) skip = true;
      if (!skip && ts.isCaseClause(p)) skip = true;
      if (!skip && ts.isElementAccessExpression(p)) skip = true;
      if (!skip && ts.isNewExpression(p) && p.expression.getText() === "Error") skip = false;
      if (!skip) report(node, s);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (hits.length) {
    total += hits.length;
    console.log(`\n== ${file} (${hits.length})\n${hits.join("\n")}`);
  }
}
console.log(`\nTOTAL ${total}`);
