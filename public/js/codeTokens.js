// Finds the parts of a sentence that are code: file paths, function calls,
// constants, camelCase names. The model is asked to put these in `backticks`,
// but does not always, and a paragraph of bare identifiers is hard to read.
// This is the fallback that still sets them apart. Pure (no DOM), so it is
// unit-tested from Node; the page turns each code part into a <code> element.
//
// It aims to be conservative: a missed identifier just stays plain text, while
// a wrongly boxed ordinary word looks odd, so anything doubtful is left alone.

const EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|css|scss|html|py|rb|go|rs|java|kt|sql|sh|toml|lock|env|vue|svelte";

const TOKEN = new RegExp(
  [
    // a scoped package: @scope/pkg, @scope/pkg/sub
    String.raw`@[\w.-]+/[\w.-]*[\w-](?:/[\w.-]+)*`,
    // a path: a/b/c, ./x/y.ts
    String.raw`(?:[\w.-]+/)+[\w.-]*[\w-]`,
    // a call with simple arguments: foo(), obj.get(id)!
    String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^()\s]*\)!?`,
    // a file name: section-ordering.ts, ingestion.vitest.ts
    String.raw`[\w-]+(?:\.[\w-]+)*\.(?:${EXTENSIONS})\b`,
    // a member chain: ctx.imagesLib.categorizeImages
    String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+`,
    // CONSTANT_NAME
    String.raw`\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b`,
    // snake_case
    String.raw`\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b`,
    // camelCase
    String.raw`\b[a-z]+(?:[A-Z][a-z0-9]+)+\b`,
    // PascalCase with at least two words
    String.raw`\b(?:[A-Z][a-z0-9]+){2,}\b`,
  ].join("|"),
  "g",
);

// Names and abbreviations that look like code to a pattern but are words.
const NOT_CODE = new Set(
  [
    "GitHub",
    "GitLab",
    "JavaScript",
    "TypeScript",
    "DevOps",
    "YouTube",
    "LinkedIn",
    "WhatsApp",
    "OpenAPI",
    "Node.js",
    "Next.js",
    "Vue.js",
    "Express.js",
    "React.js",
    "e.g",
    "i.e",
    "etc",
    "vs",
    "a.m",
    "p.m",
  ].map((s) => s.toLowerCase()),
);

function isCode(match, before) {
  if (NOT_CODE.has(match.toLowerCase().replace(/\.$/, ""))) return false;
  // Inside a URL (https://github.com/..., or a path that follows a slash).
  if (/(?:\/|:|@)$/.test(before) && match.includes("/")) return false;
  if (match.includes("/")) {
    const slashes = match.split("/").length - 1;
    const hasExt = new RegExp(String.raw`\.(?:${EXTENSIONS})$`).test(match);
    // "and/or", "images/pictures", "24/7" are not paths.
    return (
      slashes >= 2 ||
      hasExt ||
      match.startsWith("@") ||
      match.startsWith("./") ||
      match.startsWith("../")
    );
  }
  // A member chain such as "v1.2" or "3.5" is a number, and "end.Next" is a typo.
  if (/^\d/.test(match)) return false;
  return true;
}

/**
 * Splits `text` into parts: `{ code: false, text }` for ordinary words and
 * `{ code: true, text }` for the code-looking tokens. Joining every part's
 * text gives back the input exactly.
 */
export function splitCodeTokens(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index;
    const before = text.slice(Math.max(0, start - 3), start);
    let match = m[0];
    // A trailing dot or colon belongs to the sentence, not the token.
    match = match.replace(/[.:,;]+$/, "");
    if (match === "" || !isCode(match, before)) continue;
    if (start > last)
      parts.push({ code: false, text: text.slice(last, start) });
    parts.push({ code: true, text: match });
    last = start + match.length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });
  return parts.length > 0 ? parts : [{ code: false, text }];
}
