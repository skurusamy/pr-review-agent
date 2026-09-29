// Small DOM helpers shared by the Briefing and Code Review panels. Text in
// those panels comes from PR titles, descriptions, comments and the model's
// quotes of other people's code, so it is never trusted as HTML: everything
// is built with createTextNode/textContent.

/** Builds an element; string children become text nodes, nullish/false are skipped. */
export function h(tag, className, ...kids) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

/** Splits `text` on backticks: odd segments become <code>, the rest stay text. */
export function inline(text) {
  return text.split("`").map((part, i) => {
    if (i % 2 === 1) return h("code", "", part);
    return part;
  });
}

/** Offers `text` to the browser as a downloaded Markdown file. */
export function downloadMarkdown(filename, text) {
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
