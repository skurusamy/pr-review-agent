import { h, inline, downloadMarkdown } from "./dom.js";

const box = document.getElementById("code-review");

// The one Code Review currently on screen -- what "Download .md" acts on
// ("Post to GitHub" acts on the structured review the panel was rendered from).
// Starting any other run clears it.
let current = null;

export function clearCodeReview() {
  box.textContent = "";
  box.hidden = true;
  current = null;
}

/** The briefing is on screen and the review is still being written. */
export function showReviewPending(text) {
  box.hidden = false;
  box.replaceChildren(h("p", "muted", text));
}

/**
 * Renders a review. `data` is the structured {title, prUrl, review} the
 * server streams; `markdown` is the same review as text, kept verbatim for
 * the download so the file and the CLI output never differ from each other.
 *
 * `markdown` is absent while the Findings are still being checked (they arrive
 * first, all marked "Not checked", so a Stop keeps them). Until then there is
 * no download and no posting; `stopped` brings posting back for what is there.
 */
export function showCodeReview(data, markdown, { stopped = false } = {}) {
  current = { data, markdown };
  box.hidden = false;
  render(data, { checking: !markdown && !stopped, stopped });
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

// What the second check concluded, worded like formatReview.ts. Only findings
// that went through the verify pass carry one.
const CHECK_LABEL = {
  confirmed: "Confirmed by a second check",
  refuted: "Dismissed by a second check",
  unsure: "Not confirmed: the second check could not decide",
  unchecked: "Not checked",
};

// The same rule as postsInline() in src/codeReview/verification.ts: a finding
// nobody checked keeps the old behavior, a checked one goes inline only if confirmed.
const postsInline = (f) =>
  !f.verification || f.verification.status === "confirmed";
const isDismissed = (f) => f.verification?.status === "refuted";

function findingCard(f) {
  return h(
    "article",
    `cr-finding cr-${f.severity}${isDismissed(f) ? " cr-dismissed" : ""}`,
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
    f.suggestion &&
      h(
        "div",
        "cr-suggestion",
        h(
          "p",
          "muted",
          f.suggestion.startLine && f.suggestion.startLine < f.line
            ? `Suggested change (lines ${f.suggestion.startLine}-${f.line}):`
            : `Suggested change (line ${f.line}):`,
        ),
        h("pre", "", f.suggestion.replacement),
      ),
    f.verification &&
      h(
        "p",
        `cr-check cr-check-${f.verification.status}`,
        `${CHECK_LABEL[f.verification.status]}: ${f.verification.evidence}`,
      ),
  );
}

function section(title, ...kids) {
  return h("section", "bf-section", h("h3", "", title), kids);
}

function actions(parts, data, { checking }) {
  const { prUrl, headSha, review } = data;
  const box = h("div", "bf-actions");
  const status = h("span", "bf-status");

  const download = h("button", "secondary", "Download .md");
  download.type = "button";
  // The file is the finished review; before that there is nothing to save.
  download.disabled = !current?.markdown;
  download.addEventListener("click", () => {
    if (!current?.markdown) return;
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
  post.disabled = !parts || !headSha || checking;
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
          `Created a pending review with ${result.commentCount} comment(s)${result.alreadyPosted > 0 ? ` (${result.alreadyPosted} already posted by an earlier run, left out)` : ""}. Submit it on GitHub when ready: `,
          link,
        );
        // A second click would only be refused (one pending review per PR).
        idle(false);
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
        idle();
      }
    });
    const n = review.findings.filter(postsInline).length;
    status.textContent = `Create a pending review on ${parts.owner}/${parts.repo}#${parts.number} with ${n} inline comment(s)? It stays private until you submit it on GitHub.`;
    box.replaceChildren(status, confirm, cancel);
  });

  idle();
  return box;
}

function render(data, state) {
  const { prUrl, review } = data;
  const parts = prParts(prUrl);

  // The briefing above already carries the PR's title and link.
  const heading = h("h2", "", "Code review");

  // Dismissed findings stay on screen, but in their own section, not among
  // the findings the reviewer stands behind.
  const standing = review.findings.filter((f) => !isDismissed(f));
  const standingOffDiff = review.unanchored.filter((f) => !isDismissed(f));
  const dismissed = [...review.findings, ...review.unanchored].filter(
    isDismissed,
  );
  const counts = severityCounts(standing);
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
    actions(parts, data, state),
  );

  box.textContent = "";
  box.append(header);
  if (state.checking) {
    box.append(
      h(
        "p",
        "muted",
        "The review is written. Each finding is now being checked a second time; they show as not checked until then.",
      ),
    );
  } else if (state.stopped) {
    box.append(
      h(
        "p",
        "muted",
        "Stopped before the second check finished. These findings are shown as not checked, so a posted review would carry them in its text and none as inline comments.",
      ),
    );
  }
  box.append(section("Assessment", prose(review.assessment)));

  box.append(
    section(
      `Findings (${standing.length})${counts ? ` · ${counts}` : ""}`,
      standing.length > 0
        ? standing.map(findingCard)
        : h("p", "muted", "No findings the reviewer would stand behind."),
    ),
  );

  if (standingOffDiff.length > 0) {
    box.append(
      section(
        `Not anchored to the diff (${standingOffDiff.length})`,
        h(
          "p",
          "muted",
          "These name a line that is not part of the diff, so they can't be posted as inline comments.",
        ),
        standingOffDiff.map(findingCard),
      ),
    );
  }

  if (dismissed.length > 0) {
    box.append(
      section(
        `Checked and dismissed (${dismissed.length})`,
        h(
          "p",
          "muted",
          "The review raised these, but a second check found they do not hold. They are listed so nothing is hidden, and they are not posted.",
        ),
        dismissed.map(findingCard),
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
