import { showTabs, selectTab, hideTabs } from "./panelTabs.js";
import { h, inline, downloadMarkdown } from "./dom.js";

const box = document.getElementById("code-review");

// The one Code Review currently on screen -- what "Download .md" acts on
// ("Post to GitHub" acts on the structured review the panel was rendered from).
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

function actions(parts, data) {
  const { prUrl, headSha, review } = data;
  const box = h("div", "bf-actions");
  const status = h("span", "bf-status");

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

  // Posting writes to the PR, so it takes a second, explicit click. What it
  // creates is a PENDING review: private to you until you submit it on GitHub.
  // The PR comes from the review itself, not the page's input, which may have
  // been edited since it was generated.
  const post = h("button", "secondary", "Post to GitHub");
  post.type = "button";
  post.disabled = !parts || !headSha;
  const idle = (withPost = true) => {
    box.replaceChildren(download, ...(withPost ? [post] : []), status);
  };

  post.addEventListener("click", () => {
    const confirm = h("button", "", "Create pending review");
    confirm.type = "button";
    const cancel = h("button", "secondary", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      status.textContent = "";
      idle();
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = cancel.disabled = true;
      status.textContent = "Creating...";
      try {
        const response = await fetch("/review/post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prUrl,
            headSha,
            review: {
              assessment: review.assessment,
              findings: review.findings,
              unanchored: review.unanchored,
              skippedFiles: review.skippedFiles,
            },
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(
            result.error ?? `Request failed (${response.status})`,
          );
        }
        const link = h("a", "", "Open the PR on GitHub");
        link.href = result.url;
        link.target = "_blank";
        link.rel = "noopener";
        status.replaceChildren(
          `Created a pending review with ${result.commentCount} comment(s). Submit it on GitHub when ready: `,
          link,
        );
        // A second click would only be refused (one pending review per PR).
        idle(false);
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
        idle();
      }
    });
    const n = review.findings.length;
    status.textContent = `Create a pending review on ${parts.owner}/${parts.repo}#${parts.number} with ${n} inline comment(s)? It stays private until you submit it on GitHub.`;
    box.replaceChildren(status, confirm, cancel);
  });

  idle();
  return box;
}

function render(data) {
  const { title, prUrl, review } = data;
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
    actions(parts, data),
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
