import { h } from "./dom.js";

const card = document.getElementById("pr-card");

function ago(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function hidePrCard() {
  card.hidden = true;
  card.replaceChildren();
}

export function showPrLoading() {
  card.replaceChildren(h("p", "hint", "Loading pull request..."));
  card.hidden = false;
}

/** Renders the PR summary from GET /pr. All text goes in as text nodes. */
export function showPrCard(pr) {
  const state = pr.draft && pr.state === "open" ? "draft" : pr.state;
  card.replaceChildren(
    h(
      "div",
      "pr-head",
      h(
        "div",
        "",
        h("div", "pr-repo", `${pr.owner} / ${pr.repo}`),
        h(
          "div",
          "pr-title",
          h("span", "pr-num", `#${pr.prNumber}`),
          h("a", "", pr.title),
        ),
        pr.description && h("p", "pr-desc", pr.description),
        h(
          "div",
          "pr-meta",
          h("code", "", `${pr.headRef} → ${pr.baseRef}`),
          h("span", "", pr.author),
          h("span", "", ago(pr.createdAt)),
          h("span", "", plural(pr.comments, "comment")),
        ),
      ),
      h(
        "div",
        "pr-stats",
        h("span", "pr-state", state),
        h("div", "", plural(pr.changedFiles, "file"), " changed"),
        h("div", "pr-add", `+${pr.additions} additions`),
        h("div", "pr-del", `−${pr.deletions} deletions`),
      ),
    ),
  );
  const link = card.querySelector(".pr-title a");
  link.href = pr.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  card.querySelector(".pr-state").dataset.state = state;
  card.hidden = false;
}
