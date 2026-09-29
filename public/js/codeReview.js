import { showTabs, selectTab, hideTabs } from "./panelTabs.js";
import { h, inline, downloadMarkdown } from "./dom.js";

const box = document.getElementById("code-review");

// The one Code Review currently on screen -- what "Download .md" acts on.
// Starting any other run clears it.
let current = null;

/** Called as the review starts: the tabs appear on the log while it runs. */
export function startCodeReview() {
  showTabs("Code Review", box, "log");
}

export function clearCodeReview() {
  hideTabs();
  box.textContent = "";
  current = null;
}

/**
 * Renders a finished review. `data` is the structured {title, prUrl, review}
 * the server streams; `markdown` is the same review as text, kept verbatim for
 * the download so the file and the CLI output never differ from each other.
 */
export function showCodeReview(data, markdown) {
  current = { data, markdown };
  selectTab("summary");
  render(data);
}

function prParts(prUrl) {
  const m = prUrl?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return m ? { owner: m[1], repo: m[2], number: m[3] } : null;
}

// Paragraphs split on blank lines, with `code` spans -- the model writes
// prose, not Markdown documents, so this is all the formatting it gets.
function prose(text) {
  return text
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => h("p", "", inline(p.trim())));
}

function severityCounts(findings) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  return ["high", "medium", "low"]
    .filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(" · ");
}

function findingCard(f) {
  return h(
    "article",
    `cr-finding cr-${f.severity}`,
    h(
      "div",
      "cr-head",
      h("span", `cr-badge cr-badge-${f.severity}`, f.severity),
      h("strong", "cr-title", inline(f.title)),
    ),
    h(
      "div",
      "cr-meta",
      h("code", "", `${f.path}:${f.line}`),
      h("span", "cr-category", f.category),
    ),
    h("div", "cr-body", prose(f.explanation)),
  );
}

function section(title, ...kids) {
  return h("section", "bf-section", h("h3", "", title), kids);
}

function actions(parts) {
  const download = h("button", "secondary", "Download .md");
  download.type = "button";
  download.addEventListener("click", () => {
    if (!current) return;
    downloadMarkdown(
      parts
        ? `code-review-${parts.owner}-${parts.repo}-${parts.number}.md`
        : "code-review.md",
      current.markdown,
    );
  });
  return h("div", "bf-actions", download);
}

function render({ title, prUrl, review }) {
  const parts = prParts(prUrl);

  const heading = h("h2", "");
  if (prUrl) {
    const link = h("a", "", inline(title));
    link.href = prUrl;
    link.target = "_blank";
    link.rel = "noopener";
    heading.append(link);
  } else {
    heading.append(...inline(title));
  }

  const counts = severityCounts(review.findings);
  const header = h(
    "header",
    "bf-header",
    h(
      "div",
      "bf-title",
      heading,
      parts &&
        h("span", "bf-sub", `${parts.owner}/${parts.repo}#${parts.number}`),
    ),
    actions(parts),
  );

  box.textContent = "";
  box.append(header, section("Assessment", prose(review.assessment)));

  box.append(
    section(
      `Findings (${review.findings.length})${counts ? ` · ${counts}` : ""}`,
      review.findings.length > 0
        ? review.findings.map(findingCard)
        : h("p", "muted", "No findings the reviewer would stand behind."),
    ),
  );

  if (review.unanchored.length > 0) {
    box.append(
      section(
        `Not anchored to the diff (${review.unanchored.length})`,
        h(
          "p",
          "muted",
          "These name a line that is not part of the diff, so they can't be posted as inline comments.",
        ),
        review.unanchored.map(findingCard),
      ),
    );
  }

  if (review.skippedFiles.length > 0) {
    box.append(
      section(
        `Not reviewed (${review.skippedFiles.length})`,
        h("p", "muted", "The model was not shown a diff for these files."),
        h(
          "ul",
          "",
          review.skippedFiles.map((s) =>
            h("li", "", h("code", "", s.path), ` (${s.reason})`),
          ),
        ),
      ),
    );
  }
}
